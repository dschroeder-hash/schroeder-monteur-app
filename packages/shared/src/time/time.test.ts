import { describe, expect, it } from 'vitest';
import type { StampEvent, StampKind } from './model.js';
import { allocateBillable, roundMinutes } from './rounding.js';
import { currentState, deriveSegments, segmentMinutes } from './segments.js';
import { summarizeDay } from './summary.js';
import { localDate, zonedToUtc } from './tz.js';

const TZ = 'Europe/Berlin';
const DAY = '2026-11-16';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
let n = 0;
const ev = (time: string, kind: StampKind, extra: Partial<StampEvent> = {}, date = DAY): StampEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  kind,
  deviceTime: zonedToUtc(date, time, TZ).toISOString(),
  ...extra,
});

/** Reference day from PROMPT 5.1: three orders, travel time and a break. */
const referenceDay = (): StampEvent[] => [
  ev('07:00', 'CLOCK_IN'),
  ev('07:00', 'JOB_START', { orderId: A, activity: 'TRAVEL' }),
  ev('07:30', 'JOB_START', { orderId: A, activity: 'WORK' }),
  ev('09:45', 'JOB_START', { orderId: B, activity: 'TRAVEL' }),
  ev('10:10', 'JOB_START', { orderId: B, activity: 'WORK' }),
  ev('12:00', 'BREAK_START'),
  ev('12:30', 'BREAK_STOP'),
  ev('13:15', 'JOB_START', { orderId: C, activity: 'WORK' }),
  ev('15:50', 'JOB_STOP', { orderId: C }),
  ev('16:00', 'CLOCK_OUT'),
];

describe('reference working day (acceptance 5.1)', () => {
  const segs = deriveSegments(referenceDay(), TZ);
  const sum = summarizeDay(DAY, segs);

  it('computes attendance, break and work time', () => {
    expect(sum.attendanceMinutes).toBe(540);
    expect(sum.breakMinutes).toBe(30);
    expect(sum.workMinutes).toBe(510);
  });

  it('computes order times per order and activity', () => {
    const get = (o: string, a: string) =>
      sum.byOrder.find((x) => x.orderId === o && x.activity === a)?.minutes;
    expect(get(A, 'TRAVEL')).toBe(30);
    expect(get(A, 'WORK')).toBe(135);
    expect(get(B, 'TRAVEL')).toBe(25);
    expect(get(B, 'WORK')).toBe(155); // 110 before + 45 after the break (resumed automatically)
    expect(get(C, 'WORK')).toBe(155);
    expect(sum.orderMinutes).toBe(500);
    expect(sum.travelMinutes).toBe(55);
    expect(sum.unassignedMinutes).toBe(10);
  });

  it('has no work time warnings', () => {
    expect(sum.warnings).toEqual([]);
  });

  it('never runs two order segments at the same time', () => {
    const orders = segs.filter((s) => s.kind === 'ORDER').sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < orders.length; i++) expect(orders[i]!.start >= orders[i - 1]!.end!).toBe(true);
  });

  it('rounds the daily sum per order and activity to quarter hours (E-15)', () => {
    const entries = segs
      .filter((s) => s.kind === 'ORDER')
      .map((s) => ({
        id: s.id,
        workDate: s.workDate,
        orderId: s.orderId!,
        activity: s.activity!,
        actualMinutes: segmentMinutes(s),
      }));
    const billable = allocateBillable(entries, { gridMinutes: 15, mode: 'commercial', basis: 'daily_sum' });
    const total = (o: string, a: string) =>
      entries.filter((e) => e.orderId === o && e.activity === a).reduce((s, e) => s + billable.get(e.id)!, 0);
    expect(total(A, 'TRAVEL')).toBe(30);
    expect(total(A, 'WORK')).toBe(135);
    expect(total(B, 'TRAVEL')).toBe(30);
    expect(total(B, 'WORK')).toBe(150);
    expect(total(C, 'WORK')).toBe(150);
    // actual minutes are untouched
    expect(entries.reduce((s, e) => s + e.actualMinutes, 0)).toBe(500);
  });

  it('is deterministic and order-independent (offline events arriving shuffled)', () => {
    const shuffled = [...referenceDay()].reverse();
    expect(deriveSegments(shuffled, TZ).map((s) => [s.kind, s.start, s.end])).toEqual(
      deriveSegments(referenceDay(), TZ).map((s) => [s.kind, s.start, s.end]),
    );
  });
});

