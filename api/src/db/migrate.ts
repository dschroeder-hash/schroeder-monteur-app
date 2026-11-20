import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/**
 * Applies all migrations. Must run with the schema owner (not the monteur_app login). In Azure this is the migration
 * job with its own identity (Entra administrator of the server, DATABASE_AUTH=entra) – see docs/BETRIEB.md.
 */
export async function runMigrations(url: string): Promise<void> {
  const { pool } = createDb(url, 1);
  try {
    const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/**
 * Azure only: creates the Entra logins of the API and worker identities (idempotent) and gives each exactly its role –
 * the API only monteur_app, the worker monteur_worker (E-57). Names come from DB_API_LOGIN / DB_WORKER_LOGIN.
 */
export async function setupLogins(url: string, apiLogin: string, workerLogin: string): Promise<void> {
  const { pool } = createDb(url, 1);
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  try {
    const { rows } = await pool.query<{ d: string }>('select current_database() as d');
    const database = rows[0]!.d;
    for (const [login, role] of [
      [apiLogin, 'monteur_app'],
      [workerLogin, 'monteur_worker'],
    ] as const) {
      const exists = await pool.query('select 1 from pg_roles where rolname = $1', [login]);
      if (!exists.rowCount)
        await pool.query('select * from pgaadauth_create_principal($1, false, false)', [login]);
      await pool.query(`grant ${role} to ${ident(login)}`);
      await pool.query(`grant connect on database ${ident(database)} to ${ident(login)}`);
    }
    // Never both roles for the API (the API checks this again at start-up).
    await pool.query(`revoke monteur_worker from ${ident(apiLogin)}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be set');
  (async () => {
    await runMigrations(url);
    console.log('migrations applied');
    if (process.env.DB_API_LOGIN && process.env.DB_WORKER_LOGIN) {
      await setupLogins(url, process.env.DB_API_LOGIN, process.env.DB_WORKER_LOGIN);
      console.log('database logins configured');
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
