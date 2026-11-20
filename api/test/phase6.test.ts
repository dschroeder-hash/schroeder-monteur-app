/** Phase 6: sick reports, vacation workflow, team calendar without reasons, planning board, BC transfer. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandType } from '@schroeder/shared';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createDb } from '../src/db/client.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';
import { TEST_NOW } from './constants.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW });
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let worker: BcTransferWorker;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
let seq = 12000;

const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (who: string, type: CommandType, payload: Record<string, unknown>, id: string = randomUUID()) =>
  api(app)
    .post('/v1/sync/push')
    .set(as(who))
    .send({
      deviceId: `phase6-${who}`,
      deviceNow: new Date().toISOString(),
      commands: [{ id, type, deviceTime: new Date().toISOString(), deviceSeq: ++seq, payload }],
    });
const bcAbsences = (employee: string) =>
  state.tables.employeeAbsences.filter((r) => r.employeeNumber === employee);
const notifications = async (who: string, kind: string) =>
  q('select title, body from notification where user_id = $1 and kind = $2 order by created_at', [
    ids[who],
    kind,
  ]);

/** Reads rows as a given user through RLS (role monteur_app + session GUCs). */
async function asUser(who: string, roles: string, sql: string) {
  const c = new pg.Client({ connectionString: process.env.TEST_API_DATABASE_URL });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.roles', $2, true)", [
      ids[who],
      roles,
    ]);
    return (await c.query(sql)).rows;
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  worker = new BcTransferWorker(
    workerDb.db,
    (companyId) =>
      new BcClient({
        apiBaseUrl: `${base}/api`,
        tokenUrl: `${base}/oauth2/token`,
        clientId: 'x',
        clientSecret: 'y',
        scope: 'z',
        companyId,
        backoffBaseMs: 1,
        maxRetries: 0,
      }),
  );
  for (const p of ['monteur-wild', 'monteur2-wild', 'meister-wild', 'meister-clp', 'personal', 'admin']) {
    t[p] = await tokenFor(app, p);
    // The first request records the Entra roles (needed to notify Personal).
    await api(app).get('/v1/me').set(as(p)).expect(200);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  ids.location = (await q("select id from location where code = 'WILD'"))[0].id;
  await q("update bc_transfer set state = 'DONE'");
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

describe('sick report', () => {
  it('is reported offline in one command; Meister and Personal are notified', async () => {
    const [a] = await q(
      `select a.id, a.order_id, (a.planned_start at time zone l.timezone)::date::text as day
       from assignment a join location l on l.id = a.location_id
       where a.user_id = $1 and a.cancelled_at is null order by a.planned_start limit 1`,
      [ids['monteur-wild']],
    );
    ids.sickAssignment = a.id;
    ids.sickOrder = a.order_id;
    ids.sickFrom = a.day;
    ids.sick = randomUUID();
    const res = await push(
      'monteur-wild',
      'ReportSick',
      { fromDate: a.day, toDate: null, comment: 'Bitte nicht anrufen' },
      ids.sick,
    ).expect(200);
    expect(res.body.results[0].result).toBe('applied');
    const [row] = await q('select type, state, to_date from absence where id = $1', [ids.sick]);
    expect(row).toMatchObject({ type: 'KRANK', state: 'REPORTED', to_date: null });
    expect((await notifications('meister-wild', 'SICK_REPORT')).at(-1)!.body).toMatch(/neu einplanen/);
    expect(await notifications('personal', 'SICK_REPORT')).toHaveLength(1);
    expect(await notifications('meister-clp', 'SICK_REPORT')).toHaveLength(0);
  });

  it('is idempotent and rejects a second overlapping sick report', async () => {
    const replay = await push('monteur-wild', 'ReportSick', { fromDate: ids.sickFrom }, ids.sick);
    expect(replay.body.results[0].result).toBe('duplicate');
    const again = await push('monteur-wild', 'ReportSick', { fromDate: ids.sickFrom });
    expect(again.body.results[0]).toMatchObject({ result: 'rejected' });
    expect(again.body.results[0].reason).toMatch(/bereits eine Krankmeldung/);
  });

  it('marks the assigned orders in the period as "neu einplanen" on the planning board', async () => {
    const from = new Date(`${ids.sickFrom}T00:00:00Z`);
    const res = await api(app)
      .get('/v1/planning/board')
      .query({
        locationId: ids.location,
        from: from.toISOString(),
        to: new Date(from.getTime() + 2 * 86_400_000).toISOString(),
      })
      .set(as('meister-wild'))
      .expect(200);
    const order = res.body.unplanned.find((o: { id: string }) => o.id === ids.sickOrder);
    expect(order?.needsReplan).toBe(true);
    const asg = res.body.assignments.find((x: { id: string }) => x.id === ids.sickAssignment);
    expect(asg.conflicts.map((c: { kind: string }) => c.kind)).toContain('SICK');
    const ab = res.body.absences.find((x: { userId: string }) => x.userId === ids['monteur-wild']);
    expect(ab).toMatchObject({ type: 'KRANK' });
    expect(ab.comment).toBeUndefined();
  });

  it('shows in the Meister inbox; acknowledged without end date nothing goes to BC yet', async () => {
    const inbox = await api(app)
      .get('/v1/approvals/inbox')
      .query({ locationId: ids.location })
      .set(as('meister-wild'))
      .expect(200);
    const item = inbox.body.absences.find((x: { id: string }) => x.id === ids.sick);
    expect(item).toMatchObject({ type: 'KRANK', userName: expect.any(String) });
    expect(item.affectedAssignments).toBeGreaterThan(0);
    await api(app).post(`/v1/absences/${ids.sick}/acknowledge`).set(as('meister-wild')).expect(200);
    expect(await q('select id from bc_transfer where subject_id = $1', [ids.sick])).toHaveLength(0);
    // other location's Meister: 404, no information leak
    await api(app).post(`/v1/absences/${ids.sick}/acknowledge`).set(as('meister-clp')).expect(404);
  });

  it('end date by the Monteur → acknowledged again → transferred to BC as KRANK without the comment', async () => {
    ids.sickTo = addDays(ids.sickFrom, 2);
    const upd = await push('monteur-wild', 'UpdateSickEnd', {
      absenceId: ids.sick,
      toDate: ids.sickTo,
    }).expect(200);
    expect(upd.body.results[0].result).toBe('applied');
    // back in the Meister inbox; BC only after the acknowledgement
    await worker.runOnce();
    expect(bcAbsences('M0001')).toHaveLength(0);
    await api(app).post(`/v1/absences/${ids.sick}/acknowledge`).set(as('meister-wild')).expect(200);
    await worker.runOnce();
    const rows = bcAbsences('M0001').filter((r) => r.causeOfAbsenceCode === 'KRANK');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromDate: ids.sickFrom, toDate: ids.sickTo });
    expect(String(rows[0]!.description)).not.toContain('anrufen');
  });

  it('a changed end date replaces the BC entry (delete + create), no duplicates', async () => {
    const longer = addDays(ids.sickFrom, 7);
    await api(app)
      .post(`/v1/absences/${ids.sick}/end`)
      .set(as('personal'))
      .send({ toDate: longer })
      .expect(200);
    await worker.runOnce();
    const rows = bcAbsences('M0001').filter((r) => r.causeOfAbsenceCode === 'KRANK');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toDate).toBe(longer);
    expect(
      await q("select action from audit_log where entity_id = $1 and action = 'CHANGE_SICK_END'", [ids.sick]),
    ).toHaveLength(1);
  });

  it('Meister can record a sick report on behalf of a Monteur', async () => {
    const res = await api(app)
      .post('/v1/absences/sick')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur2-wild'], fromDate: '2027-02-01', toDate: '2027-02-02' })
      .expect(201);
    await worker.runOnce();
    expect(bcAbsences('M0002').some((r) => r.fromDate === '2027-02-01' && r.quantity === 2)).toBe(true);
    expect((await notifications('monteur2-wild', 'SICK_REPORT')).at(-1)!.title).toBe('Krankmeldung erfasst');
    ids.sick2 = res.body.id;
  });
});

