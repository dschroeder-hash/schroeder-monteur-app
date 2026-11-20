/** Phase 7: productivity – own view, team view, feature flags, snapshots, admin mapping. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { FeatureService } from '../src/features/feature.service.js';
import { snapshotProductivity } from '../src/jobs.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

async function entry(
  day: string,
  kind: string,
  minutes: number,
  extra: { orderId?: string; activity?: string; overhead?: string; state?: string } = {},
) {
  await q(
    `insert into time_entry (user_id, location_id, work_date, kind, order_id, activity, overhead_code, start_at, end_at,
       actual_minutes, billable_minutes, state)
     values ($1, $2, $3, $4, $5, $6, $7, $3::date + time '07:00', $3::date + time '07:00' + make_interval(mins => $8),
       $8, $9, $10)`,
    [
      ids['monteur-wild'],
      ids.location,
      day,
      kind,
      extra.orderId ?? null,
      extra.activity ?? (kind === 'ORDER' ? 'WORK' : null),
      extra.overhead ?? null,
      minutes,
      kind === 'ORDER' ? minutes : null,
      extra.state ?? 'APPROVED',
    ],
  );
}

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  for (const p of ['monteur-wild', 'monteur2-wild', 'meister-wild', 'meister-clp', 'admin', 'personal']) {
    t[p] = await tokenFor(app, p);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  ids.location = (await q("select id from location where code = 'WILD'"))[0].id;
  const orders = await q(
    'select id from service_order where location_id = $1 and deleted_in_bc_at is null order by bc_no limit 3',
    [ids.location],
  );
  ids.a = orders[0].id;
  ids.b = orders[1].id;
  ids.c = orders[2].id;
  await q("update service_order set order_type_code = 'KUNDE', rework_flag = false where id = $1", [ids.a]);
  await q("update service_order set order_type_code = 'INTWART', rework_flag = false where id = $1", [ids.b]);
  await q("update service_order set order_type_code = 'GEBR', rework_flag = false where id = $1", [ids.c]);
  await q("delete from time_entry where work_date between '2026-10-01' and '2026-10-31'");
  await q('delete from productivity_snapshot');
  await q("delete from feature_flag where feature like 'productivity.%'");
  app.get(FeatureService).invalidate();

  // 5 Oct: 540 present − 30 break − 30 training = 480; productive 300 work + 60 travel (KUNDE)
  await entry('2026-10-05', 'ATTENDANCE', 540);
  await entry('2026-10-05', 'BREAK', 30);
  await entry('2026-10-05', 'ORDER', 300, { orderId: ids.a });
  await entry('2026-10-05', 'ORDER', 60, { orderId: ids.a, activity: 'TRAVEL' });
  await entry('2026-10-05', 'OVERHEAD', 30, { overhead: 'SCHULUNG' });
  // 6 Oct: 480 − 30 = 450; productive 240 (INTWART, internal), not productive 120 (GEBR)
  await entry('2026-10-06', 'ATTENDANCE', 480, { state: 'TRANSFERRED' });
  await entry('2026-10-06', 'BREAK', 30, { state: 'TRANSFERRED' });
  await entry('2026-10-06', 'ORDER', 240, { orderId: ids.b, state: 'TRANSFERRED' });
  await entry('2026-10-06', 'ORDER', 120, { orderId: ids.c, state: 'TRANSFERRED' });
  // 7 Oct: not approved yet → not counted
  await entry('2026-10-07', 'ATTENDANCE', 480, { state: 'SUBMITTED' });

  // Documentation: A finished 5 Oct, report complete 6 Oct (on time); C finished 6 Oct, no complete report
  await q('delete from work_report where order_id = any($1)', [[ids.a, ids.c]]);
  await q(
    "insert into order_status_event (order_id, from_status, to_status, actor_id, source, at) values ($1, 'IN_ARBEIT', 'FERTIG', $3, 'MONTEUR', '2026-10-05T14:00:00Z'), ($2, 'IN_ARBEIT', 'FERTIG_DOKU_OFFEN', $3, 'MONTEUR', '2026-10-06T15:00:00Z')",
    [ids.a, ids.c, ids['monteur-wild']],
  );
  await q(
    "insert into work_report (id, order_id, author_id, body, complete, completed_at) values (gen_random_uuid(), $1, $2, 'Bericht', true, '2026-10-06T08:00:00Z')",
    [ids.a, ids['monteur-wild']],
  );
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
});

describe('own view (Monteur)', () => {
  it('calculates the month according to the mapping', async () => {
    const res = await api(app).get('/v1/productivity/me?month=2026-10').set(as('monteur-wild')).expect(200);
    const r = res.body.current;
    expect(r).toMatchObject({
      month: '2026-10',
      attendanceMinutes: 930,
      productiveMinutes: 600,
      externalMinutes: 360,
      productivity: 0.6452,
      productivityExternal: 0.3871,
      travelShare: 0.0645,
      rating: 'BELOW',
      pendingDays: 1,
      approvedDays: 2,
      target: { min: 0.8, max: 0.85 },
      documentation: { finished: 2, onTime: 1, quota: 0.5 },
      snapshot: false,
    });
    expect(r.byCategory.KUNDENSERVICE.minutes).toBe(360);
    expect(r.byCategory.WARTUNG_INTERN.minutes).toBe(240);
    expect(r.byCategory.INTERN_SONSTIGE.minutes).toBe(120);
    expect(res.body.previous.month).toBe('2026-09');
    expect(res.body.trend).toHaveLength(12);
    expect(res.body.trend.at(-1)).toMatchObject({ month: '2026-10', productivity: 0.6452 });
  });

  it('a colleague sees only his own (empty) values', async () => {
    const res = await api(app).get('/v1/productivity/me?month=2026-10').set(as('monteur2-wild')).expect(200);
    expect(res.body.current.attendanceMinutes).toBe(0);
    expect(res.body.current.productivity).toBeNull();
  });

  it('rejects future months', async () => {
    await api(app).get('/v1/productivity/me?month=2099-01').set(as('monteur-wild')).expect(400);
  });
});

describe('team view (Meister)', () => {
  it('per Monteur of the location plus location total (from minute sums)', async () => {
    const res = await api(app)
      .get(`/v1/productivity/team?locationId=${ids.location}&month=2026-10`)
      .set(as('meister-wild'))
      .expect(200);
    const row = res.body.monteure.find((m: { userId: string }) => m.userId === ids['monteur-wild']);
    expect(row.current.productivity).toBe(0.6452);
    expect(res.body.monteure.some((m: { userId: string }) => m.userId === ids['meister-wild'])).toBe(false);
    expect(res.body.total).toMatchObject({
      attendanceMinutes: 930,
      productiveMinutes: 600,
      productivity: 0.6452,
    });
  });

  it('other location → 403', async () => {
    await api(app).get(`/v1/productivity/team?locationId=${ids.location}`).set(as('meister-clp')).expect(403);
  });
});

describe('works council feature flags (BetrVG § 87)', () => {
  // Directly in the table (the audited admin endpoint is covered by admin.test.ts) + cache invalidation.
  const flag = async (feature: string, enabled: boolean) => {
    await q('delete from feature_flag where location_id = $1 and feature = $2', [ids.location, feature]);
    if (!enabled)
      await q('insert into feature_flag (location_id, feature, enabled) values ($1, $2, false)', [
        ids.location,
        feature,
      ]);
    app.get(FeatureService).invalidate();
  };

  it('own view and team view can be switched off separately', async () => {
    await flag('productivity.self', false);
    const r = await api(app).get('/v1/productivity/me').set(as('monteur-wild')).expect(403);
    expect(r.body.message).toMatch(/nicht freigeschaltet/);
    await api(app)
      .get(`/v1/productivity/team?locationId=${ids.location}`)
      .set(as('meister-wild'))
      .expect(200);
    await flag('productivity.self', true);
    await flag('productivity.team', false);
    await api(app)
      .get(`/v1/productivity/team?locationId=${ids.location}`)
      .set(as('meister-wild'))
      .expect(403);
    await api(app).get('/v1/productivity/me').set(as('monteur-wild')).expect(200);
    await flag('productivity.team', true);
  });
});

describe('monthly snapshots (basis for a later bonus system)', () => {
  it('previous month is recalculated until the 10th, then frozen', async () => {
    expect(await snapshotProductivity(workerDb.db, new Date('2026-11-05T10:00:00Z'))).toBeGreaterThan(0);
    const [snap] = await q(
      "select result, mapping_version, config_hash from productivity_snapshot where user_id = $1 and month = '2026-10-01'",
      [ids['monteur-wild']],
    );
    expect(snap.result.productivity).toBe(0.6452);
    expect(snap.mapping_version).toBe('2020-01-01');
    expect(snap.config_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(await snapshotProductivity(workerDb.db, new Date('2026-11-15T10:00:00Z'))).toBe(0);
  });

  it('a closed month is served from the snapshot – later changes do not alter it', async () => {
    await q("update time_entry set state = 'APPROVED' where work_date = '2026-10-07' and user_id = $1", [
      ids['monteur-wild'],
    ]);
    const res = await api(app).get('/v1/productivity/me?month=2026-10').set(as('monteur-wild')).expect(200);
    expect(res.body.current).toMatchObject({ snapshot: true, productivity: 0.6452, attendanceMinutes: 930 });
  });

  it('only the worker may write snapshots (RLS)', async () => {
    const c = new pg.Client({ connectionString: process.env.TEST_API_DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(
        "select set_config('app.user_id', $1, true), set_config('app.roles', 'Werkstatt.Monteur', true)",
        [ids['monteur-wild']],
      );
      await expect(
        c.query(
          "update productivity_snapshot set result = jsonb_set(result, '{productivity}', '0.99') where user_id = $1",
          [ids['monteur-wild']],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.end();
    }
  });
});

describe('administration of mapping and target corridor', () => {
  it('lists mapping versions and BC order types; Admin sees no individual values', async () => {
    const res = await api(app).get('/v1/admin/productivity').set(as('admin')).expect(200);
    expect(res.body.mapping.some((m: { orderTypeCode: string }) => m.orderTypeCode === 'INTWART')).toBe(true);
    expect(res.body.orderTypes.length).toBeGreaterThan(0);
    expect(res.body.config).toMatchObject({ targetMin: 0.8, targetMax: 0.85 });
    await api(app).get('/v1/productivity/me').set(as('admin')).expect(403);
  });

  it('closed months cannot be remapped; new versions apply from their date', async () => {
    const body = { orderTypeCode: 'GEBR', category: 'INTERN_SONSTIGE', productive: true, external: false };
    const r = await api(app)
      .post('/v1/admin/productivity/mapping')
      .set(as('admin'))
      .send({ ...body, validFrom: '2026-10-01' })
      .expect(400);
    expect(r.body.message).toMatch(/abgeschlossenen Monat/);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    await api(app)
      .post('/v1/admin/productivity/mapping')
      .set(as('admin'))
      .send({ ...body, validFrom: today })
      .expect(201);
    expect((await q("select action from audit_log where action = 'SET_ORDER_TYPE_MAPPING'")).length).toBe(1);
    // October is unchanged (GEBR still not productive there)
    await q('delete from productivity_snapshot');
    const oct = await api(app).get('/v1/productivity/me?month=2026-10').set(as('monteur-wild')).expect(200);
    expect(oct.body.current.byCategory.INTERN_SONSTIGE.productive).toBe(false);
  });

  it('target corridor is configurable', async () => {
    await api(app)
      .put('/v1/admin/productivity/config')
      .set(as('admin'))
      .send({ targetMin: 0.9, targetMax: 0.8, legacyMaintenanceRule: false })
      .expect(400);
    await api(app)
      .put('/v1/admin/productivity/config')
      .set(as('admin'))
      .send({ targetMin: 0.6, targetMax: 0.7, legacyMaintenanceRule: false })
      .expect(200);
    const res = await api(app).get('/v1/productivity/me?month=2026-10').set(as('monteur-wild')).expect(200);
    expect(res.body.current.target).toEqual({ min: 0.6, max: 0.7 });
    await api(app)
      .put('/v1/admin/productivity/config')
      .set(as('admin'))
      .send({ targetMin: 0.8, targetMax: 0.85, legacyMaintenanceRule: false })
      .expect(200);
  });
});
