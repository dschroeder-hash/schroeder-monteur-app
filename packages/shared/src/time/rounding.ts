export type RoundingMode = 'commercial' | 'up' | 'down';
export type RoundingBasis = 'segment' | 'daily_sum';

/**
 * Stamp clock (Stempeluhr) as in BC today: every stamp is set to the quarter hour. Starting (Kommen, start on an
 * order, end of break) keeps the earlier quarter within the grace period (up to 07:35:59 → 07:30, from 07:36:00 →
 * 07:45); stopping (Gehen, stop, start of break) always rounds down (16:29:59 → 16:15). null = to the minute.
 */
export interface StampClockConfig {
  gridMinutes: number;
  startGraceMinutes: number;
}

export interface RoundingConfig {
  gridMinutes: number;
  mode: RoundingMode;
  basis: RoundingBasis;
  stampClock?: StampClockConfig | null;
}

export const DEFAULT_STAMP_CLOCK: StampClockConfig = { gridMinutes: 15, startGraceMinutes: 5 };
export const DEFAULT_ROUNDING: RoundingConfig = {
  gridMinutes: 15,
  mode: 'commercial',
  basis: 'daily_sum',
  stampClock: DEFAULT_STAMP_CLOCK,
};

const START_KINDS = new Set(['CLOCK_IN', 'JOB_START', 'OVERHEAD_START', 'BREAK_STOP']);

/**
 * Stamp time on the quarter-hour grid (E-69). The grid is aligned to UTC; all German offsets are whole hours, so
 * it matches the local quarter hours.
 */
export function roundStampTime(iso: string, kind: string, cfg: StampClockConfig): string {
  const t = Date.parse(iso);
  const grid = cfg.gridMinutes * 60_000;
  if (grid <= 0) return iso;
  const floor = Math.floor(t / grid) * grid;
  if (!START_KINDS.has(kind)) return new Date(floor).toISOString();
  return new Date(t - floor < cfg.startGraceMinutes * 60_000 + 60_000 ? floor : floor + grid).toISOString();
}

export function roundMinutes(minutes: number, grid: number, mode: RoundingMode): number {
  if (grid <= 1) return Math.round(minutes);
  const q = minutes / grid;
  const r = mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return r * grid;
}

export interface BillableInput {
  id: string;
  workDate: string;
  orderId: string;
  activity: string;
  actualMinutes: number;
}

/**
 * Billable minutes per order segment (ENTSCHEIDUNGEN E-15). Actual minutes are always kept;
 * with basis `daily_sum` the rounded daily total per order × activity is distributed so that the
 * segments add up exactly to the rounded total (the difference goes to the last segment).
 */
export function allocateBillable(
  entries: readonly BillableInput[],
  cfg: RoundingConfig,
): Map<string, number> {
  const result = new Map<string, number>();
  if (cfg.basis === 'segment') {
    for (const e of entries) result.set(e.id, roundMinutes(e.actualMinutes, cfg.gridMinutes, cfg.mode));
    return result;
  }
  const groups = new Map<string, BillableInput[]>();
  for (const e of entries) {
    const k = `${e.workDate}|${e.orderId}|${e.activity}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const list of groups.values()) {
    const total = list.reduce((s, e) => s + e.actualMinutes, 0);
    const rounded = roundMinutes(total, cfg.gridMinutes, cfg.mode);
    let assigned = 0;
    list.forEach((e, i) => {
      const v = i === list.length - 1 ? rounded - assigned : Math.round(e.actualMinutes);
      result.set(e.id, v);
      assigned += v;
    });
  }
  return result;
}