describe('vacation', () => {
  it('Personal maintains the entitlement; the Monteur receives it with the sync pull', async () => {
    await api(app)
      .put('/v1/absences/balances')
      .set(as('personal'))
      .send({ userId: ids['monteur-wild'], year: 2027, entitlementDays: 30, carryOverDays: 2 })
      .expect(200);
    await api(app)
      .put('/v1/absences/balances')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur-wild'], year: 2027, entitlementDays: 99, carryOverDays: 0 })
      .expect(403);
    const list = await api(app).get('/v1/absences/balances?year=2027').set(as('meister-clp')).expect(200);
    expect(list.body.some((u: { userId: string }) => u.userId === ids['monteur-wild'])).toBe(false);
    const all = await api(app).get('/v1/absences/balances?year=2027').set(as('personal')).expect(200);
    expect(all.body.find((u: { userId: string }) => u.userId === ids['monteur-wild'])).toMatchObject({
      entitlement: 30,
      carryOver: 2,
    });
    const pull = await api(app).get('/v1/sync/pull').set(as('monteur-wild')).expect(200);
    expect(pull.body.vacationBalances).toContainEqual({ year: 2027, entitlementDays: 30, carryOverDays: 2 });
    expect(pull.body.absences.some((a: { id: string }) => a.id === ids.sick)).toBe(true);
  });

  it('request → reject needs a reason → rejected with push to the applicant', async () => {
    ids.vac1 = randomUUID();
    await push(
      'monteur-wild',
      'RequestVacation',
      { fromDate: '2027-03-01', toDate: '2027-03-05' },
      ids.vac1,
    ).expect(200);
    const inbox = await api(app)
      .get('/v1/approvals/inbox')
      .query({ locationId: ids.location })
      .set(as('meister-wild'))
      .expect(200);
    const item = inbox.body.absences.find((x: { id: string }) => x.id === ids.vac1);
    expect(item).toMatchObject({
      type: 'URLAUB',
      days: 5,
      balance: { entitlement: 30, requested: 5, remaining: 27 },
    });
    await api(app)
      .post(`/v1/absences/${ids.vac1}/decision`)
      .set(as('meister-wild'))
      .send({ decision: 'REJECT' })
      .expect(400);
    await api(app)
      .post(`/v1/absences/${ids.vac1}/decision`)
      .set(as('meister-wild'))
      .send({ decision: 'REJECT', reason: 'Erntezeit, bitte eine Woche später' })
      .expect(200);
    expect((await q('select state, decision_reason from absence where id = $1', [ids.vac1]))[0]).toEqual({
      state: 'REJECTED',
      decision_reason: 'Erntezeit, bitte eine Woche später',
    });
    expect((await notifications('monteur-wild', 'VACATION_DECISION')).at(-1)).toMatchObject({
      title: 'Urlaub abgelehnt',
    });
    expect(await q('select id from bc_transfer where subject_id = $1', [ids.vac1])).toHaveLength(0);
  });

  it('an open-ended sick report does not block a later vacation request', async () => {
    const id = randomUUID();
    const s = await push('monteur2-wild', 'ReportSick', { fromDate: '2026-11-16' }, id).expect(200);
    expect(s.body.results[0]).toMatchObject({ result: 'applied' });
    const v = await push('monteur2-wild', 'RequestVacation', {
      fromDate: '2027-06-07',
      toDate: '2027-06-07',
    });
    expect(v.body.results[0].result).toBe('applied');
    const clash = await push('monteur2-wild', 'RequestVacation', {
      fromDate: '2026-11-17',
      toDate: '2026-11-17',
    });
    expect(clash.body.results[0].result).toBe('rejected');
  });

  it('half days only for a single day; overlapping requests are rejected', async () => {
    const half = await push('monteur-wild', 'RequestVacation', {
      fromDate: '2027-03-08',
      toDate: '2027-03-09',
      halfDay: 'AM',
    });
    expect(half.body.results[0].result).toBe('rejected');
    ids.vac2 = randomUUID();
    await push(
      'monteur-wild',
      'RequestVacation',
      { fromDate: '2027-03-08', toDate: '2027-03-12', comment: 'Hochzeit' },
      ids.vac2,
    ).expect(200);
    const clash = await push('monteur-wild', 'RequestVacation', {
      fromDate: '2027-03-10',
      toDate: '2027-03-10',
      halfDay: 'PM',
    });
    expect(clash.body.results[0].reason).toMatch(/bereits eine Abwesenheit/);
  });

  it('approval transfers to BC as URLAUB and blocks the planning board', async () => {
    await api(app)
      .post(`/v1/absences/${ids.vac2}/decision`)
      .set(as('meister-wild'))
      .send({ decision: 'APPROVE' })
      .expect(200);
    await worker.runOnce();
    const rows = bcAbsences('M0001').filter((r) => r.causeOfAbsenceCode === 'URLAUB');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromDate: '2027-03-08',
      toDate: '2027-03-12',
      quantity: 5,
      unitOfMeasureCode: 'TAG',
    });
    expect(String(rows[0]!.description)).not.toContain('Hochzeit');

    const [order] = await q(
      "select id from service_order where location_id = $1 and app_status = 'NEU' and deleted_in_bc_at is null limit 1",
      [ids.location],
    );
    const res = await api(app)
      .post('/v1/planning/assignments')
      .set(as('meister-wild'))
      .send({
        orderId: order.id,
        userId: ids['monteur-wild'],
        plannedStart: '2027-03-10T08:00:00+01:00',
        plannedEnd: '2027-03-10T12:00:00+01:00',
      })
      .expect(409);
    expect(res.body.message).toMatch(/genehmigten Urlaub/);
    expect(
      await q('select id from assignment where order_id = $1 and cancelled_at is null', [order.id]),
    ).toHaveLength(0);
  });

  it('colleagues see "abwesend" without type or comment – via API and enforced by RLS', async () => {
    const res = await api(app)
      .get('/v1/absences/team')
      .query({ from: '2027-03-01', to: '2027-03-31' })
      .set(as('monteur2-wild'))
      .expect(200);
    const mine = res.body.filter((x: { userId: string }) => x.userId === ids['monteur-wild']);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(['fromDate', 'halfDay', 'toDate', 'userId', 'userName']);
    // Direct table access as colleague: own absences only
    const rows = await asUser(
      'monteur2-wild',
      'Werkstatt.Monteur',
      'select user_id, type, comment from absence',
    );
    expect(rows.every((r) => r.user_id === ids['monteur2-wild'])).toBe(true);
    // Monteure cannot use the list with types
    await api(app)
      .get('/v1/absences')
      .query({ from: '2027-03-01', to: '2027-03-31' })
      .set(as('monteur-wild'))
      .expect(403);
  });

  it('Personal sees all locations with type; Meister only their own', async () => {
    const p = await api(app)
      .get('/v1/absences')
      .query({ from: '2026-11-01', to: '2027-06-30' })
      .set(as('personal'))
      .expect(200);
    const v = p.body.find((x: { id: string }) => x.id === ids.vac2);
    expect(v).toMatchObject({ type: 'URLAUB', state: 'APPROVED', days: 5, bcState: 'UEBERTRAGEN' });
    const clp = await api(app)
      .get('/v1/absences')
      .query({ from: '2026-11-01', to: '2027-06-30' })
      .set(as('meister-clp'))
      .expect(200);
    expect(clp.body.some((x: { id: string }) => x.id === ids.vac2)).toBe(false);
    await api(app)
      .get('/v1/absences')
      .query({ from: '2026-11-01', to: '2027-06-30', locationId: ids.location })
      .set(as('meister-clp'))
      .expect(403);
  });

  it('cancel request → Meister approves → BC entry deleted', async () => {
    const res = await push('monteur-wild', 'WithdrawVacation', { absenceId: ids.vac2 }).expect(200);
    expect(res.body.results[0].warnings[0]).toMatch(/Stornoantrag/);
    expect((await q('select state from absence where id = $1', [ids.vac2]))[0].state).toBe(
      'CANCEL_REQUESTED',
    );
    await api(app)
      .post(`/v1/absences/${ids.vac2}/decision`)
      .set(as('meister-wild'))
      .send({ decision: 'APPROVE' })
      .expect(200);
    await worker.runOnce();
    expect(bcAbsences('M0001').filter((r) => r.causeOfAbsenceCode === 'URLAUB')).toHaveLength(0);
    expect((await q('select state from absence where id = $1', [ids.vac2]))[0].state).toBe('CANCELLED');
    expect(await q('select 1 from team_absence where absence_id = $1', [ids.vac2])).toHaveLength(0);
  });

  it('withdrawing an open request cancels it directly', async () => {
    const id = randomUUID();
    await push(
      'monteur-wild',
      'RequestVacation',
      { fromDate: '2027-04-06', toDate: '2027-04-06', halfDay: 'PM' },
      id,
    ).expect(200);
    await push('monteur-wild', 'WithdrawVacation', { absenceId: id }).expect(200);
    expect((await q('select state from absence where id = $1', [id]))[0].state).toBe('CANCELLED');
    // someone else's absence cannot be withdrawn
    const other = await push('monteur2-wild', 'WithdrawVacation', { absenceId: ids.vac1 });
    expect(other.body.results[0].result).toBe('rejected');
  });

  it('missing BC employee mapping → transfer fails with a clear message, retry after fixing works', async () => {
    await q('update bc_resource_mapping set bc_employee_no = null where user_id = $1', [
      ids['monteur2-wild'],
    ]);
    const id = randomUUID();
    await push(
      'monteur2-wild',
      'RequestVacation',
      { fromDate: '2027-05-03', toDate: '2027-05-04' },
      id,
    ).expect(200);
    await api(app)
      .post(`/v1/absences/${id}/decision`)
      .set(as('meister-wild'))
      .send({ decision: 'APPROVE' })
      .expect(200);
    await worker.runOnce();
    const [tr] = await q('select id, state, last_error from bc_transfer where subject_id = $1', [id]);
    expect(tr).toMatchObject({ state: 'FAILED' });
    expect(tr.last_error).toMatch(/kein BC-Mitarbeiter zugeordnet/);
    await q("update bc_resource_mapping set bc_employee_no = 'M0002' where user_id = $1", [
      ids['monteur2-wild'],
    ]);
    await api(app).post(`/v1/admin/transfers/${tr.id}/retry`).set(as('admin')).expect(200);
    await worker.runOnce();
    expect((await q('select state from bc_transfer where id = $1', [tr.id]))[0].state).toBe('DONE');
    expect(bcAbsences('M0002').some((r) => r.fromDate === '2027-05-03')).toBe(true);
  });
});

function addDays(date: string | undefined, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
