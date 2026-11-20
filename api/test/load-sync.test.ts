/**
 * Load and sync test (PROMPT 10, Phase 8): many devices push at the same time, every batch is sent twice in parallel
 * (retry after a timeout while the first request is still running), then all devices pull. Checks: nothing is lost,
 * nothing is duplicated, response times stay acceptable. Also: BC transfer queue under load.
 *
 * Runs separately with its own fresh test database (it creates many users and drains the BC queue):
 *   pnpm --filter @schroeder/api test:load                                  (30 devices × 40 commands, ~15 s)
 *   LOAD_DEVICES=150 LOAD_COMMANDS=60 pnpm --filter @schroeder/api test:load
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type CommandType } from '@schroeder/shared';
import { buildMockServer } from '@schroeder/bc-mock';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { BcClient } from '../src/bc/bc-client.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { FeatureService } from '../src/features/feature.service.js';
import { DEV_SECRET, TEST_NOW } from './constants.js';
import { api } from './helpers.js';

const DEVICES = Number(process.env.LOAD_DEVICES ?? 30);
const COMMANDS = Number(process.env.LOAD_COMMANDS ?? 40);
const BATCH = 10;

let app: NestExpressApplication;
let owner: pg.Client;
const devices: Array<{ userId: string; token: string; orderIds: string[] }> = [];
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]!;

beforeAll(async () => {
  if (!process.env.LOAD) return;
  // Production-like limits are not the subject here; one user sends a lot in a short time.
  app = await createApp(
    loadConfig({
      APP_ENV: 'test',
      AUTH_MODE: 'dev',
      DEV_AUTH_SECRET: DEV_SECRET,
      DATABASE_URL: process.env.TEST_API_DATABASE_URL!,
      RATE_LIMIT_PER_MIN: '0',
    }),
    { logger: false },
  );
  await app.init();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  // Own location with own orders: the load test must not change state other test files rely on (Wildeshausen).
  const [loc] = await q(
    `insert into location (code, name, bundesland, timezone, bc_company_id, bc_responsibility_center, default_location_code)
     select 'LOAD' || substr(md5(random()::text), 1, 4), 'Laststandort', bundesland, timezone, bc_company_id, bc_responsibility_center, default_location_code
     from location where code = 'WILD' returning id`,
  );
  const orders = (
    await q(
      `insert into service_order (location_id, bc_company_id, bc_no, description, order_type_code, bc_status, app_status, priority, customer_no, customer_name, contact_name, contact_phone, contact_mobile, fault_description, rework_flag)
       select $1, bc_company_id, 'LOAD-' || substr(md5(random()::text), 1, 8), description, order_type_code, bc_status, 'EINGEPLANT', priority, customer_no, customer_name, contact_name, contact_phone, contact_mobile, fault_description, false
       from service_order where deleted_in_bc_at is null limit 3 returning id`,
      [loc.id],
    )
  ).map((o) => o.id as string);
  const verifier = app.get(TokenVerifier);
  // Set-up in a few statements (also fast for hundreds of devices).
  const users = await q(
    `insert into app_user (entra_oid, display_name, email)
     select gen_random_uuid(), 'Last-Monteur ' || g, 'last' || g || '-' || gen_random_uuid() || '@example.invalid'
     from generate_series(1, $1) g returning id, entra_oid, display_name, email`,
    [DEVICES],
  );
  await q("insert into user_location (user_id, location_id, role) select unnest($1::uuid[]), $2, 'MONTEUR'", [
    users.map((u) => u.id),
    loc.id,
  ]);
  await q(
    `insert into assignment (order_id, location_id, user_id, planned_start, planned_end)
     select o.id, $2, u, now() - interval '3 hours' + make_interval(hours => o.k::int), now() - interval '2 hours' + make_interval(hours => o.k::int)
     from unnest($1::uuid[]) u cross join unnest($3::uuid[]) with ordinality o(id, k)`,
    [users.map((u) => u.id), loc.id, orders],
  );
  for (const u of users)
    devices.push({
      userId: u.id,
      orderIds: orders,
      token: await verifier.issueDevToken({
        oid: u.entra_oid,
        name: u.display_name,
        email: u.email,
        roles: [ROLES.Monteur],
      }),
    });
}, 120_000);
afterAll(async () => {
  await owner?.end();
  await app?.close();
});

/** A realistic morning: clock in, alternate between orders, chat, pause … – device times strictly ascending. */
function commandsFor(d: (typeof devices)[number]) {
  const start = Date.now() - (COMMANDS + 5) * 60_000;
  const out: Array<{
    id: string;
    type: CommandType;
    deviceTime: string;
    deviceSeq: number;
    payload: Record<string, unknown>;
  }> = [];
  const add = (type: CommandType, payload: Record<string, unknown>) =>
    out.push({
      id: randomUUID(),
      type,
      deviceTime: new Date(start + out.length * 60_000).toISOString(),
      deviceSeq: out.length + 1,
      payload,
    });
  add('StampClockIn', {});
  while (out.length < COMMANDS - 1) {
    const order = d.orderIds[out.length % d.orderIds.length]!;
    if (out.length % 5 === 3) add('SendChatMessage', { orderId: order, body: `Zwischenstand ${out.length}` });
    else if (out.length % 2 === 1) add('StampJobStart', { orderId: order, activity: 'WORK' });
    else add('StampJobStop', { orderId: order });
  }
  add('StampClockOut', {});
  return out;
}

