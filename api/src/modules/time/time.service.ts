import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  addDays,
  allocateBillable,
  DEFAULT_ROUNDING,
  deriveSegments,
  localDate,
  segmentMinutes,
  zonedToUtc,
  type RoundingConfig,
  type StampEvent,
} from '@schroeder/shared';
import type { Tx } from '../../db/client.js';
import { location, setting, stampEvent, stampEventVoid, timeEntry } from '../../db/schema.js';

export interface RecomputeResult {
  workDates: string[];
  /** Days where approved/submitted entries exist – late events are not applied automatically. */
  lockedDates: string[];
}

/**
 * Derives time_entry rows from raw stamp events (E-07). Idempotent: segment keys are deterministic,
 * so recomputing after every event (also replays) yields the same rows.
 */
@Injectable()
export class TimeService {
  async rounding(tx: Tx, locationId: string): Promise<RoundingConfig> {
    const rows = await tx
      .select()
      .from(setting)
      .where(
        and(eq(setting.key, 'rounding'), or(eq(setting.locationId, locationId), isNull(setting.locationId))),
      );
    const pick = rows.find((r) => r.locationId === locationId) ?? rows[0];
    return { ...DEFAULT_ROUNDING, ...((pick?.value as Partial<RoundingConfig>) ?? {}) };
  }

  async locationTz(tx: Tx, locationId: string): Promise<string> {
    const [l] = await tx.select({ tz: location.timezone }).from(location).where(eq(location.id, locationId));
    return l?.tz ?? 'Europe/Berlin';
  }

  /** Recomputes the entries of the local days touched by `at` (that day and the day before). */
  async recompute(tx: Tx, userId: string, locationId: string, at: Date): Promise<RecomputeResult> {
    const tz = await this.locationTz(tx, locationId);
    const day = localDate(at, tz);
    const dates = [addDays(day, -1), day];
    const from = zonedToUtc(addDays(day, -2), '00:00', tz);
    const to = zonedToUtc(addDays(day, 2), '00:00', tz);

    const rows = await tx
      .select()
      .from(stampEvent)
      .where(
        and(
          eq(stampEvent.userId, userId),
          gte(stampEvent.deviceTime, from),
          lt(stampEvent.deviceTime, to),
          // voided by a Meister correction (E-37)
          sql`not exists (select 1 from ${stampEventVoid} v where v.event_id = ${stampEvent.id})`,
        ),
      );
    const events: StampEvent[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      deviceTime: r.deviceTime.toISOString(),
      orderId: r.orderId,
      activity: r.activity,
      overheadCode: r.overheadCode,
    }));
    const flagged = rows.filter((r) => r.skewFlag).map((r) => r.deviceTime.getTime());
    const segments = deriveSegments(events, tz).filter((s) => dates.includes(s.workDate));

    const existing = await tx
      .select()
      .from(timeEntry)
      .where(
        and(
          eq(timeEntry.userId, userId),
          inArray(timeEntry.workDate, dates),
          isNotNull(timeEntry.segmentKey),
        ),
      );
    const lockedDates = [...new Set(existing.filter((e) => e.state !== 'OPEN').map((e) => e.workDate))];
    const editable = segments.filter((s) => !lockedDates.includes(s.workDate));

    const cfg = await this.rounding(tx, locationId);
    const billable = allocateBillable(
      editable
        .filter((s) => s.kind === 'ORDER' && s.end)
        .map((s) => ({
          id: s.id,
          workDate: s.workDate,
          orderId: s.orderId!,
          activity: s.activity!,
          actualMinutes: segmentMinutes(s),
        })),
      cfg,
    );

    for (const s of editable) {
      const start = Date.parse(s.start);
      const end = s.end ? Date.parse(s.end) : Infinity;
      const values = {
        userId,
        locationId,
        workDate: s.workDate,
        kind: s.kind,
        orderId: s.orderId,
        activity: s.activity,
        overheadCode: s.overheadCode,
        startAt: new Date(s.start),
        endAt: s.end ? new Date(s.end) : null,
        actualMinutes: s.end ? Math.round(segmentMinutes(s)) : null,
        billableMinutes: billable.get(s.id) ?? null,
        skewFlag: flagged.some((t) => t >= start && t <= end),
        segmentKey: s.id,
        // a closed segment no longer needs the forgotten-clock-out correction
        ...(s.end ? { needsCorrection: false } : {}),
      };
      await tx
        .insert(timeEntry)
        .values(values)
        .onConflictDoUpdate({
          target: [timeEntry.userId, timeEntry.segmentKey],
          set: { ...values, updatedAt: new Date() },
          setWhere: sql`${timeEntry.state} = 'OPEN'`,
        });
    }

    const keep = new Set(editable.map((s) => s.id));
    const stale = existing.filter(
      (e) =>
        e.state === 'OPEN' && e.segmentKey && !keep.has(e.segmentKey) && !lockedDates.includes(e.workDate),
    );
    if (stale.length)
      await tx.delete(timeEntry).where(
        and(
          eq(timeEntry.userId, userId),
          inArray(
            timeEntry.id,
            stale.map((e) => e.id),
          ),
        ),
      );

    return { workDates: dates, lockedDates };
  }
}
