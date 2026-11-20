import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { localDate } from '@schroeder/shared';
import { createDb } from '../src/db/client.js';
import { flagForgottenClockOuts } from '../src/jobs.js';
import { persona } from './helpers.js';

let owner: pg.Client;
beforeAll(async () => {
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
});
afterAll(() => owner.end());

it('flags attendance left open on a previous day for mandatory correction', async () => {
  const user = (
    await owner.query(
      'select u.id, ul.location_id from app_user u join user_location ul on ul.user_id = u.id where u.entra_oid = $1',
      [persona('monteur2-wild').oid],
    )
  ).rows[0];
  const ins = (d: string) =>
    owner.query(
      "insert into time_entry (user_id, location_id, work_date, kind, start_at, segment_key) values ($1, $2, $3, 'ATTENDANCE', $3::date + time '07:00', $4) returning id",
      [user.id, user.location_id, d, `job-test-${d}`],
    );
  const old = (await ins('2026-01-05')).rows[0].id;
  const today = (await ins(localDate(new Date(), 'Europe/Berlin'))).rows[0].id;
  const { db, pool } = createDb(process.env.TEST_WORKER_DATABASE_URL!, 1);
  try {
    expect(await flagForgottenClockOuts(db)).toBeGreaterThanOrEqual(1);
  } finally {
    await pool.end();
  }
  const r = await owner.query('select id, needs_correction from time_entry where id = any($1)', [
    [old, today],
  ]);
  expect(r.rows.find((x) => x.id === old).needs_correction).toBe(true);
  expect(r.rows.find((x) => x.id === today).needs_correction).toBe(false);
});