describe.skipIf(!process.env.LOAD)(
  `sync under load (${DEVICES} devices × ${COMMANDS} commands, every batch twice in parallel)`,
  () => {
    it('applies everything exactly once with acceptable latency', async () => {
      const latencies: number[] = [];
      const results = new Map<string, string>();
      const t0 = Date.now();
      // Regression: an expiring feature-flag cache while all pool connections are busy used to deadlock the pool.
      const flush = setInterval(() => app.get(FeatureService).invalidate(), 200);
      await Promise.all(
        devices.map(async (d) => {
          const cmds = commandsFor(d);
          for (let i = 0; i < cmds.length; i += BATCH) {
            const body = {
              deviceId: `load-${d.userId}`,
              deviceNow: new Date().toISOString(),
              commands: cmds.slice(i, i + BATCH),
            };
            const send = async () => {
              const s = Date.now();
              const res = await api(app)
                .post('/v1/sync/push')
                .set('Authorization', `Bearer ${d.token}`)
                .send(body);
              latencies.push(Date.now() - s);
              return res;
            };
            // the "retry while the first request is still running" case
            const [a, b] = await Promise.all([send(), send()]);
            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            for (const r of [...a.body.results, ...b.body.results]) {
              const prev = results.get(r.id);
              if (!prev || prev === 'duplicate') results.set(r.id, r.result);
            }
          }
        }),
      );
      clearInterval(flush);
      const pushSeconds = (Date.now() - t0) / 1000;

      const total = DEVICES * COMMANDS;
      const rejected = [...results.values()].filter((r) => r === 'rejected');
      expect(rejected).toEqual([]);
      expect([...results.values()].filter((r) => r === 'applied')).toHaveLength(total);

      // Server state: each command exactly once
      const ids = devices.map((d) => d.userId);
      const [{ n: stamps }] = await q('select count(*)::int n from stamp_event where user_id = any($1)', [
        ids,
      ]);
      const [{ n: chats }] = await q('select count(*)::int n from chat_message where author_id = any($1)', [
        ids,
      ]);
      const [{ n: logged }] = await q('select count(*)::int n from sync_command where user_id = any($1)', [
        ids,
      ]);
      expect(stamps + chats).toBe(total);
      expect(logged).toBe(total);
      // derived time entries are consistent: no overlapping open segments per user
      const [{ n: open }] = await q(
        'select count(*)::int n from time_entry where user_id = any($1) and end_at is null',
        [ids],
      );
      expect(open).toBe(0);

      // Pull: all devices at once
      const pullLat: number[] = [];
      const t1 = Date.now();
      const pulls = await Promise.all(
        devices.map(async (d) => {
          const s = Date.now();
          const res = await api(app).get('/v1/sync/pull').set('Authorization', `Bearer ${d.token}`);
          pullLat.push(Date.now() - s);
          return res;
        }),
      );
      const pullSeconds = (Date.now() - t1) / 1000;
      const statuses = pulls.reduce<Record<number, number>>(
        (m, p) => ({ ...m, [p.status]: (m[p.status] ?? 0) + 1 }),
        {},
      );
      // Overload is answered cleanly (503 + Retry-After, never 500); the devices retry with the next sync cycle.
      expect(
        pulls.every((p) => p.status === 200 || (p.status === 503 && p.headers['retry-after'] === '5')),
      ).toBe(true);
      for (const [i, p] of pulls.entries())
        if (p.status === 503)
          pulls[i] = await api(app).get('/v1/sync/pull').set('Authorization', `Bearer ${devices[i]!.token}`);
      expect(pulls.every((p) => p.status === 200)).toBe(true);
      expect(
        pulls.every(
          (p, i) =>
            p.body.stampEvents.filter((e: { userId: string }) => e.userId === devices[i]!.userId).length > 0,
        ),
      ).toBe(true);

      const report = {
        devices: DEVICES,
        commands: total,
        pushRequests: latencies.length,
        pushSeconds,
        pushP50ms: pct(latencies, 50),
        pushP95ms: pct(latencies, 95),
        pushMaxMs: Math.max(...latencies),
        commandsPerSecond: Math.round(total / pushSeconds),
        pullSeconds,
        pullP95ms: pct(pullLat, 95),
        pullOverloaded: statuses[503] ?? 0,
      };
      console.log(`LOAD ${JSON.stringify(report)}`);
      // Thresholds for ONE in-process API instance (in Azure further instances start at 50 concurrent requests):
      // latency grows with the number of simultaneous devices, throughput (~170 commands/s) stays constant.
      expect(report.pushP95ms).toBeLessThan(Math.max(5000, DEVICES * 100));
      expect(report.commandsPerSecond).toBeGreaterThan(50);
      expect(report.pullP95ms).toBeLessThan(DEVICES > 50 ? 15_000 : 5000);
    }, 600_000);
  },
);

