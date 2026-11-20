/** BC delta sync against the mock, executed with the worker DB role (RLS bypass by role membership only). */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMockServer, SEED_COMPANY } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcSyncService } from '../src/bc/bc-sync.service.js';
import { createDb } from '../src/db/client.js';
import { TEST_NOW } from './constants.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW, pageSize: 50 });
let base: string;
let owner: pg.Client;
let sync: BcSyncService;
let close: () => Promise<void>;
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  base = await mock.listen({ port: 0, host: '127.0.0.1' });
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  const { db, pool } = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  close = () => pool.end();
  sync = new BcSyncService(
    db,
    (companyId) =>
      new BcClient({
        apiBaseUrl: `${base}/api`,
        tokenUrl: `${base}/oauth2/token`,
        clientId: 'x',
        clientSecret: 'y',
        scope: 'z',
        companyId,
        backoffBaseMs: 5,
      }),
  );
});
afterAll(async () => {
  await close();
  await owner.end();
  await mock.close();
});

const count = async (t: string) =>
  (await owner.query(`select count(*)::int as n from ${t}`)).rows[0].n as number;

describe('BC delta sync', () => {
  it('initial run upserts without duplicating seeded data', async () => {
    const before = await count('service_order');
    const stats = await sync.runAll();
    expect(stats.serviceOrders).toBe(state.tables.serviceOrders.length);
    expect(await count('service_order')).toBe(before);
    expect(await count('machine')).toBe(state.tables.serviceItems.length);
  });

  it('repeated runs are idempotent (overlap window re-reads rows but changes nothing)', async () => {
    const events = await count('order_status_event');
    const assignments = await count('assignment');
    await sync.runAll();
    await sync.runAll();
    expect(await count('service_order')).toBe(state.tables.serviceOrders.length);
    expect(await count('order_status_event')).toBe(events);
    expect(await count('assignment')).toBe(assignments);
  });

  it('reads only records changed after the cursor', async () => {
    const cursor = (
      await owner.query("select last_modified from bc_sync_cursor where entity = 'serviceOrders'")
    ).rows[0].last_modified as Date;
    for (const o of state.tables.serviceOrders)
      o.lastModifiedDateTime = new Date(cursor.getTime() - 60_000).toISOString();
    const o = state.tables.serviceOrders[1]!;
    await post('/__mock/change', {
      entitySet: 'serviceOrders',
      id: o.id,
      patch: { contactName: 'Neuer Ansprechpartner' },
    });
    const stats = await sync.runAll();
    expect(stats.serviceOrders).toBe(1);
  });

  it('applies a description change made in BC', async () => {
    const o = state.tables.serviceOrders[5]!;
    await post('/__mock/change', {
      entitySet: 'serviceOrders',
      id: o.id,
      patch: { description: 'Kunde ruft zurück – Termin verschoben' },
    });
    await sync.runAll();
    const r = await owner.query('select description from service_order where bc_no = $1', [o.number]);
    expect(r.rows[0].description).toBe('Kunde ruft zurück – Termin verschoben');
  });

  it('"Aus BC aktualisieren": a requested order is re-read immediately, independent of the delta cursor', async () => {
    const o = state.tables.serviceOrders[6]!;
    const [order] = (await owner.query('select id from service_order where bc_no = $1', [o.number])).rows;
    // change in BC without touching lastModifiedDateTime → the delta sync would not see it
    o.description = 'Direkt in BC geändert';
    const [u] = (await owner.query('select id from app_user limit 1')).rows;
    // requests left open by other test files (the file order varies) must not count here
    await owner.query('update bc_refresh_request set done_at = now() where done_at is null');
    await owner.query('insert into bc_refresh_request (order_id, requested_by) values ($1, $2)', [
      order.id,
      u.id,
    ]);
    expect(await sync.processRefreshRequests()).toBe(1);
    const r = await owner.query('select description from service_order where id = $1', [order.id]);
    expect(r.rows[0].description).toBe('Direkt in BC geändert');
    const [req] = (
      await owner.query('select done_at, error from bc_refresh_request where order_id = $1', [order.id])
    ).rows;
    expect(req.done_at).not.toBeNull();
    expect(req.error).toBeNull();
    expect(await sync.processRefreshRequests()).toBe(0);
  });

  it('a status change in BC overrides the app status and is logged', async () => {
    const o = state.tables.serviceOrders.find(
      (x) => x.status === 'Pending' && x.responsibilityCenter === 'ALZ',
    )!;
    await post('/__mock/change', { entitySet: 'serviceOrders', id: o.id, patch: { status: 'On Hold' } });
    await sync.runAll();
    const r = await owner.query('select id, app_status from service_order where bc_no = $1', [o.number]);
    expect(r.rows[0].app_status).toBe('WARTET_KUNDE');
    const ev = await owner.query(
      'select source from order_status_event where order_id = $1 order by at desc limit 1',
      [r.rows[0].id],
    );
    expect(ev.rows[0].source).toBe('BC');
  });

  it('creates an assignment for a new allocation of a mapped resource', async () => {
    const o = state.tables.serviceOrders.find(
      (x) => x.status === 'Pending' && x.responsibilityCenter === 'WILD',
    )!;
    state.tables.serviceOrderAllocations.push({
      id: '6f2b8c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b',
      lastModifiedDateTime: new Date(Date.now() + 1000).toISOString(),
      documentNumber: o.number,
      serviceItemLineNumber: 10000,
      resourceNumber: 'R0001',
      allocationDate: '2026-11-18',
      startingTime: '08:00:00',
      finishingTime: '11:30:00',
      allocatedHours: 3.5,
      status: 'Active',
      monteurAppId: '00000000-0000-0000-0000-000000000000',
    });
    await sync.runAll();
    const r = await owner.query(
      "select planned_start, planned_end from assignment where bc_allocation_id = '6f2b8c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b'",
    );
    expect(r.rows).toHaveLength(1);
    expect(new Date(r.rows[0].planned_start).toISOString()).toBe('2026-11-18T07:00:00.000Z'); // 08:00 CET
  });

  it('marks orders deleted in BC and recognises posted invoices', async () => {
    const del = state.tables.serviceOrders.at(-1)!;
    await post('/__mock/delete', { entitySet: 'serviceOrders', id: del.id });
    const billed = state.tables.serviceOrders.find((x) => x.status === 'Finished')!;
    state.tables.postedServiceInvoices.push({
      id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      lastModifiedDateTime: new Date(Date.now() + 1000).toISOString(),
      number: 'SR-000123',
      orderNumber: billed.number,
      postingDate: '2026-11-17',
      customerNumber: String(billed.customerNumber),
    });
    await sync.runAll();
    expect(
      (await owner.query('select deleted_in_bc_at from service_order where bc_no = $1', [del.number])).rows[0]
        .deleted_in_bc_at,
    ).not.toBeNull();
    expect(
      (await owner.query('select app_status from service_order where bc_no = $1', [billed.number])).rows[0]
        .app_status,
    ).toBe('ABGERECHNET');
  });

  it('records BC errors per entity without aborting the run', async () => {
    await post('/__mock/failures', {
      remaining: 20,
      status: 400,
      code: 'BadRequest',
      pathContains: 'customers',
    });
    const stats = await sync.runAll();
    expect(stats.customers).toBeUndefined();
    expect(stats.serviceOrders).toBeDefined();
    const c = await owner.query("select last_error from bc_sync_cursor where entity = 'customers'");
    expect(c.rows[0].last_error).toContain('400');
    state.failures = [];
  });
});

it('worker role cannot be impersonated by the API role', async () => {
  const c = new pg.Client({ connectionString: process.env.TEST_API_DATABASE_URL });
  await c.connect();
  const r = await c.query('select count(*)::int as n from service_order');
  await c.end();
  expect(r.rows[0].n).toBe(0);
  expect(SEED_COMPANY.id).toBeTruthy();
});

it('survives the database dropping the lock connection during a sync run', async () => {
  const { db, pool } = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  const admin = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await admin.connect();
  try {
    const s = new BcSyncService(db, () => {
      throw new Error('no BC');
    });
    const run = s.runAll().catch(() => undefined);
    // kill the worker's connections while the run holds the advisory lock
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where usename = 'monteur_worker_test' and pid <> pg_backend_pid()",
    );
    await run;
    await new Promise((r) => setTimeout(r, 200));
    // Process still alive and the lock is free again: the next run gets past the lock and reaches BC
    // (a stuck lock would return {} immediately without calling BC).
    await expect(s.runAll()).rejects.toThrow('no BC');
  } finally {
    await admin.end();
    await pool.end();
  }
});
