/**
 * Phase 3: planning board → BC allocations, approval inbox → BC service lines, corrections, transfer queue.
 * The BC side is the mock; the worker runs with the monteur_worker DB role.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc, type CommandType } from '@schroeder/shared';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createDb } from '../src/db/client.js';
import { flagForgottenClockOuts } from '../src/jobs.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';
import { TEST_NOW } from './constants.js';

const TZ = 'Europe/Berlin';
const TODAY = localDate(new Date(), TZ);
const { app: mock, state } = buildMockServer({ now: TEST_NOW });
let app: NestExpressApplication;
let owner: pg.Client;
let worker: BcTransferWorker;
let workerDb: ReturnType<typeof createDb>;
let base: string;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
let seq = 1000;

const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (
  who: string,
  type: CommandType,
  date: string,
  time: string,
  payload: Record<string, unknown> = {},
) =>
  api(app)
    .post('/v1/sync/push')
    .set(as(who))
    .send({
      deviceId: 'phase3-device',
      deviceNow: new Date().toISOString(),
      commands: [
        {
          id: randomUUID(),
          type,
          deviceTime: zonedToUtc(date, time, TZ).toISOString(),
          deviceSeq: ++seq,
          payload,
        },
      ],
    });
const transfersFor = (subjectId: string) =>
  q('select * from bc_transfer where subject_id = $1 order by created_at', [subjectId]);
const runWorker = () => worker.runOnce();

beforeAll(async () => {
  base = await mock.listen({ port: 0, host: '127.0.0.1' });
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
  for (const p of ['monteur-wild', 'monteur2-wild', 'meister-wild', 'meister-clp', 'admin']) {
    t[p] = await tokenFor(app, p);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  ids.wild = (await q("select id from location where code = 'WILD'"))[0].id;
  // Nothing from earlier test files should block the queue.
  await q("update bc_transfer set state = 'DONE'");
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

describe('planning board', () => {
  let orderId: string;
  let assignmentId: string;
  const start = zonedToUtc(addDays(TODAY, 1), '08:00', TZ).toISOString();
  const end = zonedToUtc(addDays(TODAY, 1), '11:00', TZ).toISOString();

  it('shows Monteure, unplanned orders and assignments of the location only', async () => {
    const res = await api(app)
      .get(
        `/v1/planning/board?locationId=${ids.wild}&from=${zonedToUtc(TODAY, '00:00', TZ).toISOString()}&to=${zonedToUtc(addDays(TODAY, 7), '00:00', TZ).toISOString()}`,
      )
      .set(as('meister-wild'));
    expect(res.status).toBe(200);
    expect(res.body.monteure.map((m: { id: string }) => m.id)).toContain(ids['monteur-wild']);
    expect(res.body.monteure.every((m: { resourceNo: string }) => m.resourceNo)).toBe(true);
    expect(res.body.unplanned.length).toBeGreaterThan(0);
    orderId = res.body.unplanned.find((o: { appStatus: string }) => o.appStatus === 'NEU').id;
    const other = await api(app)
      .get(`/v1/planning/board?locationId=${ids.wild}&from=${start}&to=${end}`)
      .set(as('meister-clp'));
    expect(other.status).toBe(403);
  });

  it('assigning creates the assignment, sets EINGEPLANT, notifies the Monteur and queues the BC allocation', async () => {
    const res = await api(app)
      .post('/v1/planning/assignments')
      .set(as('meister-wild'))
      .send({ orderId, userId: ids['monteur-wild'], plannedStart: start, plannedEnd: end });
    expect(res.status).toBe(201);
    assignmentId = res.body.id;
    expect((await q('select app_status from service_order where id = $1', [orderId]))[0].app_status).toBe(
      'EINGEPLANT',
    );
    expect(
      (
        await q("select * from notification where user_id = $1 and kind = 'ASSIGNMENT'", [
          ids['monteur-wild'],
        ])
      ).length,
    ).toBeGreaterThan(0);
    const tr = await transfersFor(assignmentId);
    expect(tr).toHaveLength(1);
    expect(tr[0].target).toBe('ALLOCATION');
  });

  it('flags double bookings (warn, never block)', async () => {
    const other = (
      await q(
        "select id from service_order where location_id = $1 and app_status = 'NEU' and id <> $2 limit 1",
        [ids.wild, orderId],
      )
    )[0].id;
    const res = await api(app)
      .post('/v1/planning/assignments')
      .set(as('meister-wild'))
      .send({ orderId: other, userId: ids['monteur-wild'], plannedStart: start, plannedEnd: end });
    expect(res.status).toBe(201);
    expect(res.body.conflicts[0].kind).toBe('DOUBLE_BOOKING');
    await api(app).delete(`/v1/planning/assignments/${res.body.id}`).set(as('meister-wild')).expect(200);
  });

  it('a Meister of another location cannot plan here (404)', async () => {
    const res = await api(app)
      .post('/v1/planning/assignments')
      .set(as('meister-clp'))
      .send({ orderId, userId: ids['monteur-wild'], plannedStart: start, plannedEnd: end });
    expect(res.status).toBe(404);
  });

  it('worker writes the allocation to BC; move and cancel are patched', async () => {
    await runWorker();
    const [a] = await q('select bc_allocation_id from assignment where id = $1', [assignmentId]);
    expect(a.bc_allocation_id).toBeTruthy();
    const alloc = state.tables.serviceOrderAllocations.find((x) => x.id === a.bc_allocation_id)!;
    expect(alloc).toMatchObject({
      resourceNumber: 'R0001',
      startingTime: '08:00:00',
      finishingTime: '11:00:00',
      allocatedHours: 3,
    });

    const moved = await api(app)
      .patch(`/v1/planning/assignments/${assignmentId}`)
      .set(as('meister-wild'))
      .send({
        userId: ids['monteur2-wild'],
        plannedStart: zonedToUtc(addDays(TODAY, 2), '13:00', TZ).toISOString(),
        plannedEnd: zonedToUtc(addDays(TODAY, 2), '15:30', TZ).toISOString(),
      });
    expect(moved.status).toBe(200);
    await runWorker();
    expect(alloc).toMatchObject({ resourceNumber: 'R0002', startingTime: '13:00:00', allocatedHours: 2.5 });

    await api(app).delete(`/v1/planning/assignments/${assignmentId}`).set(as('meister-wild')).expect(200);
    await runWorker();
    expect(alloc.status).toBe('Canceled');
    expect((await q('select app_status from service_order where id = $1', [orderId]))[0].app_status).toBe(
      'NEU',
    );
    expect((await transfersFor(assignmentId)).every((x) => x.state === 'DONE')).toBe(true);
  });
});

describe('approval inbox → BC service lines', () => {
  const D = addDays(TODAY, -8);
  let order: { id: string; bc_no: string };

  it('lists the finished day and approves it into BC transfers', async () => {
    order = (
      await q(
        "select o.id, o.bc_no from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending' limit 1",
        [ids['monteur-wild']],
      )
    )[0];
    await push('monteur-wild', 'StampJobStart', D, '07:00', { orderId: order.id, activity: 'WORK' }).expect(
      200,
    );
    await push('monteur-wild', 'StampOverheadStart', D, '09:00', { overheadCode: 'WERKSTATTPFLEGE' });
    await push('monteur-wild', 'StampClockOut', D, '10:00');

    const inbox = await api(app).get(`/v1/approvals/inbox?locationId=${ids.wild}`).set(as('meister-wild'));
    const day = inbox.body.days.find(
      (d: { userId: string; workDate: string }) => d.userId === ids['monteur-wild'] && d.workDate === D,
    );
    expect(day).toMatchObject({ approvable: true, running: false });
    expect(day.summary.orderMinutes).toBe(120);

    const res = await api(app)
      .post('/v1/approvals/time-days')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur-wild'], workDate: D });
    expect(res.status).toBe(200);
    expect(res.body.bcLines).toBe(2);
    expect(
      (
        await q('select distinct state from time_entry where user_id = $1 and work_date = $2', [
          ids['monteur-wild'],
          D,
        ])
      ).map((r) => r.state),
    ).toEqual(['APPROVED']);
    const again = await api(app)
      .post('/v1/approvals/time-days')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur-wild'], workDate: D });
    expect(again.status).toBe(409);
    expect(
      (
        await q("select * from audit_log where action = 'APPROVE_TIME_DAY' and entity_id = $1", [
          `${ids['monteur-wild']}:${D}`,
        ])
      ).length,
    ).toBe(1);
  });

  it('worker creates a resource line on the BC service order and a resource journal line; entries become TRANSFERRED', async () => {
    await runWorker();
    const lines = state.tables.serviceLines.filter(
      (l) => l.documentNumber === order.bc_no && l.type === 'Resource',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      number: 'R0001',
      quantity: 2,
      workTypeCode: 'ARBEIT',
      unitOfMeasureCode: 'STUNDE',
    });
    expect(
      state.tables.resourceJournalLines.some((l) => l.workTypeCode === 'WERKSTATTPFLEGE' && l.quantity === 1),
    ).toBe(true);
    expect(
      (
        await q(
          "select distinct state from time_entry where user_id = $1 and work_date = $2 and kind in ('ORDER','OVERHEAD')",
          [ids['monteur-wild'], D],
        )
      ).map((r) => r.state),
    ).toEqual(['TRANSFERRED']);
  });

  it('a replay after a crash creates no duplicate in BC (idempotency key)', async () => {
    await q("update bc_transfer set state = 'PENDING', attempts = 0 where target = 'SERVICE_LINE_RESOURCE'");
    await runWorker();
    expect(
      state.tables.serviceLines.filter((l) => l.documentNumber === order.bc_no && l.type === 'Resource'),
    ).toHaveLength(1);
  });

  it('late stamps on an approved day are not applied silently', async () => {
    const res = await push('monteur-wild', 'StampBreakStart', D, '09:30');
    expect(res.body.results[0].warnings.join(' ')).toContain('bereits eingereicht');
    expect(
      (
        await q(
          "select count(*)::int as n from time_entry where user_id = $1 and work_date = $2 and kind = 'BREAK'",
          [ids['monteur-wild'], D],
        )
      )[0].n,
    ).toBe(0);
  });

  it('a Meister of another location cannot approve (404)', async () => {
    const res = await api(app)
      .post('/v1/approvals/time-days')
      .set(as('meister-clp'))
      .send({ userId: ids['monteur-wild'], workDate: addDays(TODAY, -9) });
    expect(res.status).toBe(404);
  });
});

describe('transfer queue robustness', () => {
  const approveDay = async (date: string, orderId: string) => {
    await push('monteur2-wild', 'StampJobStart', date, '07:00', { orderId, activity: 'WORK' });
    await push('monteur2-wild', 'StampClockOut', date, '08:00');
    return api(app)
      .post('/v1/approvals/time-days')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur2-wild'], workDate: date });
  };
  const ordersOf2 = async () =>
    await q(
      "select o.id, o.bc_no, o.bc_system_id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending' order by o.bc_no",
      [ids['monteur2-wild']],
    );

  it('retries after 429 and succeeds later', async () => {
    const [o] = await ordersOf2();
    await fetch(`${base}/__mock/failures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remaining: 1, status: 429, code: 'TooMany', pathContains: 'serviceLines' }),
    });
    (await approveDay(addDays(TODAY, -11), o!.id)).body;
    await runWorker();
    const [tr] = await q(
      "select * from bc_transfer where state <> 'DONE' and target = 'SERVICE_LINE_RESOURCE'",
    );
    expect(tr).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(new Date(tr.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    await q('update bc_transfer set next_attempt_at = now() where id = $1', [tr.id]);
    await runWorker();
    expect((await q('select state from bc_transfer where id = $1', [tr.id]))[0].state).toBe('DONE');
  });

  it('a business error fails the transfer and blocks its group until the admin resolves it', async () => {
    const [, o] = await ordersOf2();
    const mockOrder = state.tables.serviceOrders.find((x) => x.number === o!.bc_no)!;
    mockOrder.status = 'Finished'; // BC refuses lines on finished orders
    await approveDay(addDays(TODAY, -12), o!.id);
    await approveDay(addDays(TODAY, -13), o!.id);
    await runWorker();
    const trs = await q('select * from bc_transfer where group_key = $1 order by created_at', [
      `order:${o!.id}`,
    ]);
    expect(trs[0].state).toBe('FAILED');
    expect(trs[0].last_error).toContain('Finished');
    expect(trs[1].state).toBe('PENDING'); // held back to keep the order

    const list = await api(app).get('/v1/admin/transfers?state=FAILED').set(as('admin'));
    expect(list.body.some((x: { id: string }) => x.id === trs[0].id)).toBe(true);
    mockOrder.status = 'Pending';
    await api(app).post(`/v1/admin/transfers/${trs[0].id}/retry`).set(as('admin')).expect(200);
    await runWorker();
    const after = await q('select state from bc_transfer where group_key = $1 order by created_at', [
      `order:${o!.id}`,
    ]);
    expect(after.map((r) => r.state)).toEqual(['DONE', 'DONE']);
  });

  it('goes to the dead-letter state after 10 attempts', async () => {
    const [o] = await ordersOf2();
    await approveDay(addDays(TODAY, -14), o!.id);
    const [tr] = await q(
      "select * from bc_transfer where state = 'PENDING' and target = 'SERVICE_LINE_RESOURCE' order by created_at desc limit 1",
    );
    await q('update bc_transfer set attempts = 9 where id = $1', [tr.id]);
    await fetch(`${base}/__mock/failures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remaining: 1, status: 503, code: 'Unavailable', pathContains: 'serviceLines' }),
    });
    await runWorker();
    expect((await q('select state from bc_transfer where id = $1', [tr.id]))[0].state).toBe('DEAD');
    const res = await api(app)
      .post(`/v1/admin/transfers/${tr.id}/resolve`)
      .set(as('admin'))
      .send({ reason: 'In BC manuell erfasst' });
    expect(res.status).toBe(200);
    expect(
      (await q("select * from audit_log where action = 'TRANSFER_RESOLVED' and entity_id = $1", [tr.id]))
        .length,
    ).toBe(1);
  });
});

describe('corrections', () => {
  const D = addDays(TODAY, -16);

  it('forgotten clock-out: Monteur requests a correction, Meister accepts, day becomes approvable', async () => {
    await push('monteur-wild', 'StampClockIn', D, '06:30');
    await flagForgottenClockOuts(workerDb.db);
    let inbox = await api(app).get(`/v1/approvals/inbox?locationId=${ids.wild}`).set(as('meister-wild'));
    let day = inbox.body.days.find(
      (d: { userId: string; workDate: string }) => d.userId === ids['monteur-wild'] && d.workDate === D,
    );
    expect(day).toMatchObject({ needsCorrection: true, approvable: false });
    expect(
      (
        await api(app)
          .post('/v1/approvals/time-days')
          .set(as('meister-wild'))
          .send({ userId: ids['monteur-wild'], workDate: D })
      ).status,
    ).toBe(422);

    await push('monteur-wild', 'RequestTimeCorrection', TODAY, '07:00', {
      workDate: D,
      proposal: [{ kind: 'CLOCK_OUT', time: '15:00' }],
      comment: 'Vergessen',
    }).expect(200);
    inbox = await api(app).get(`/v1/approvals/inbox?locationId=${ids.wild}`).set(as('meister-wild'));
    const req = inbox.body.corrections.find((c: { workDate: string }) => c.workDate === D);
    expect(req.userName).toContain('Jan Meyer');
    await api(app)
      .post(`/v1/approvals/correction-requests/${req.id}`)
      .set(as('meister-wild'))
      .send({ decision: 'ANGENOMMEN' })
      .expect(200);

    inbox = await api(app).get(`/v1/approvals/inbox?locationId=${ids.wild}`).set(as('meister-wild'));
    day = inbox.body.days.find(
      (d: { userId: string; workDate: string }) => d.userId === ids['monteur-wild'] && d.workDate === D,
    );
    expect(day).toMatchObject({ needsCorrection: false, approvable: true });
    expect(day.summary.attendanceMinutes).toBe(510);
    const ev = await q(
      "select created_by, correction_reason from stamp_event where user_id = $1 and kind = 'CLOCK_OUT' and created_by is not null",
      [ids['monteur-wild']],
    );
    expect(ev[0].created_by).toBe(ids['meister-wild']);
  });

  it('Meister correction voids a wrong event and adds the right one – with mandatory reason and audit', async () => {
    const C = addDays(TODAY, -17);
    await push('monteur-wild', 'StampClockIn', C, '05:00'); // wrong
    await push('monteur-wild', 'StampClockOut', C, '14:00');
    const events = (
      await api(app)
        .get(`/v1/approvals/day-events?userId=${ids['monteur-wild']}&workDate=${C}`)
        .set(as('meister-wild'))
    ).body;
    const wrong = events.find((e: { kind: string }) => e.kind === 'CLOCK_IN');
    const noReason = await api(app)
      .post('/v1/approvals/time-corrections')
      .set(as('meister-wild'))
      .send({ userId: ids['monteur-wild'], workDate: C, voidEventIds: [wrong.id], reason: 'x' });
    expect(noReason.status).toBe(400);
    const ok = await api(app)
      .post('/v1/approvals/time-corrections')
      .set(as('meister-wild'))
      .send({
        userId: ids['monteur-wild'],
        workDate: C,
        voidEventIds: [wrong.id],
        addEvents: [{ kind: 'CLOCK_IN', time: '07:00' }],
        reason: 'Beginn laut Werkstattbuch 07:00',
      });
    expect(ok.status).toBe(200);
    expect(
      (
        await q(
          "select actual_minutes from time_entry where user_id = $1 and work_date = $2 and kind = 'ATTENDANCE'",
          [ids['monteur-wild'], C],
        )
      )[0].actual_minutes,
    ).toBe(420);
    const audit = await q(
      "select old_value, new_value, reason from audit_log where action = 'CORRECT_TIME' and entity_id = $1",
      [`${ids['monteur-wild']}:${C}`],
    );
    expect(audit[0].old_value.summary.attendanceMinutes).toBe(540);
    expect(audit[0].new_value.summary.attendanceMinutes).toBe(420);
    // the raw event still exists (append-only), only voided
    expect((await q('select count(*)::int as n from stamp_event where id = $1', [wrong.id]))[0].n).toBe(1);
    const pull = await api(app).get('/v1/sync/pull').set(as('monteur-wild'));
    expect(pull.body.voidedEventIds).toContain(wrong.id);
  });

  it('a Monteur cannot add correction events for himself via the database role', async () => {
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
          "insert into stamp_event (id, user_id, kind, device_time, created_by, correction_reason) values ($1, $2, 'CLOCK_OUT', now(), $2, 'selbst')",
          [randomUUID(), ids['monteur-wild']],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await c.query('rollback');
      await c.end();
    }
  });
});

describe('order approval', () => {
  it('Meister approves a finished order → BC status Finished via transfer', async () => {
    const o = (
      await q(
        "select id, bc_no from service_order where location_id = $1 and app_status = 'NEU' and bc_status = 'Pending' order by bc_no desc limit 1",
        [ids.wild],
      )
    )[0];
    const early = await api(app)
      .post(`/v1/orders/${o.id}/status`)
      .set(as('meister-wild'))
      .send({ status: 'FREIGEGEBEN' });
    expect(early.status).toBe(422);
    await api(app)
      .post(`/v1/orders/${o.id}/status`)
      .set(as('meister-wild'))
      .send({ status: 'FERTIG' })
      .expect(200);
    await api(app)
      .post(`/v1/orders/${o.id}/status`)
      .set(as('meister-wild'))
      .send({ status: 'FREIGEGEBEN', note: 'Abnahme mit Kunde' })
      .expect(200);
    await runWorker();
    expect(state.tables.serviceOrders.find((x) => x.number === o.bc_no)!.status).toBe('Finished');
    const clp = await api(app)
      .post(`/v1/orders/${o.id}/status`)
      .set(as('meister-clp'))
      .send({ status: 'IN_ARBEIT' });
    expect(clp.status).toBe(404);
  });
});
