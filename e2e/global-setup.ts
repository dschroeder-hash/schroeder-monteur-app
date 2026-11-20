import pg from 'pg';
import { runMigrations } from '@schroeder/api/dist/db/migrate.js';
import { createDb } from '@schroeder/api/dist/db/client.js';
import { seedDev } from '@schroeder/api/dist/seed/dev-seed.js';
import { deviceDayStart, E2E_DB } from './playwright.config.js';

/** Fresh database with seed data for "today" and a non-privileged API login (RLS active). */
export default async function setup() {
  const admin = process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const ownerUrl = admin.replace(/\/[^/]*$/, `/${E2E_DB}`);
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [E2E_DB],
  );
  await c.query(`DROP DATABASE IF EXISTS ${E2E_DB}`);
  await c.query(`CREATE DATABASE ${E2E_DB}`);
  await c.end();
  await runMigrations(ownerUrl);
  const o = new pg.Client({ connectionString: ownerUrl });
  await o.connect();
  await o.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_api_e2e') THEN CREATE ROLE monteur_api_e2e LOGIN PASSWORD 'e2e'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_worker_e2e') THEN CREATE ROLE monteur_worker_e2e LOGIN PASSWORD 'e2e'; END IF; END $$;`,
  );
  await o.query(
    `GRANT monteur_app TO monteur_api_e2e; GRANT monteur_worker TO monteur_worker_e2e; GRANT CONNECT ON DATABASE ${E2E_DB} TO monteur_api_e2e, monteur_worker_e2e`,
  );
  await o.end();
  const { db, pool } = createDb(ownerUrl, 1);
  // "Today" for the seed is the day the test device of offline-day.spec.ts lives through.
  const deviceStart = deviceDayStart();
  await seedDev(db, deviceStart);
  await pool.end();
  // Before 15:00 UTC the device day of offline-day.spec.ts is yesterday, while the other specs use the real clock.
  // Plan the same orders for the real today as well, so "Heute fällig" is right for both.
  if (deviceStart.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    const c = new pg.Client({ connectionString: ownerUrl });
    await c.connect();
    await c.query(`insert into assignment (id, order_id, location_id, user_id, planned_start, planned_end)
      select gen_random_uuid(), order_id, location_id, user_id, planned_start + interval '1 day', planned_end + interval '1 day'
      from assignment where cancelled_at is null`);
    await c.end();
  }
  // No Meister in the app (E-66): the worker hands over at once in the tests (no grace period).
  const st = new pg.Client({ connectionString: ownerUrl });
  await st.connect();
  await st.query(
    `insert into setting (key, value) values ('approval', '{"mode": "auto", "graceMinutes": 0}')`,
  );
  await st.end();
  process.env.E2E_OWNER_DATABASE_URL = ownerUrl;
}
