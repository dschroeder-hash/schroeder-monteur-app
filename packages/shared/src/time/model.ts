import { z } from 'zod';

export const STAMP_KINDS = [
  'CLOCK_IN',
  'CLOCK_OUT',
  'JOB_START',
  'JOB_PAUSE',
  'JOB_STOP',
  'OVERHEAD_START',
  'OVERHEAD_STOP',
  'BREAK_START',
  'BREAK_STOP',
] as const;
export type StampKind = (typeof STAMP_KINDS)[number];

export const ACTIVITIES = ['WORK', 'TRAVEL', 'DIAGNOSIS'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABELS: Record<Activity, string> = {
  WORK: 'Arbeitszeit',
  TRAVEL: 'Fahrzeit',
  DIAGNOSIS: 'Diagnose',
};

export interface StampEvent {
  id: string;
  kind: StampKind;
  /** Device timestamp (ISO). Authoritative for the working time (E-07). */
  deviceTime: string;
  orderId?: string | null;
  activity?: Activity | null;
  overheadCode?: string | null;
  /** Tie-breaker for identical timestamps (device sequence). */
  seq?: number;
}

export type SegmentKind = 'ATTENDANCE' | 'ORDER' | 'OVERHEAD' | 'BREAK';

export interface Segment {
  /** Deterministic id: derived from the opening event so recomputation is idempotent. */
  id: string;
  kind: SegmentKind;
  start: string;
  /** null = still running */
  end: string | null;
  orderId: string | null;
  activity: Activity | null;
  overheadCode: string | null;
  /** Local date (location time zone) of the segment start. */
  workDate: string;
}

export const stampEventSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(STAMP_KINDS),
  deviceTime: z.string().datetime({ offset: true }),
  orderId: z.string().uuid().nullish(),
  activity: z.enum(ACTIVITIES).nullish(),
  overheadCode: z.string().max(40).nullish(),
});

/** Short labels for the large start buttons. */
export const ACTIVITY_SHORT_LABELS: Record<Activity, string> = {
  WORK: 'Arbeit',
  TRAVEL: 'Fahrt',
  DIAGNOSIS: 'Diagnose',
};
