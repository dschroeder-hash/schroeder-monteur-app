import type { Activity, Segment } from './model.js';
import { segmentMinutes } from './segments.js';

export type WorkTimeWarningCode =
  'BREAK_TOO_SHORT' | 'NO_BREAK_AFTER_6H' | 'DAILY_MAX_EXCEEDED' | 'REST_TOO_SHORT' | 'OPEN_ATTENDANCE';

export interface WorkTimeWarning {
  code: WorkTimeWarningCode;
  message: string;
}

export interface DaySummary {
  workDate: string;
  attendanceMinutes: number;
  breakMinutes: number;
  /** attendance minus declared breaks */
  workMinutes: number;
  orderMinutes: number;
  travelMinutes: number;
  overheadMinutes: number;
  /** attendance not booked on an order, overhead or break */
  unassignedMinutes: number;
  byOrder: Array<{ orderId: string; activity: Activity; minutes: number }>;
  byOverhead: Array<{ code: string; minutes: number }>;
  warnings: WorkTimeWarning[];
}

const fmtH = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} h`;

/** Statutory limits (ArbZG §§ 3, 4, 5). Warnings only – nothing is blocked (PROMPT 5.1). */
export const ARBZG = {
  breakBlockMin: 15,
  breakAfter6h: 30,
  breakAfter9h: 45,
  maxDailyWork: 600,
  minRest: 660,
  maxContinuous: 360,
} as const;

export function summarizeDay(
  workDate: string,
  daySegments: readonly Segment[],
  opts: { previousAttendanceEnd?: string | null; now?: Date } = {},
): DaySummary {
  const now = opts.now ?? new Date();
  const segs = daySegments.filter((s) => s.workDate === workDate);
  const sum = (f: (s: Segment) => boolean) => segs.filter(f).reduce((a, s) => a + segmentMinutes(s, now), 0);
  const attendanceMinutes = sum((s) => s.kind === 'ATTENDANCE');
  const breaks = segs.filter((s) => s.kind === 'BREAK');
  const breakMinutes = sum((s) => s.kind === 'BREAK');
  const workMinutes = Math.max(0, attendanceMinutes - breakMinutes);
  const orderMinutes = sum((s) => s.kind === 'ORDER');
  const overheadMinutes = sum((s) => s.kind === 'OVERHEAD');

  const byOrderMap = new Map<string, { orderId: string; activity: Activity; minutes: number }>();
  for (const s of segs.filter((x) => x.kind === 'ORDER')) {
    const k = `${s.orderId}|${s.activity}`;
    const cur = byOrderMap.get(k) ?? { orderId: s.orderId!, activity: s.activity!, minutes: 0 };
    cur.minutes += segmentMinutes(s, now);
    byOrderMap.set(k, cur);
  }
  const byOverheadMap = new Map<string, number>();
  for (const s of segs.filter((x) => x.kind === 'OVERHEAD'))
    byOverheadMap.set(s.overheadCode!, (byOverheadMap.get(s.overheadCode!) ?? 0) + segmentMinutes(s, now));

  const warnings: WorkTimeWarning[] = [];
  const qualifying = breaks.filter((b) => segmentMinutes(b, now) >= ARBZG.breakBlockMin);
  const qualifyingMinutes = qualifying.reduce((a, b) => a + segmentMinutes(b, now), 0);
  const required = workMinutes > 9 * 60 ? ARBZG.breakAfter9h : workMinutes > 6 * 60 ? ARBZG.breakAfter6h : 0;
  if (required > 0 && qualifyingMinutes < required)
    warnings.push({
      code: 'BREAK_TOO_SHORT',
      message: `Bei ${fmtH(workMinutes)} Arbeitszeit sind ${required} min Pause vorgeschrieben (Blöcke ab 15 min), erfasst: ${Math.round(qualifyingMinutes)} min.`,
    });

  // Longest stretch of attendance without a qualifying break.
  for (const att of segs.filter((s) => s.kind === 'ATTENDANCE')) {
    let cursor = Date.parse(att.start);
    const end = Date.parse(att.end ?? now.toISOString());
    let longest = 0;
    for (const b of [...qualifying].sort((x, y) => Date.parse(x.start) - Date.parse(y.start))) {
      const bs = Date.parse(b.start);
      if (bs < cursor || bs > end) continue;
      longest = Math.max(longest, bs - cursor);
      cursor = Date.parse(b.end ?? now.toISOString());
    }
    longest = Math.max(longest, end - cursor);
    if (longest / 60_000 > ARBZG.maxContinuous) {
      warnings.push({
        code: 'NO_BREAK_AFTER_6H',
        message: 'Länger als 6 Stunden am Stück ohne Pause gearbeitet.',
      });
      break;
    }
  }

  if (workMinutes > ARBZG.maxDailyWork)
    warnings.push({
      code: 'DAILY_MAX_EXCEEDED',
      message: `Arbeitszeit ${fmtH(workMinutes)} überschreitet 10 Stunden.`,
    });

  const firstStart = segs
    .filter((s) => s.kind === 'ATTENDANCE')
    .map((s) => Date.parse(s.start))
    .sort((a, b) => a - b)[0];
  if (opts.previousAttendanceEnd && firstStart !== undefined) {
    const rest = (firstStart - Date.parse(opts.previousAttendanceEnd)) / 60_000;
    if (rest >= 0 && rest < ARBZG.minRest)
      warnings.push({
        code: 'REST_TOO_SHORT',
        message: `Ruhezeit seit gestern nur ${fmtH(rest)} (mindestens 11 Stunden).`,
      });
  }

  return {
    workDate,
    attendanceMinutes,
    breakMinutes,
    workMinutes,
    orderMinutes,
    travelMinutes: [...byOrderMap.values()]
      .filter((o) => o.activity === 'TRAVEL')
      .reduce((a, o) => a + o.minutes, 0),
    overheadMinutes,
    unassignedMinutes: Math.max(0, workMinutes - orderMinutes - overheadMinutes),
    byOrder: [...byOrderMap.values()],
    byOverhead: [...byOverheadMap.entries()].map(([code, minutes]) => ({ code, minutes })),
    warnings,
  };
}
