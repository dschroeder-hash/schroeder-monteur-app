import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc, type CommandType, type SyncCommand } from '@schroeder/shared';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

const TZ = 'Europe/Berlin';
// Yesterday (local) – stamp times must not lie in the future.
const DAY = addDays(localDate(new Date(), TZ), -1);
const at = (time: string, date = DAY) => zonedToUtc(date, time, TZ).toISOString();

let app: NestExpressApplication;
let owner: pg.Client;
let token: string;
let userId: string;
let orders: string[];
let seq = 0;

const cmd = (
  type: CommandType,
  time: string,
  payload: Record<string, unknown> = {},
  date = DAY,
): SyncCommand => ({
  id: randomUUID(),
  type,
  deviceTime: at(time, date),
  deviceSeq: ++seq,
  payload,
});
const push = (commands: SyncCommand[], deviceNow = new Date().toISOString(), t = token) =>
  api(app)
    .post('/v1/sync/push')
    .set('Authorization', `Bearer ${t}`)
    .send({ deviceId: 'test-device-01', deviceNow, commands });
const pull = (cursor?: string) =>
  api(app)
    .get(`/v1/sync/pull${cursor ? `?cursor=${cursor}` : ''}`)
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  token = await tokenFor(app, 'monteur-wild');
  userId = (await owner.query('select id from app_user where entra_oid = $1', [persona('monteur-wild').oid]))
    .rows[0].id;
  // Self-contained preconditions (test files share one database and run in varying order):
  // three fresh WILD orders, assigned to this Monteur, in status "Eingeplant".
  const wild = (await owner.query("select id from location where code = 'WILD'")).rows[0].id;
  orders = (
    await owner.query(
      "select id from service_order where location_id = $1 and bc_status = 'Pending' and not exists (select 1 from time_entry te where te.order_id = service_order.id) order by bc_no limit 3",
      [wild],
    )
  ).rows.map((r) => r.id);
  expect(orders).toHaveLength(3);
  await owner.query("update service_order set app_status = 'EINGEPLANT' where id = any($1)", [orders]);
  for (const o of orders)
    await owner.query(
      "insert into assignment (order_id, location_id, user_id, planned_start, planned_end) values ($1, $2, $3, now(), now() + interval '2 hours')",
      [o, wild, userId],
    );
  orders.sort();
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

