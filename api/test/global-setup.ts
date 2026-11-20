import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { createDb } from '../src/db/client.js';
import { seedDev } from '../src/seed/dev-seed.js';
import { TEST_NOW } from './constants.js';

/**
 * Creates a fresh test database, applies all migrations as owner, creates the non-privileged
 * login roles used by API and worker (so RLS is really enforced) and seeds test data.
 */
export default async function setup() {
  const admin = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const dbName = process.env.TEST_DATABASE_NAME ?? 'monteur_test';
  const ownerUrl = admin.replace(/\/[^/]*$/, `/${dbName}`);

  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await c.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();

  await runMigrations(ownerUrl);

  const o = new pg.Client({ connectionString: ownerUrl });
  await o.connect();
  await o.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_api_test') THEN CREATE ROLE monteur_api_test LOGIN PASSWORD 'test'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_worker_test') THEN CREATE ROLE monteur_worker_test LOGIN PASSWORD 'test'; END IF;
  END $$;`);
  await o.query(`GRANT monteur_app TO monteur_api_test; GRANT monteur_worker TO monteur_worker_test;`);
  await o.query(`GRANT CONNECT ON DATABASE ${dbName} TO monteur_api_test, monteur_worker_test`);
  await o.end();

  const { db, pool } = createDb(ownerUrl, 1);
  await seedDev(db, TEST_NOW);
  await pool.end();
  // Most tests finish orders without a customer signature; checklist-signature.test.ts switches it on per location.
  const so = new pg.Client({ connectionString: ownerUrl });
  await so.connect();
  await so.query(`insert into setting (key, value) values ('completion', '{"signatureRequired": false}')`);
  await so.query('update checklist_template set active = false'); // seeded example (tests create their own)
  await so.end();

  const u = new URL(ownerUrl);
  const as = (user: string) => {
    const x = new URL(u.toString());
    x.username = user;
    x.password = 'test';
    return x.toString();
  };
  process.env.TEST_OWNER_DATABASE_URL = ownerUrl;
  process.env.TEST_API_DATABASE_URL = as('monteur_api_test');
  process.env.TEST_WORKER_DATABASE_URL = as('monteur_worker_test');
}
