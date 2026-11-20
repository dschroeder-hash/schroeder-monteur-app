/**
 * No Meister in the app (E-66): the worker hands finished days, withdrawals and finished orders to BC on its own,
 * with "Automatik" as actor – unless the setting `approval.mode` is 'meister'.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc, type CommandType } from '@schroeder/shared';
import { createDb } from '../src/db/client.js';
import { AuditService } from '../src/common/audit.service.js';
import { AbsenceService } from '../src/modules/absence/absence.service.js';
import { ApprovalsService } from '../src/modules/approvals/approvals.service.js';
import { runAutoApprove, SYSTEM_USER_ID } from '../src/modules/approvals/auto-approve.js';
import { ReportService } from '../src/modules/docs/report.service.js';
import { TimeService } from '../src/modules/time/time.service.js';
import { TransferService } from '../src/modules/transfer/transfer.service.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

const TZ = 'Europe/Berlin';
const TODAY = localDate(new Date(), TZ);
const D = addDays(TODAY, -25);
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let approvals: ApprovalsService;
let token: string;
let userId: string;
let seq = 5000;
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (type: CommandType, time: string, payload: Record<string, unknown> = {}) =>
  api(app)
    .post('/v1/sync/push')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      deviceId: 'auto-approve-device',
      deviceNow: new Date().toISOString(),
      commands: [
        {
          id: randomUUID(),
          type,
          deviceTime: zonedToUtc(D, time, TZ).toISOString(),
          deviceSeq: ++seq,
          payload,
        },
      ],
    });
const run = () => runAutoApprove(workerDb.db, approvals, (m) => process.env.DEBUG_AUTO && console.log(m));

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  const transfers = new TransferService();
  const audit = new AuditService();
  approvals = new ApprovalsService(
    workerDb.db,
    new TimeService(),
    transfers,
    audit,
    new ReportService(),
    new AbsenceService(workerDb.db, transfers, audit),
  );
  token = await tokenFor(app, 'monteur2-wild');
  userId = (await q('select id from app_user where entra_oid = $1', [persona('monteur2-wild').oid]))[0].id;
});
afterAll(async () => {
  await q("delete from setting where key = 'approval'");
  await workerDb.pool.end();
  await owner.end();
  await app.close();
});

describe('automatic hand-over to BC (no Meister approval)', () => {
  let order: { id: string; bc_no: string };

  it('does nothing in mode "meister"', async () => {
    order = (
      await q(
        "select o.id, o.bc_no from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending' order by o.bc_no desc limit 1",
        [userId],
      )
    )[0];
    await push('StampJobStart', '07:00', { orderId: order.id, activity: 'WORK' }).expect(200);
    await push('StampClockOut', '09:30').expect(200);
    await q(`insert into setting (key, value) values ('approval', '{"mode":"meister"}')`);
    expect(await run()).toEqual({});
    const states = await q('select distinct state from time_entry where user_id = $1 and work_date = $2', [
      userId,
      D,
    ]);
    expect(states.map((s) => s.state)).toEqual(['OPEN']);
    await q("delete from setting where key = 'approval'");
  });

  it('approves the finished day as "Automatik" and queues the BC lines', async () => {
    const stats = await run();
    expect(stats.days).toBeGreaterThanOrEqual(1);
    const entries = await q(
      'select state, approval_id from time_entry where user_id = $1 and work_date = $2',
      [userId, D],
    );
    expect(entries.every((e) => e.state === 'APPROVED')).toBe(true);
    const [ap] = await q('select approved_by from approval where id = $1', [entries[0].approval_id]);
    expect(ap.approved_by).toBe(SYSTEM_USER_ID);
    const lines = await q(
      "select payload from bc_transfer where subject_id = $1 and target in ('SERVICE_LINE_RESOURCE', 'RESOURCE_JOURNAL')",
      [entries[0].approval_id],
    );
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.payload.body.documentNumber === order.bc_no)).toBe(true);
  });

  it('a day with a running booking or within the grace period is left alone', async () => {
    const day = addDays(TODAY, -24);
    await api(app)
      .post('/v1/sync/push')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        deviceId: 'auto-approve-device',
        deviceNow: new Date().toISOString(),
        commands: [
          {
            id: randomUUID(),
            type: 'StampJobStart',
            deviceTime: zonedToUtc(day, '07:00', TZ).toISOString(),
            deviceSeq: ++seq,
            payload: { orderId: order.id, activity: 'WORK' },
          },
        ],
      })
      .expect(200);
    await run();
    const open = await q(
      "select count(*)::int as n from time_entry where user_id = $1 and work_date = $2 and state = 'OPEN'",
      [userId, day],
    );
    expect(open[0].n).toBeGreaterThan(0);
  });

  it('"Arbeit abgeschlossen" (FERTIG) is handed over: report and status to BC, event source AUTO', async () => {
    await q("update service_order set app_status = 'FERTIG' where id = $1", [order.id]);
    const stats = await run();
    expect(stats.orders).toBeGreaterThanOrEqual(1);
    expect((await q('select app_status from service_order where id = $1', [order.id]))[0].app_status).toBe(
      'FREIGEGEBEN',
    );
    const [ev] = await q(
      'select source, actor_id from order_status_event where order_id = $1 order by at desc limit 1',
      [order.id],
    );
    expect(ev).toMatchObject({ source: 'AUTO', actor_id: SYSTEM_USER_ID });
    expect(
      (
        await q("select count(*)::int as n from bc_transfer where subject_id = $1 and target = 'STATUS'", [
          order.id,
        ])
      )[0].n,
    ).toBe(1);
  });
});
