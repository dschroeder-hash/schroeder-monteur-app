/** Stamp clock (E-69): with the location setting the server stores quarter-hour entries like BC's Stempeluhr. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc, type CommandType } from '@schroeder/shared';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

const TZ = 'Europe/Berlin';
const D = addDays(localDate(new Date(), TZ), -30);
let app: NestExpressApplication;
let owner: pg.Client;
let token: string;
let userId: string;
let locationId: string;
let seq = 7000;
const push = (type: CommandType, time: string, payload: Record<string, unknown> = {}) =>
  api(app)
    .post('/v1/sync/push')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      deviceId: 'stamp-clock-device',
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

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  token = await tokenFor(app, 'monteur-clp');
  userId = (await owner.query('select id from app_user where entra_oid = $1', [persona('monteur-clp').oid]))
    .rows[0].id;
  locationId = (
    await owner.query("select location_id from user_location where user_id = $1 and role = 'MONTEUR'", [
      userId,
    ])
  ).rows[0].location_id;
  await owner.query(
    `insert into setting (key, location_id, value) values ('rounding', $1,
      '{"gridMinutes": 15, "mode": "commercial", "basis": "daily_sum", "stampClock": {"gridMinutes": 15, "startGraceMinutes": 5}}')`,
    [locationId],
  );
});
afterAll(async () => {
  await owner.query("delete from setting where key = 'rounding' and location_id = $1", [locationId]);
  await owner.end();
  await app.close();
});

it('Kommen 07:35:59 counts as 07:30, a switch at 09:07 as 09:15, Gehen 16:29 as 16:15', async () => {
  const [order] = (
    await owner.query(
      'select o.id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null limit 1',
      [userId],
    )
  ).rows;
  await push('StampClockIn', '07:35:59').expect(200);
  await push('StampJobStart', '07:36:10', { orderId: order.id, activity: 'WORK' }).expect(200);
  await push('StampJobStart', '09:07', { orderId: order.id, activity: 'TRAVEL' }).expect(200);
  await push('StampClockOut', '16:29:59').expect(200);
  const rows = (
    await owner.query(
      `select kind, activity, to_char(start_at at time zone $3, 'HH24:MI') as s, to_char(end_at at time zone $3, 'HH24:MI') as e
       from time_entry where user_id = $1 and work_date = $2 order by start_at, kind`,
      [userId, D, TZ],
    )
  ).rows;
  expect(rows).toEqual([
    { kind: 'ATTENDANCE', activity: null, s: '07:30', e: '16:15' },
    { kind: 'ORDER', activity: 'WORK', s: '07:45', e: '09:15' },
    { kind: 'ORDER', activity: 'TRAVEL', s: '09:15', e: '16:15' },
  ]);
});
