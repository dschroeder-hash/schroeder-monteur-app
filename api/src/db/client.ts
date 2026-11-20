import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Session context applied to every transaction; drives the RLS policies. */
export interface DbSession {
  userId: string;
  roles: readonly string[];
}

/**
 * DATABASE_AUTH=entra (Azure): no password in DATABASE_URL – each new connection gets a fresh Entra access token of
 * the container's managed identity (password auth is disabled on the server, E-57). Tokens are cached until shortly
 * before they expire.
 */
let cachedToken: { value: string; expires: number } | undefined;
async function entraPassword(): Promise<string> {
  if (cachedToken && cachedToken.expires - Date.now() > 5 * 60_000) return cachedToken.value;
  const { DefaultAzureCredential } = await import('@azure/identity');
  const t = await new DefaultAzureCredential().getToken('https://ossrdbms-aad.database.windows.net/.default');
  cachedToken = { value: t.token, expires: t.expiresOnTimestamp };
  return t.token;
}

export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    // Never wait forever for a connection: a jam becomes a (retryable) error instead of a hanging request.
    connectionTimeoutMillis: 10_000,
    ...(process.env.DATABASE_AUTH === 'entra' ? { password: entraPassword } : {}),
  });
  // An idle client dropped by the server (failover, restart) must not crash the process; the pool reconnects.
  pool.on('error', (err) => console.warn(`[db] idle client error: ${err.message}`));
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Runs `fn` in a transaction with the RLS session variables set (SET LOCAL semantics).
 * All user-facing data access must go through this function.
 */
export async function withSession<T>(
  db: Db,
  session: DbSession,
  fn: (tx: Tx) => Promise<T>,
  opts: {
    isolationLevel?: 'read committed' | 'repeatable read';
    accessMode?: 'read only' | 'read write';
  } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${session.userId}, true), set_config('app.roles', ${session.roles.join(',')}, true)`,
    );
    return fn(tx);
  }, opts);
}
