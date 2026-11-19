import type { Activity, Segment, SegmentKind, StampEvent } from './model.js';
import { localDate } from './tz.js';

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

export function sortEvents(events: readonly StampEvent[]): StampEvent[] {
  return [...events].sort(
    (a, b) =>
      Date.parse(a.deviceTime) - Date.parse(b.deviceTime) ||
      (a.seq ?? 0) - (b.seq ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

interface Running {
  id: string;
  start: string;
  orderId: string | null;
  activity: Activity | null;
  overheadCode: string | null;
}

/**
 * Derives time segments from raw stamp events (ARCHITEKTUR 3.2). Pure and deterministic – runs identically
 * on the device (offline) and on the server.
 *
 * Rules:
 *  - At most one job/overhead segment runs at a time; JOB_START/OVERHEAD_START ends the running one (direct switch).
 *  - JOB_START/OVERHEAD_START/BREAK_START without attendance opens attendance implicitly at the same time.
 *  - BREAK_START interrupts the running job; BREAK_STOP resumes it as a new segment.
 *  - CLOCK_OUT ends everything.
 *  - Duplicate or meaningless events (e.g. second CLOCK_IN) are ignored, never fatal.
 */
export function deriveSegments(events: readonly StampEvent[], tz: string): Segment[] {
  const out: Segment[] = [];
  type Job = Running & { kind: 'ORDER' | 'OVERHEAD' };
  type Brk = { id: string; start: string; resume: Job | null };
  const st: { attendance: { id: string; start: string } | null; job: Job | null; brk: Brk | null } = {
    attendance: null,
    job: null,
    brk: null,
  };

  const close = (kind: SegmentKind, r: Running, end: string) => {
    if (Date.parse(end) <= Date.parse(r.start)) return; // zero-length segments are dropped
    out.push({
      id: `${r.id}:${kind}`,
      kind,
      start: r.start,
      end,
      orderId: r.orderId,
      activity: r.activity,
      overheadCode: r.overheadCode,
      workDate: localDate(new Date(r.start), tz),
    });
  };
  const empty = { orderId: null, activity: null, overheadCode: null };
  const ensureAttendance = (e: StampEvent) => {
    if (!st.attendance) st.attendance = { id: e.id, start: e.deviceTime };
  };
  const stopJob = (t: string) => {
    if (st.job) close(st.job.kind, st.job, t);
    st.job = null;
  };
  const stopBreak = (t: string) => {
    if (st.brk) close('BREAK', { id: st.brk.id, start: st.brk.start, ...empty }, t);
    st.brk = null;
  };

  for (const e of sortEvents(events)) {
    const t = e.deviceTime;
    switch (e.kind) {
      case 'CLOCK_IN':
        ensureAttendance(e);
        break;
      case 'CLOCK_OUT':
        if (!st.attendance) break;
        stopJob(t);
        stopBreak(t);
        close('ATTENDANCE', { id: st.attendance.id, start: st.attendance.start, ...empty }, t);
        st.attendance = null;
        break;
      case 'JOB_START':
        if (!e.orderId) break;
        ensureAttendance(e);
        stopBreak(t);
        stopJob(t);
        st.job = {
          kind: 'ORDER',
          id: e.id,
          start: t,
          orderId: e.orderId,
          activity: e.activity ?? 'WORK',
          overheadCode: null,
        };
        break;
      case 'OVERHEAD_START':
        if (!e.overheadCode) break;
        ensureAttendance(e);
        stopBreak(t);
        stopJob(t);
        st.job = {
          kind: 'OVERHEAD',
          id: e.id,
          start: t,
          orderId: null,
          activity: null,
          overheadCode: e.overheadCode,
        };
        break;
      case 'JOB_PAUSE':
      case 'JOB_STOP':
        if (st.job?.kind === 'ORDER') stopJob(t);
        break;
      case 'OVERHEAD_STOP':
        if (st.job?.kind === 'OVERHEAD') stopJob(t);
        break;
      case 'BREAK_START': {
        if (st.brk) break;
        ensureAttendance(e);
        const resume: Job | null = st.job;
        stopJob(t);
        st.brk = { id: e.id, start: t, resume };
        break;
      }
      case 'BREAK_STOP':
        if (!st.brk) break;
        {
          const resume: Job | null = st.brk.resume;
          stopBreak(t);
          if (resume) st.job = { ...resume, id: e.id, start: t };
        }
        break;
    }
  }

  // Running segments stay open.
  const open = (kind: SegmentKind, r: Running) =>
    out.push({
      id: `${r.id}:${kind}`,
      kind,
      start: r.start,
      end: null,
      orderId: r.orderId,
      activity: r.activity,
      overheadCode: r.overheadCode,
      workDate: localDate(new Date(r.start), tz),
    });
  const a = st.attendance;
  const j = st.job;
  const b = st.brk;
  if (a) open('ATTENDANCE', { id: a.id, start: a.start, ...empty });
  if (j) open(j.kind, j);
  if (b) open('BREAK', { id: b.id, start: b.start, ...empty });
  return out.sort((x, y) => Date.parse(x.start) - Date.parse(y.start) || x.kind.localeCompare(y.kind));
}

export function segmentMinutes(s: Segment, now: Date = new Date()): number {
  return Math.max(0, minutesBetween(s.start, s.end ?? now.toISOString()));
}

/** Current state for the stamp bar. */
export function currentState(segments: readonly Segment[]) {
  const running = segments.filter((s) => s.end === null);
  return {
    clockedIn: running.some((s) => s.kind === 'ATTENDANCE'),
    onBreak: running.find((s) => s.kind === 'BREAK') ?? null,
    job: running.find((s) => s.kind === 'ORDER' || s.kind === 'OVERHEAD') ?? null,
  };
}
