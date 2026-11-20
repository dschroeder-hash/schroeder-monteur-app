import { createDb } from './client.js';

/**
 * Guard for the RLS role split (ARCHITEKTUR 5, E-28): the API must log in as a member of `monteur_app` only –
 * never as superuser, BYPASSRLS or member of `monteur_worker` (all policies short-circuit for the worker). The worker
 * must be a member of `monteur_worker`. In Azure / prod a wrong setup stops the process; locally it only warns.
 */
export async function assertDbRole(
  url: string,
  component: 'api' | 'worker',
  strict: boolean,
  log: (m: string) => void = console.warn,
): Promise<void> {
  const { pool } = createDb(url, 1);
  const c = await pool.connect();
  try {
    const { rows } = await c.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      worker: boolean;
      app: boolean;
      name: string;
    }>(
      `select current_user as name, r.rolsuper, r.rolbypassrls,
              pg_has_role(current_user, 'monteur_worker', 'MEMBER') as worker,
              pg_has_role(current_user, 'monteur_app', 'MEMBER') as app
       from pg_roles r where r.rolname = current_user`,
    );
    const r = rows[0]!;
    const problems: string[] = [];
    if (r.rolsuper) problems.push('ist Superuser');
    if (r.rolbypassrls) problems.push('hat BYPASSRLS');
    if (component === 'api' && r.worker) problems.push('ist Mitglied von monteur_worker');
    if (component === 'api' && !r.app) problems.push('ist nicht Mitglied von monteur_app');
    if (component === 'worker' && !r.worker) problems.push('ist nicht Mitglied von monteur_worker');
    if (!problems.length) return;
    const msg = `[db-role] Datenbank-Login "${r.name}" für ${component} ${problems.join(', ')} – Row Level Security wäre wirkungslos.`;
    if (strict) throw new Error(msg);
    log(msg);
  } finally {
    c.release();
    await pool.end();
  }
}
