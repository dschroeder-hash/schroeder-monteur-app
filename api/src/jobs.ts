import { eq, sql } from 'drizzle-orm';
import { localDate } from '@schroeder/shared';
import type { Db } from './db/client.js';
import { location, productivitySnapshot, userLocation } from './db/schema.js';
import { computeMonth, shiftMonth } from './modules/productivity/productivity.calc.js';

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
): Promise<Record<string, number>> {
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
  // Sick reports are deleted 12 months after their end (OP-18) – the official record is the employee absence in BC.
  // Vacation stays (balance, history) but loses its free-text comment. Notifications go after 180 days.
  const oldSick = sql`select id from absence where type = 'KRANK' and coalesce(to_date, from_date) < (now() - interval '12 months')::date
    and state in ('REPORTED', 'CANCELLED')`;
  await db.execute(sql`delete from team_absence where absence_id in (${oldSick})`);
  const sick = await db.execute(sql`delete from absence where id in (${oldSick})`);
  const comments = await db.execute(sql`
    update absence set comment = null
    where comment is not null and coalesce(to_date, from_date) < (now() - interval '12 months')::date`);
  const notes = await db.execute(
    sql`delete from notification where created_at < now() - interval '180 days'`,
  );

  // Statutory retention (OP-38, default 6 years – § 257 HGB / payroll records; ArbZG requires at least 2): time data,
  // corrections, approvals, audit log, productivity snapshots and vacation older than that are deleted; accounts that
  // have been inactive for that long are anonymised (rows stay for referential integrity).
  const years = sql`coalesce((select (value->>'timeDataYears')::int from setting where key = 'retention' and location_id is null limit 1), 6)`;
  const cutoff = sql`(now() - make_interval(years => ${years}))`;
  await db.execute(
    sql`delete from time_entry_revision where time_entry_id in (select id from time_entry where work_date < ${cutoff}::date)`,
  );
  const entries = await db.execute(sql`delete from time_entry where work_date < ${cutoff}::date`);
  await db.execute(
    sql`delete from stamp_event_void where event_id in (select id from stamp_event where device_time < ${cutoff})`,
  );
  const stamps = await db.execute(sql`delete from stamp_event where device_time < ${cutoff}`);
  await db.execute(sql`delete from time_correction_request where work_date < ${cutoff}::date`);
  await db.execute(sql`delete from productivity_snapshot where month < ${cutoff}::date`);
  await db.execute(sql`delete from approval where approved_at < ${cutoff}`);
  const audit = await db.execute(sql`delete from audit_log where at < ${cutoff}`);
  const oldAbsences = sql`select id from absence where coalesce(to_date, from_date) < ${cutoff}::date`;
  await db.execute(sql`delete from team_absence where absence_id in (${oldAbsences})`);
  await db.execute(sql`delete from absence where id in (${oldAbsences})`);
  const accounts = await db.execute(sql`
    update app_user set display_name = 'Ehemaliger Mitarbeiter', email = '', roles = '{}'
    where not active and updated_at < ${cutoff} and display_name <> 'Ehemaliger Mitarbeiter'`);
  // Technical sync log: only needed to recognise re-sent commands (idempotency) – 90 days.
  const syncLog = await db.execute(
    sql`delete from sync_command where received_at < now() - interval '90 days'`,
  );
  return {
    messages: msgs.rowCount ?? 0,
    photos: photos.rowCount ?? 0,
    sickReports: sick.rowCount ?? 0,
    absenceComments: comments.rowCount ?? 0,
    notifications: notes.rowCount ?? 0,
    timeEntries: entries.rowCount ?? 0,
    stampEvents: stamps.rowCount ?? 0,
    auditEntries: audit.rowCount ?? 0,
    anonymisedAccounts: accounts.rowCount ?? 0,
    syncLog: syncLog.rowCount ?? 0,
  };
}

/**
 * Monthly productivity snapshots (ARCHITEKTUR 3.4, E-54): the previous month is recalculated daily until the 10th
 * of the following month (late approvals, corrections) and then stays frozen – the reproducible basis for a later
 * bonus system. Runs as worker (RLS: only the worker may write snapshots).
 */
export async function snapshotProductivity(db: Db, now = new Date()): Promise<number> {
  const today = localDate(now, 'Europe/Berlin');
  if (Number(today.slice(8, 10)) > SNAPSHOT_UNTIL_DAY) return 0;
  const month = shiftMonth(today.slice(0, 7), -1);
  return db.transaction(async (tx) => {
    const monteure = await tx
      .selectDistinct({
        userId: userLocation.userId,
        locationId: userLocation.locationId,
        timezone: location.timezone,
        bundesland: location.bundesland,
      })
      .from(userLocation)
      .innerJoin(location, eq(location.id, userLocation.locationId))
      .where(eq(userLocation.role, 'MONTEUR'));
    const seen = new Set<string>();
    let n = 0;
    for (const m of monteure) {
      if (seen.has(m.userId)) continue;
      seen.add(m.userId);
      const result = await computeMonth(
        tx,
        m.userId,
        { id: m.locationId, timezone: m.timezone, bundesland: m.bundesland },
        month,
      );
      if (!result.attendanceMinutes && !result.billedMinutes) continue;
      await tx
        .insert(productivitySnapshot)
        .values({
          userId: m.userId,
          month: `${month}-01`,
          locationId: m.locationId,
          result,
          mappingVersion: result.mappingVersion,
          configHash: result.configHash,
        })
        .onConflictDoUpdate({
          target: [productivitySnapshot.userId, productivitySnapshot.month],
          set: {
            result,
            mappingVersion: result.mappingVersion,
            configHash: result.configHash,
            calculatedAt: new Date(),
          },
        });
      n++;
    }
    return n;
  });
}
export const SNAPSHOT_UNTIL_DAY = 10;
