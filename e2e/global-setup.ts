import pg from 'pg';
import { runMigrations } from '@schroeder/api/dist/db/migrate.js';
import { createDb } from '@schroeder/api/dist/db/client.js';
import { seedDev } from '@schroeder/api/dist/seed/dev-seed.js';
import { E2E_DB } from './playwright.config.js';

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
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_api_e2e') THEN CREATE ROLE monteur_api_e2e LOGIN PASSWORD 'e2e'; END IF; END $$;`,
  );
  await o.query(
    `GRANT monteur_app TO monteur_api_e2e; GRANT CONNECT ON DATABASE ${E2E_DB} TO monteur_api_e2e`,
  );
  await o.end();
  const { db, pool } = createDb(ownerUrl, 1);
  // "Today" for the seed is the day the test device starts (its clock runs 9 h behind, see offline-day.spec.ts).
  await seedDev(db, new Date(Date.now() - 9 * 3_600_000));
  await pool.end();
  process.env.E2E_OWNER_DATABASE_URL = ownerUrl;
}
