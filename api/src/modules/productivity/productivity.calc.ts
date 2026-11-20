/**
 * Loads the inputs of the productivity engine for one Monteur and month. Runs inside a RLS session (API: the
 * Monteur sees only own data, the Meister his location) or as worker (monthly snapshots).
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  absenceDays,
  calculateProductivity,
  DEFAULT_PRODUCTIVITY_CONFIG,
  holidays,
  localDate,
  type Bundesland,
  type MappingRule,
  type ProductivityConfig,
  type ProductivityOrder,
  type ProductivityResult,
} from '@schroeder/shared';
import type { Tx } from '../../db/client.js';
import {
  absence,
  orderStatusEvent,
  orderTypeMapping,
  overheadType,
  serviceOrder,
  setting,
  timeEntry,
  workReport,
} from '../../db/schema.js';

export interface Loc {
  id: string;
  timezone: string;
  bundesland: string;
}

export const monthStart = (month: string) => `${month}-01`;
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export async function productivityConfig(tx: Tx, locationId: string): Promise<ProductivityConfig> {
  const rows = await tx
    .select()
    .from(setting)
    .where(
      and(
        eq(setting.key, 'productivity'),
        or(isNull(setting.locationId), eq(setting.locationId, locationId)),
      ),
    );
  const v = ((rows.find((r) => r.locationId === locationId) ?? rows.find((r) => !r.locationId))?.value ??
    {}) as Partial<ProductivityConfig>;
  return { ...DEFAULT_PRODUCTIVITY_CONFIG, ...v };
}

export async function mappingRules(tx: Tx): Promise<MappingRule[]> {
  return (await tx.select().from(orderTypeMapping).orderBy(asc(orderTypeMapping.validFrom))).map((r) => ({
    orderTypeCode: r.orderTypeCode,
    category: r.category,
    productive: r.productive,
    external: r.external,
    validFrom: r.validFrom,
  }));
}

export async function computeMonth(
  tx: Tx,
  userId: string,
  loc: Loc,
  month: string,
  shared?: {
    mapping: MappingRule[];
    config: ProductivityConfig;
    overheads: Array<{ code: string; countsAsAttendance: boolean }>;
  },
): Promise<ProductivityResult> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const mapping = shared?.mapping ?? (await mappingRules(tx));
  const config = shared?.config ?? (await productivityConfig(tx, loc.id));
  const overheads =
    shared?.overheads ??
    (await tx
      .select({ code: overheadType.code, countsAsAttendance: overheadType.countsAsAttendance })
      .from(overheadType));

  const entries = await tx
    .select({
      workDate: timeEntry.workDate,
      kind: timeEntry.kind,
      orderId: timeEntry.orderId,
      activity: timeEntry.activity,
      overheadCode: timeEntry.overheadCode,
      actualMinutes: timeEntry.actualMinutes,
      billableMinutes: timeEntry.billableMinutes,
      state: timeEntry.state,
    })
    .from(timeEntry)
    .where(and(eq(timeEntry.userId, userId), gte(timeEntry.workDate, from), lte(timeEntry.workDate, to)));

  const orderIds = [...new Set(entries.map((e) => e.orderId).filter((x): x is string => !!x))];

  // Orders the Monteur finished in the month (first "Fertig"/"Fertig – Doku offen" set by him) – documentation quota.
  const tz = loc.timezone;
  const finished = await tx
    .select({ orderId: orderStatusEvent.orderId, at: sql<Date>`min(${orderStatusEvent.at})` })
    .from(orderStatusEvent)
    .where(
      and(
        eq(orderStatusEvent.actorId, userId),
        inArray(orderStatusEvent.toStatus, ['FERTIG', 'FERTIG_DOKU_OFFEN']),
        sql`(${orderStatusEvent.at} at time zone ${tz})::date between ${from}::date and ${to}::date`,
      ),
    )
    .groupBy(orderStatusEvent.orderId);
  const allOrderIds = [...new Set([...orderIds, ...finished.map((f) => f.orderId)])];
  const orderRows = allOrderIds.length
    ? await tx
        .select({
          id: serviceOrder.id,
          orderTypeCode: serviceOrder.orderTypeCode,
          description: serviceOrder.description,
          reworkFlag: serviceOrder.reworkFlag,
        })
        .from(serviceOrder)
        .where(inArray(serviceOrder.id, allOrderIds))
    : [];
  const orders: Record<string, ProductivityOrder> = Object.fromEntries(orderRows.map((o) => [o.id, o]));
  const reports = finished.length
    ? await tx
        .select({ orderId: workReport.orderId, completedAt: workReport.completedAt })
        .from(workReport)
        .where(
          inArray(
            workReport.orderId,
            finished.map((f) => f.orderId),
          ),
        )
    : [];

  const land = loc.bundesland as Bundesland;
  const abs = await tx
    .select()
    .from(absence)
    .where(
      and(
        eq(absence.userId, userId),
        inArray(absence.state, ['REPORTED', 'APPROVED', 'CANCEL_REQUESTED']),
        lte(absence.fromDate, to),
        or(isNull(absence.toDate), gte(absence.toDate, from)),
      ),
    );
  const today = localDate(new Date(), tz);
  const clip = (a: typeof absence.$inferSelect) => ({
    fromDate: a.fromDate < from ? from : a.fromDate,
    toDate: [a.toDate ?? (today < to ? today : to), to].sort()[0]!,
    halfDay: a.halfDay,
  });
  const days = (t: 'KRANK' | 'URLAUB') =>
    abs.filter((a) => a.type === t).reduce((s, a) => s + absenceDays(clip(a), land), 0);
  const holidayCount = [...holidays(Number(month.slice(0, 4)), land).keys()].filter((d) => {
    if (!d.startsWith(`${month}-`)) return false;
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    return wd !== 0 && wd !== 6;
  }).length;

  return calculateProductivity({
    month,
    entries: entries.map((e) => ({ ...e, actualMinutes: e.actualMinutes ?? 0 })),
    orders,
    mapping,
    overheadTypes: overheads,
    documentation: finished.map((f) => ({
      orderId: f.orderId,
      finishedDate: localDate(new Date(f.at), tz),
      completedDate: (() => {
        const c = reports.find((r) => r.orderId === f.orderId)?.completedAt;
        return c ? localDate(c, tz) : null;
      })(),
    })),
    absence: { vacationDays: days('URLAUB'), sickDays: days('KRANK'), holidays: holidayCount },
    config,
  });
}
