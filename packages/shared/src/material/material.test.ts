import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../time/tz.js';
import { agcoDeeplinkAdapter, extractPartNo, normalizePartNo } from './catalog.js';
import { estimateDelivery } from './delivery.js';
import { easterSunday, holidays, isWorkingDay } from './holidays.js';
import { availableQuantity, belowMinimum, meterPlausible } from './stock.js';

const TZ = 'Europe/Berlin';
const at = (d: string, t: string) => zonedToUtc(d, t, TZ);

describe('holidays', () => {
  it('computes Easter correctly', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
  it('knows regional differences', () => {
    expect(holidays(2026, 'NI').has('2026-10-31')).toBe(true); // Reformationstag
    expect(holidays(2026, 'RP').has('2026-10-31')).toBe(false);
    expect(holidays(2026, 'RP').has('2026-06-04')).toBe(true); // Fronleichnam
    expect(holidays(2026, 'NI').has('2026-06-04')).toBe(false);
    expect(holidays(2026, 'SN').has('2026-11-18')).toBe(true); // Buß- und Bettag
    expect(isWorkingDay('2026-12-25', 'NI')).toBe(false);
  });
});

describe('overnight delivery with 17:00 cutoff', () => {
  it('before cutoff → tomorrow', () => {
    const r = estimateDelivery(at('2026-11-17', '16:59'), TZ, 'NI');
    expect(r).toMatchObject({ deliveryDate: '2026-11-18', afterCutoff: false });
    expect(r.label).toContain('morgen');
  });
  it('after cutoff → day after tomorrow', () => {
    expect(estimateDelivery(at('2026-11-17', '17:00'), TZ, 'NI')).toMatchObject({
      deliveryDate: '2026-11-19',
      afterCutoff: true,
    });
  });
  it('Friday before cutoff → Monday; Friday after cutoff → Tuesday', () => {
    expect(estimateDelivery(at('2026-11-20', '10:00'), TZ, 'NI').deliveryDate).toBe('2026-11-23');
    expect(estimateDelivery(at('2026-11-20', '18:00'), TZ, 'NI').deliveryDate).toBe('2026-11-24');
  });
  it('skips public holidays of the location', () => {
    expect(estimateDelivery(at('2026-10-30', '09:00'), TZ, 'NI').deliveryDate).toBe('2026-11-02'); // Sa, So; 31.10. is Saturday anyway
    expect(estimateDelivery(at('2026-06-03', '09:00'), TZ, 'RP').deliveryDate).toBe('2026-06-05'); // Fronleichnam in RP
    expect(estimateDelivery(at('2026-06-03', '09:00'), TZ, 'NI').deliveryDate).toBe('2026-06-04');
  });
});

describe('AGCO deep link (no scraping)', () => {
  const agco = agcoDeeplinkAdapter();
  it('builds a search URL from part number or serial number', () => {
    expect(agco.buildSearchUrl({ partNo: 'X548.880.400' })).toBe(
      'https://shop.agcoparts.com/search?text=X548.880.400',
    );
    expect(agco.buildSearchUrl({ serialNo: 'FEN 123' })).toContain('FEN%20123');
    expect(agco.buildSearchUrl({})).toBeNull();
  });
  it('refuses non-https templates', () => {
    expect(agcoDeeplinkAdapter('javascript:alert({query})').buildSearchUrl({ partNo: '1' })).toBeNull();
  });
  it('normalises and extracts part numbers from pasted text', () => {
    expect(normalizePartNo('x548 880-400')).toBe(normalizePartNo('X548.880.400'));
    expect(extractPartNo('Teilenummer: X548.880.400 – Keilrippenriemen')).toBe('X548.880.400');
    expect(extractPartNo('F931.200.020.010')).toBe('F931.200.020.010');
    expect(extractPartNo('Bitte bestellen')).toBeNull();
  });
});

describe('stock', () => {
  it('available = BC inventory − pending app withdrawals', () => {
    expect(availableQuantity(500, 12)).toBe(488);
    expect(belowMinimum(40, 50)).toBe(true);
    expect(belowMinimum(40, null)).toBe(false);
  });
  it('checks diesel meter readings', () => {
    expect(meterPlausible(80, 1000, 1080.5)).toBe(true);
    expect(meterPlausible(80, 1000, 1050)).toBe(false);
    expect(meterPlausible(80)).toBe(true);
  });
});