describe('offline working day → sync (acceptance 5.1)', () => {
  let batch: SyncCommand[];
  it('applies the whole day in device order', async () => {
    const [A, B, C] = orders as [string, string, string];
    batch = [
      cmd('StampClockIn', '07:00'),
      cmd('StampJobStart', '07:00', { orderId: A, activity: 'TRAVEL' }),
      cmd('StampJobStart', '07:30', { orderId: A, activity: 'WORK' }),
      cmd('StampJobStart', '09:45', { orderId: B, activity: 'TRAVEL' }),
      cmd('StampJobStart', '10:10', { orderId: B, activity: 'WORK' }),
      cmd('StampBreakStart', '12:00'),
      cmd('StampBreakStop', '12:30'),
      cmd('StampJobStart', '13:15', { orderId: C, activity: 'WORK' }),
      cmd('StampJobStop', '15:50', { orderId: C }),
      cmd('StampClockOut', '16:00'),
    ];
    // Shuffled transmission must not matter – the server sorts by device sequence.
    const res = await push([...batch].reverse());
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual(Array(10).fill('applied'));
  });

  it('a replay of the same batch creates no duplicates', async () => {
    const res = await push(batch);
    expect(res.body.results.every((r: { result: string }) => r.result === 'duplicate')).toBe(true);
    const n = await owner.query('select count(*)::int as n from stamp_event where id = any($1)', [
      batch.map((c) => c.id),
    ]);
    expect(n.rows[0].n).toBe(10);
  });

  it('derives correct attendance and order times with quarter-hour billing', async () => {
    const [A, B, C] = orders as [string, string, string];
    const rows = (
      await owner.query(
        'select kind, order_id, activity, sum(actual_minutes)::int as actual, sum(billable_minutes)::int as billable from time_entry where user_id = $1 and work_date = $2 group by 1,2,3',
        [userId, DAY],
      )
    ).rows;
    const get = (kind: string, o: string | null, a: string | null) =>
      rows.find((r) => r.kind === kind && r.order_id === o && r.activity === a);
    expect(get('ATTENDANCE', null, null).actual).toBe(540);
    expect(get('BREAK', null, null).actual).toBe(30);
    expect(get('ORDER', A, 'TRAVEL')).toMatchObject({ actual: 30, billable: 30 });
    expect(get('ORDER', A, 'WORK')).toMatchObject({ actual: 135, billable: 135 });
    expect(get('ORDER', B, 'TRAVEL')).toMatchObject({ actual: 25, billable: 30 });
    expect(get('ORDER', B, 'WORK')).toMatchObject({ actual: 155, billable: 150 });
    expect(get('ORDER', C, 'WORK')).toMatchObject({ actual: 155, billable: 150 });
  });

  it('sets order status automatically when stamping starts', async () => {
    const r = await owner.query('select app_status from service_order where id = $1', [orders[2]]);
    expect(r.rows[0].app_status).toBe('IN_ARBEIT');
    const ev = await owner.query(
      "select source from order_status_event where order_id = $1 and to_status = 'IN_ARBEIT'",
      [orders[2]],
    );
    expect(ev.rows[0].source).toBe('STEMPELUNG');
  });

  it('a late correction event recomputes the day (still open)', async () => {
    const res = await push([cmd('StampBreakStart', '14:00'), cmd('StampBreakStop', '14:20')]);
    expect(res.body.results.every((r: { result: string }) => r.result === 'applied')).toBe(true);
    const b = await owner.query(
      "select sum(actual_minutes)::int as m from time_entry where user_id = $1 and work_date = $2 and kind = 'BREAK'",
      [userId, DAY],
    );
    expect(b.rows[0].m).toBe(50);
    const c = await owner.query(
      'select sum(actual_minutes)::int as m from time_entry where user_id = $1 and work_date = $2 and order_id = $3',
      [userId, DAY, orders[2]],
    );
    expect(c.rows[0].m).toBe(135); // C resumed after the break: 13:15–14:00 + 14:20–15:50
  });
});

describe('rules and conflicts', () => {
  it('rejects stamping on an order of a colleague', async () => {
    const other = (
      await owner.query(
        "select o.id from service_order o join location l on l.id = o.location_id where l.code = 'CLP' limit 1",
      )
    ).rows[0].id;
    const res = await push([
      cmd('StampJobStart', '08:00', { orderId: other, activity: 'WORK' }, addDays(DAY, -1)),
    ]);
    expect(res.body.results[0]).toMatchObject({ result: 'rejected' });
    expect(res.body.results[0].reason).toContain('nicht zugewiesen');
  });

  it('accepts time on an order that was reassigned while offline, with a warning', async () => {
    const order = orders[0]!;
    await owner.query('update assignment set cancelled_at = now() where order_id = $1 and user_id = $2', [
      order,
      userId,
    ]);
    try {
      const d = addDays(DAY, -2);
      const res = await push([
        cmd('StampJobStart', '08:00', { orderId: order, activity: 'WORK' }, d),
        cmd('StampClockOut', '09:00', {}, d),
      ]);
      expect(res.body.results[0].result).toBe('applied');
      expect(res.body.results[0].warnings[0]).toContain('nicht mehr zugewiesen');
    } finally {
      await owner.query('update assignment set cancelled_at = null where order_id = $1 and user_id = $2', [
        order,
        userId,
      ]);
    }
  });

  it('flags events of a device with a wrong clock', async () => {
    const d = addDays(DAY, -3);
    const tenMinutesBehind = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await push(
      [cmd('StampClockIn', '06:00', {}, d), cmd('StampClockOut', '07:00', {}, d)],
      tenMinutesBehind,
    );
    expect(res.body.skewFlagged).toBe(true);
    const e = await owner.query(
      "select skew_flag from time_entry where user_id = $1 and work_date = $2 and kind = 'ATTENDANCE'",
      [userId, d],
    );
    expect(e.rows[0].skew_flag).toBe(true);
  });

  it('monteur may set allowed statuses but not approve', async () => {
    const order = orders[1]!;
    const ok = await push([cmd('SetOrderStatus', '16:00', { orderId: order, status: 'WARTET_TEILE' })]);
    expect(ok.body.results[0].result).toBe('applied');
    const no = await push([cmd('SetOrderStatus', '16:01', { orderId: order, status: 'FREIGEGEBEN' })]);
    expect(no.body.results[0].result).toBe('rejected');
  });

  it('rejects stamping when the module is disabled for the location', async () => {
    const admin = await tokenFor(app, 'admin');
    const wild = (await owner.query("select id from location where code = 'WILD'")).rows[0].id;
    await api(app)
      .put('/v1/admin/features')
      .set('Authorization', `Bearer ${admin}`)
      .send({ locationId: wild, feature: 'stamping', enabled: false });
    try {
      // FeatureService caches for 15 s – use a fresh app instance to observe the change immediately.
      const fresh = await createTestApp();
      const t = await tokenFor(fresh, 'monteur-wild');
      const res = await api(fresh)
        .post('/v1/sync/push')
        .set('Authorization', `Bearer ${t}`)
        .send({
          deviceId: 'test-device-01',
          deviceNow: new Date().toISOString(),
          commands: [cmd('StampClockIn', '05:00', {}, addDays(DAY, -4))],
        });
      expect(res.body.results[0].result).toBe('rejected');
      await fresh.close();
    } finally {
      await api(app)
        .put('/v1/admin/features')
        .set('Authorization', `Bearer ${admin}`)
        .send({ locationId: wild, feature: 'stamping', enabled: true });
    }
  });

  it('rejects invalid payloads per command', async () => {
    const res = await push([cmd('StampJobStart', '08:00', { orderId: 'kaputt' })]);
    expect(res.body.results[0]).toMatchObject({ result: 'rejected', reason: 'Ungültige Daten im Befehl' });
  });
});

