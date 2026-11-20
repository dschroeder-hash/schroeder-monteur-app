import { describe, expect, it } from 'vitest';
import { absenceDays, coversDate, rangesOverlap, vacationBalance } from './absence.js';

describe('absence days', () => {
  it('counts Mon–Fri without holidays', () => {
    // 2026-12-21 (Mo) .. 2026-12-31 (Do): 24./25./26. → 25. holiday, 26. Saturday; 24. is a working day
    expect(absenceDays({ fromDate: '2026-12-21', toDate: '2026-12-31' }, 'NI')).toBe(8);
  });
  it('respects state holidays', () => {
    // Fronleichnam 2026-06-04 only in some states
    expect(absenceDays({ fromDate: '2026-06-04', toDate: '2026-06-04' }, 'NW')).toBe(0);
    expect(absenceDays({ fromDate: '2026-06-04', toDate: '2026-06-04' }, 'NI')).toBe(1);
  });
  it('half day counts 0.5, weekend half day 0', () => {
    expect(absenceDays({ fromDate: '2026-11-20', toDate: '2026-11-20', halfDay: 'AM' }, 'NI')).toBe(0.5);
    expect(absenceDays({ fromDate: '2026-11-21', toDate: '2026-11-21', halfDay: 'PM' }, 'NI')).toBe(0);
  });
  it('splits by year', () => {
    const a = { fromDate: '2026-12-28', toDate: '2027-01-08' };
    expect(absenceDays(a, 'NI', 2026)).toBe(4);
    expect(absenceDays(a, 'NI', 2027)).toBe(5); // 01.01. holiday, 02./03. weekend
  });
  it('open end counts the first day only', () => {
    expect(absenceDays({ fromDate: '2026-11-19', toDate: null }, 'NI')).toBe(1);
  });
});

describe('vacation balance', () => {
  it('subtracts approved and requested, ignores rejected/cancelled and sick days', () => {
    const b = vacationBalance(
      2026,
      { entitlementDays: 30, carryOverDays: 2.5 },
      [
        { type: 'URLAUB', state: 'APPROVED', fromDate: '2026-08-03', toDate: '2026-08-14', halfDay: 'NONE' },
        { type: 'URLAUB', state: 'REQUESTED', fromDate: '2026-11-20', toDate: '2026-11-20', halfDay: 'PM' },
        { type: 'URLAUB', state: 'REJECTED', fromDate: '2026-10-05', toDate: '2026-10-09', halfDay: 'NONE' },
        { type: 'URLAUB', state: 'CANCELLED', fromDate: '2026-09-07', toDate: '2026-09-07', halfDay: 'NONE' },
        { type: 'KRANK', state: 'REPORTED', fromDate: '2026-03-02', toDate: '2026-03-06', halfDay: 'NONE' },
      ],
      'NI',
    );
    expect(b).toEqual({
      year: 2026,
      entitlement: 30,
      carryOver: 2.5,
      taken: 10,
      requested: 0.5,
      remaining: 22,
    });
  });
});

describe('ranges', () => {
  it('handles open ends', () => {
    expect(coversDate({ fromDate: '2026-11-19', toDate: null }, '2027-01-01')).toBe(true);
    expect(
      rangesOverlap(
        { fromDate: '2026-11-19', toDate: null },
        { fromDate: '2026-11-01', toDate: '2026-11-18' },
      ),
    ).toBe(false);
    expect(
      rangesOverlap(
        { fromDate: '2026-11-19', toDate: '2026-11-19' },
        { fromDate: '2026-11-01', toDate: '2026-11-19' },
      ),
    ).toBe(true);
  });
});
