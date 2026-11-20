/**
 * Absences (PROMPT 5.9/5.10): sick reports and vacation requests.
 * Day counting is pure so the app can show the remaining vacation offline.
 */
import { type Bundesland, isWorkingDay } from '../material/holidays.js';
import { addDays } from '../time/tz.js';

export type AbsenceType = 'KRANK' | 'URLAUB';
export type AbsenceState =
  'REPORTED' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type HalfDay = 'NONE' | 'AM' | 'PM';

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = { KRANK: 'Krank', URLAUB: 'Urlaub' };
export const ABSENCE_STATE_LABELS: Record<AbsenceState, string> = {
  REPORTED: 'gemeldet',
  REQUESTED: 'beantragt',
  APPROVED: 'genehmigt',
  REJECTED: 'abgelehnt',
  CANCEL_REQUESTED: 'Storno beantragt',
  CANCELLED: 'storniert',
};
export const HALF_DAY_LABELS: Record<HalfDay, string> = {
  NONE: 'ganztags',
  AM: 'vormittags',
  PM: 'nachmittags',
};

/** BC cause of absence codes (PROMPT 5.9/5.10, configurable in the adapter). */
export const DEFAULT_CAUSE_CODES: Record<AbsenceType, string> = { KRANK: 'KRANK', URLAUB: 'URLAUB' };

/** States in which an absence blocks the Monteur (planning board, team calendar). */
export const ACTIVE_ABSENCE_STATES: readonly AbsenceState[] = ['REPORTED', 'APPROVED', 'CANCEL_REQUESTED'];
/** States that count against the vacation balance. */
const BOOKED: readonly AbsenceState[] = ['APPROVED', 'CANCEL_REQUESTED'];

/** All calendar days from..to (inclusive). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 3700) throw new Error('Zeitraum zu lang');
  }
  return out;
}

/**
 * Working days of an absence (Mon–Fri without public holidays of the Bundesland).
 * A half day counts 0.5 and is only allowed for a single day. Optionally limited to one calendar year.
 */
export function absenceDays(
  a: { fromDate: string; toDate: string | null; halfDay?: HalfDay },
  land: Bundesland,
  year?: number,
): number {
  const to = a.toDate ?? a.fromDate;
  if (to < a.fromDate) return 0;
  const days = eachDay(a.fromDate, to).filter(
    (d) => isWorkingDay(d, land) && (year === undefined || d.startsWith(`${year}-`)),
  );
  if (a.halfDay && a.halfDay !== 'NONE') return days.length ? 0.5 : 0;
  return days.length;
}

export interface VacationBalance {
  year: number;
  entitlement: number;
  carryOver: number;
  /** Approved (incl. cancel requested). */
  taken: number;
  /** Requested, not decided yet. */
  requested: number;
  /** entitlement + carry-over − taken − requested */
  remaining: number;
}

export function vacationBalance(
  year: number,
  base: { entitlementDays: number; carryOverDays: number } | null,
  absences: Array<{
    type: AbsenceType;
    state: AbsenceState;
    fromDate: string;
    toDate: string | null;
    halfDay: HalfDay;
  }>,
  land: Bundesland,
): VacationBalance {
  const vac = absences.filter((a) => a.type === 'URLAUB');
  const sum = (states: readonly AbsenceState[]) =>
    vac.filter((a) => states.includes(a.state)).reduce((s, a) => s + absenceDays(a, land, year), 0);
  const entitlement = base?.entitlementDays ?? 0;
  const carryOver = base?.carryOverDays ?? 0;
  const taken = sum(BOOKED);
  const requested = sum(['REQUESTED']);
  return {
    year,
    entitlement,
    carryOver,
    taken,
    requested,
    remaining: entitlement + carryOver - taken - requested,
  };
}

/** Does the absence cover the local date? Open-ended sick reports cover everything from fromDate on. */
export function coversDate(a: { fromDate: string; toDate: string | null }, date: string): boolean {
  return a.fromDate <= date && (a.toDate === null || date <= a.toDate);
}

/** Do two date ranges overlap? (null toDate = open end) */
export function rangesOverlap(
  a: { fromDate: string; toDate: string | null },
  b: { fromDate: string; toDate: string | null },
): boolean {
  return a.fromDate <= (b.toDate ?? '9999-12-31') && b.fromDate <= (a.toDate ?? '9999-12-31');
}
