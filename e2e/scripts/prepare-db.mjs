// Runs BEFORE Playwright: Playwright starts the web servers before globalSetup, so the database and the
// non-privileged logins must already exist (fresh CI database). globalSetup then recreates the data for the run.
import pg from 'pg';
import { runMigrations } from '@schroeder/api/dist/db/migrate.js';

const E2E_DB = 'monteur_e2e';
const admin = process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const ownerUrl = admin.replace(/\/[^/]*$/, `/${E2E_DB}`);

const c = new pg.Client({ connectionString: admin });
await c.connect();
const exists = await c.query('select 1 from pg_database where datname = $1', [E2E_DB]);
if (!exists.rowCount) await c.query(`create database ${E2E_DB}`);
await c.end();
await runMigrations(ownerUrl);
const o = new pg.Client({ connectionString: ownerUrl });
await o.connect();
await o.query(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'monteur_api_e2e') then create role monteur_api_e2e login password 'e2e'; end if;
  if not exists (select 1 from pg_roles where rolname = 'monteur_worker_e2e') then create role monteur_worker_e2e login password 'e2e'; end if;
end $$`);
await o.query(`grant monteur_app to monteur_api_e2e; grant monteur_worker to monteur_worker_e2e;
  grant connect on database ${E2E_DB} to monteur_api_e2e, monteur_worker_e2e`);
await o.end();
console.log('e2e database prepared');
