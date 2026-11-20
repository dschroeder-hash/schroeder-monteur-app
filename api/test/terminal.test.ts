/** Shared workshop PC (E-72): stamping with personnel number + PIN, lock after 5 wrong PINs, own PIN. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

let app: NestExpressApplication;
let owner: pg.Client;
const t: Record<string, string> = {};
const as = (k: string) => ({ Authorization: `Bearer ${t[k]}` });

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  for (const k of ['werkstatt-pc-wild', 'monteur-wild', 'monteur2-wild', 'monteur-clp', 'azubi-wild'])
    t[k] = await tokenFor(app, k);
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

it('identifies an employee of the location with personnel number and PIN', async () => {
  const res = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0001', pin: '1234' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ name: persona('monteur-wild').name });
  expect(Array.isArray(res.body.orders)).toBe(true);
});

it('unknown number and wrong PIN give the same answer; employees of other locations are unknown', async () => {
  const wrongPin = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0001', pin: '9999' });
  const unknown = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'X9999', pin: '1234' });
  expect(wrongPin.status).toBe(401);
  expect(unknown.status).toBe(401);
  expect(unknown.body.message).toBe(wrongPin.body.message);
  const mapping = (
    await owner.query(
      'select m.bc_employee_no from bc_resource_mapping m join app_user u on u.id = m.user_id where u.entra_oid = $1',
      [persona('monteur-clp').oid],
    )
  ).rows[0];
  const other = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: mapping.bc_employee_no, pin: '1234' });
  expect(other.status).toBe(401);
});

it('locks the PIN for 15 minutes after 5 wrong entries', async () => {
  for (let i = 0; i < 5; i++)
    await api(app)
      .post('/v1/terminal/identify')
      .set(as('werkstatt-pc-wild'))
      .send({ personnelNo: 'M0002', pin: '0000' });
  const locked = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0002', pin: '1234' });
  expect(locked.status).toBe(423);
  expect(locked.body.message).toMatch(/gesperrt bis/);
  await owner.query(
    'update user_pin set locked_until = null from app_user u where u.id = user_pin.user_id and u.entra_oid = $1',
    [persona('monteur2-wild').oid],
  );
});

it('stamps as the employee through the normal sync path', async () => {
  const res = await api(app)
    .post('/v1/terminal/stamp')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0002', pin: '1234', type: 'StampClockIn' });
  expect(res.status).toBe(200);
  expect(res.body.clockedIn).toBe(true);
  const [ev] = (
    await owner.query(
      `select e.kind from stamp_event e join app_user u on u.id = e.user_id
       join sync_command c on c.id = e.id where u.entra_oid = $1 and c.device_id like 'terminal:%' order by e.device_time desc limit 1`,
      [persona('monteur2-wild').oid],
    )
  ).rows;
  expect(ev?.kind).toBe('CLOCK_IN');
  const out = await api(app)
    .post('/v1/terminal/stamp')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0002', pin: '1234', type: 'StampClockOut' });
  expect(out.body.clockedIn).toBe(false);
});

it('only the workshop PC may stamp for others; employees set their own PIN', async () => {
  const forbidden = await api(app)
    .post('/v1/terminal/identify')
    .set(as('monteur-wild'))
    .send({ personnelNo: 'M0002', pin: '1234' });
  expect(forbidden.status).toBe(403);
  expect((await api(app).put('/v1/me/pin').set(as('monteur-wild')).send({ pin: '12a4' })).status).toBe(400);
  expect((await api(app).put('/v1/me/pin').set(as('monteur-wild')).send({ pin: '4711' })).status).toBe(200);
  const ok = await api(app)
    .post('/v1/terminal/identify')
    .set(as('werkstatt-pc-wild'))
    .send({ personnelNo: 'M0001', pin: '4711' });
  expect(ok.status).toBe(200);
  await api(app).put('/v1/me/pin').set(as('monteur-wild')).send({ pin: '1234' });
});
