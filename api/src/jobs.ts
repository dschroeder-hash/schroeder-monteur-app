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

/**
 * Retention (PROMPT 9): chat messages and photos of billed orders are removed after the configured period
 * (setting retention.chatPhotosMonthsAfterBilled, default 24). Photos are deleted from storage, rows are kept
 * as soft-deleted for the audit trail.
 */
export async function applyRetention(
  db: Db,
  deleteBlob: (path: string) => Promise<void>,
): Promise<{ messages: number; photos: number }> {
  const months = sql`coalesce((select (value->>'chatPhotosMonthsAfterBilled')::int from setting where key = 'retention' and location_id is null limit 1), 24)`;
  const msgs = await db.execute(sql`
    update chat_message m set deleted_at = now(), body = ''
    from service_order o
    where o.id = m.order_id and m.deleted_at is null and o.billed_at is not null
      and o.billed_at < now() - make_interval(months => ${months})`);
  const photos = await db.execute(sql`
    update photo p set deleted_at = now()
    from service_order o
    where o.id = p.order_id and p.deleted_at is null and o.billed_at is not null
      and o.billed_at < now() - make_interval(months => ${months})
    returning p.blob_path`);
  for (const row of photos.rows as Array<{ blob_path: string }>) await deleteBlob(row.blob_path);
  return { messages: msgs.rowCount ?? 0, photos: photos.rowCount ?? 0 };
}