describe.skipIf(!process.env.LOAD)('BC transfer queue under load', () => {
  it('500 transfers: all delivered exactly once, also with two workers in parallel', async () => {
    const { app: mock, state } = buildMockServer({ now: TEST_NOW });
    const base = await mock.listen({ port: 0, host: '127.0.0.1' });
    const workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 6);
    try {
      await q("update bc_transfer set state = 'DONE' where state <> 'DONE'");
      const [loc] = await q("select id, bc_company_id from location where code = 'WILD'");
      const [order] = await q(
        "select bc_no from service_order where location_id = $1 and bc_status = 'Pending' and deleted_in_bc_at is null limit 1",
        [loc.id],
      );
      const N = 500;
      await q(
        `insert into bc_transfer (location_id, bc_company_id, target, subject_type, subject_id, group_key, payload)
         select $1, $2, 'COMMENT', 'load', gen_random_uuid(), 'load:' || (g % 25), jsonb_build_object(
           'op', 'create', 'endpoint', 'serviceCommentLines',
           'body', jsonb_build_object('type', 'General', 'documentNumber', $3::text, 'serviceItemLineNumber', 0,
                                      'date', '2026-11-20', 'comment', 'Lasttest ' || g))
         from generate_series(1, $4) g`,
        [loc.id, loc.bc_company_id, order.bc_no, N],
      );
      const clientFor = (companyId: string) =>
        new BcClient({
          apiBaseUrl: `${base}/api`,
          tokenUrl: `${base}/oauth2/token`,
          clientId: 'x',
          clientSecret: 'y',
          scope: 'z',
          companyId,
          backoffBaseMs: 1,
          maxRetries: 2,
        });
      const w1 = new BcTransferWorker(workerDb.db, clientFor);
      const w2 = new BcTransferWorker(workerDb.db, clientFor);
      const before = state.tables.serviceCommentLines.length;
      const t0 = Date.now();
      for (let i = 0; i < 40; i++) {
        const [a, b] = await Promise.all([w1.runOnce(50), w2.runOnce(50)]);
        if (!Object.keys(a).length && !Object.keys(b).length) break;
      }
      const seconds = (Date.now() - t0) / 1000;
      const [{ n: done }] = await q(
        "select count(*)::int n from bc_transfer where subject_type = 'load' and state = 'DONE'",
      );
      const created = state.tables.serviceCommentLines.length - before;
      console.log(`LOAD ${JSON.stringify({ transfers: N, seconds, perSecond: Math.round(N / seconds) })}`);
      expect(done).toBe(N);
      expect(created).toBe(N);
      const appIds = state.tables.serviceCommentLines.map((r) => r.monteurAppId);
      expect(new Set(appIds).size).toBe(appIds.length);
    } finally {
      await workerDb.pool.end();
      await mock.close();
    }
  }, 300_000);
});