describe('stamping rules', () => {
  it('starting a job without clock-in opens attendance implicitly', () => {
    const segs = deriveSegments([ev('08:00', 'JOB_START', { orderId: A, activity: 'WORK' })], TZ);
    expect(currentState(segs).clockedIn).toBe(true);
    expect(currentState(segs).job?.orderId).toBe(A);
  });

  it('clock-out ends running job and break', () => {
    const segs = deriveSegments(
      [ev('08:00', 'CLOCK_IN'), ev('08:10', 'JOB_START', { orderId: A }), ev('11:00', 'CLOCK_OUT')],
      TZ,
    );
    expect(segs.every((s) => s.end !== null)).toBe(true);
    expect(segs.find((s) => s.kind === 'ORDER')!.activity).toBe('WORK');
  });

  it('ignores duplicate clock-in and stray stops', () => {
    const segs = deriveSegments(
      [ev('08:00', 'CLOCK_IN'), ev('08:05', 'CLOCK_IN'), ev('08:06', 'JOB_STOP'), ev('09:00', 'CLOCK_OUT')],
      TZ,
    );
    expect(segs).toHaveLength(1);
    expect(segmentMinutes(segs[0]!)).toBe(60);
  });

  it('pause ends the job; overhead time is separate', () => {
    const segs = deriveSegments(
      [
        ev('08:00', 'JOB_START', { orderId: A }),
        ev('09:00', 'JOB_PAUSE'),
        ev('09:00', 'OVERHEAD_START', { overheadCode: 'WARTEN_TEILE' }),
        ev('09:30', 'JOB_START', { orderId: A }),
        ev('10:00', 'CLOCK_OUT'),
      ],
      TZ,
    );
    const s = summarizeDay(DAY, segs);
    expect(s.byOverhead).toEqual([{ code: 'WARTEN_TEILE', minutes: 30 }]);
    expect(s.orderMinutes).toBe(90);
  });
});

describe('ArbZG warnings (warn only)', () => {
  it('30 min break required above 6 h, 15-minute blocks only', () => {
    const segs = deriveSegments(
      [
        ev('07:00', 'CLOCK_IN'),
        ev('10:00', 'BREAK_START'),
        ev('10:10', 'BREAK_STOP'),
        ev('12:00', 'BREAK_START'),
        ev('12:20', 'BREAK_STOP'),
        ev('14:00', 'CLOCK_OUT'),
      ],
      TZ,
    );
    const s = summarizeDay(DAY, segs);
    expect(s.workMinutes).toBe(390);
    expect(s.warnings.map((w) => w.code)).toContain('BREAK_TOO_SHORT'); // only the 20-minute block counts
  });

  it('45 min above 9 h and more than 10 h per day', () => {
    const segs = deriveSegments(
      [
        ev('06:00', 'CLOCK_IN'),
        ev('11:00', 'BREAK_START'),
        ev('11:30', 'BREAK_STOP'),
        ev('17:00', 'CLOCK_OUT'),
      ],
      TZ,
    );
    const codes = summarizeDay(DAY, segs).warnings.map((w) => w.code);
    expect(codes).toContain('BREAK_TOO_SHORT');
    expect(codes).toContain('DAILY_MAX_EXCEEDED');
  });

  it('more than 6 h in a row without break', () => {
    const segs = deriveSegments(
      [
        ev('06:00', 'CLOCK_IN'),
        ev('12:30', 'BREAK_START'),
        ev('13:00', 'BREAK_STOP'),
        ev('14:00', 'CLOCK_OUT'),
      ],
      TZ,
    );
    expect(summarizeDay(DAY, segs).warnings.map((w) => w.code)).toContain('NO_BREAK_AFTER_6H');
  });

  it('rest period below 11 h', () => {
    const segs = deriveSegments([ev('05:00', 'CLOCK_IN'), ev('09:00', 'CLOCK_OUT')], TZ);
    const prevEnd = zonedToUtc('2026-11-15', '21:00', TZ).toISOString();
    expect(summarizeDay(DAY, segs, { previousAttendanceEnd: prevEnd }).warnings.map((w) => w.code)).toEqual([
      'REST_TOO_SHORT',
    ]);
  });
});

describe('time zones', () => {
  it('converts local Berlin time to UTC across DST', () => {
    expect(zonedToUtc('2026-11-16', '07:00', TZ).toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '07:00', TZ).toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(zonedToUtc('2026-03-29', '03:30', TZ).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('assigns the local work date, not the UTC date', () => {
    expect(localDate(new Date('2026-11-15T23:30:00Z'), TZ)).toBe('2026-11-16');
  });
  it('rounds modes', () => {
    expect(roundMinutes(7, 15, 'commercial')).toBe(0);
    expect(roundMinutes(8, 15, 'commercial')).toBe(15);
    expect(roundMinutes(1, 15, 'up')).toBe(15);
    expect(roundMinutes(29, 15, 'down')).toBe(15);
  });
});
