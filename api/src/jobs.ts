import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';

/**
 * Forgotten clock-out (PROMPT 5.1): attendance still open on a previous local day is flagged for a
 * mandatory correction, which the Meister approves. The push reminder at the configured time follows with Web Push (phase 5).
 */
export async function flagForgottenClockOuts(db: Db): Promise<number> {
  const r = await db.execute(sql`
    update time_entry te set needs_correction = true
    from location l
    where l.id = te.location_id
      and te.kind = 'ATTENDANCE' and te.end_at is null and te.needs_correction = false
      and te.work_date < (now() at time zone l.timezone)::date`);
  return r.rowCount ?? 0;
}