describe('pull', () => {
  it('initial snapshot contains only own orders, assignments and time', async () => {
    const res = await pull();
    expect(res.status).toBe(200);
    expect(res.body.full).toBe(true);
    expect(res.body.cursor).toMatch(/^\d+$/);
    const assigned = new Set(orders);
    // Own orders: assigned (not cancelled) or stamped on – an assignment may have been cancelled by the BC sync of
    // another test file, the own times keep the order visible (RLS policy service_order_select).
    const mineInDb = new Set(
      (
        await owner.query(
          `select order_id from assignment where user_id = $1 and cancelled_at is null
           union select order_id from time_entry where user_id = $1 and order_id is not null`,
          [userId],
        )
      ).rows.map((r: { order_id: string }) => r.order_id),
    );
    for (const o of res.body.orders) expect(mineInDb.has(o.id)).toBe(true);
    expect(res.body.orders.some((o: { id: string }) => assigned.has(o.id))).toBe(true);
    expect(res.body.timeEntries.every((e: { userId: string }) => e.userId === userId)).toBe(true);
    expect(res.body.orders[0].items[0].machine).toBeTruthy();
    expect(res.body.location.timezone).toBe('Europe/Berlin');
  });

  it('incremental pull returns only changes since the cursor', async () => {
    const first = await pull();
    const again = await pull(first.body.cursor);
    expect(again.body.stampEvents).toEqual([]);
    const d = addDays(DAY, -5);
    await push([cmd('StampClockIn', '07:00', {}, d), cmd('StampClockOut', '08:00', {}, d)]);
    const delta = await pull(first.body.cursor);
    expect(delta.body.stampEvents).toHaveLength(2);
    expect(delta.body.timeEntryKeysByDay[d]).toHaveLength(1);
  });

  it('does not skip a change committed after the pull started (gap-free cursor)', async () => {
    const order = orders[2]!;
    const slow = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
    await slow.connect();
    try {
      await slow.query('begin');
      await slow.query("update service_order set description = 'Langsame Transaktion' where id = $1", [
        order,
      ]);
      const during = await pull(); // runs while the write is uncommitted
      await slow.query('commit');
      expect(during.body.orders.find((o: { id: string }) => o.id === order)?.description).not.toBe(
        'Langsame Transaktion',
      );
      const after = await pull(during.body.cursor);
      expect(after.body.orders.find((o: { id: string }) => o.id === order)?.description).toBe(
        'Langsame Transaktion',
      );
    } finally {
      await slow.end();
    }
  });
});
