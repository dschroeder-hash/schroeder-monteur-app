import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../time/tz.js';
import { agcoDeeplinkAdapter, extractPartNo, extractPartNos, normalizePartNo } from './catalog.js';
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
    // default: German catalog start page, query goes to the clipboard (search URL format unknown, OP-24)
    expect(agco.buildSearchUrl({ partNo: 'X548.880.400' })).toBe(
      'https://parts.agcocorp.com/de/de/dealers/redirect/schroeder11',
    );
    expect(agco.searchInUrl).toBe(false);
    const withSearch = agcoDeeplinkAdapter('https://parts.agcocorp.com/de/de/search?q={query}');
    expect(withSearch.searchInUrl).toBe(true);
    expect(withSearch.buildSearchUrl({ serialNo: 'FEN 123' })).toBe(
      'https://parts.agcocorp.com/de/de/search?q=FEN%20123',
    );
    expect(agco.buildSearchUrl({})).toBeNull();
  });
  it('always offers the catalog start page, also without a number', () => {
    expect(agcoDeeplinkAdapter().startUrl).toBe(
      'https://parts.agcocorp.com/de/de/dealers/redirect/schroeder11',
    );
    expect(agcoDeeplinkAdapter('https://parts.agcocorp.com/de/de/search?q={query}').startUrl).toBe(
      'https://parts.agcocorp.com/',
    );
  });
  it('refuses non-https templates', () => {
    expect(agcoDeeplinkAdapter('javascript:alert({query})').buildSearchUrl({ partNo: '1' })).toBeNull();
    expect(agcoDeeplinkAdapter('javascript:alert({query})').startUrl).toBeNull();
  });
  it('normalises and extracts part numbers from pasted text', () => {
    expect(normalizePartNo('x548 880-400')).toBe(normalizePartNo('X548.880.400'));
    expect(extractPartNo('Teilenummer: X548.880.400 – Keilrippenriemen')).toBe('X548.880.400');
    expect(extractPartNo('F931.200.020.010')).toBe('F931.200.020.010');
    expect(extractPartNo('Bitte bestellen')).toBeNull();
  });
  it('extracts several part numbers from a list marked in the catalog', () => {
    const list =
      'Teilenummer: X548.880.400 – Keilrippenriemen\nF931.200.020.010 Filter\n\nx548.880-400 doppelt\nHinweis';
    expect(extractPartNos(list)).toEqual(['X548.880.400', 'F931.200.020.010']);
    expect(extractPartNos('Bitte bestellen')).toEqual([]);
    // the description after the number is not part of it; digit groups separated by spaces are
    expect(extractPartNo('Teilenummer: F931.200.020.010 Motorölfilter')).toBe('F931.200.020.010');
    expect(extractPartNo('Teile-Nr. X548 880 400 Riemen')).toBe('X548 880 400');
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

import { catalogHasHandBack, catalogUrl, DEFAULT_CATALOGS, parseOciCart } from './punchout.js';

describe('catalog hand-back (OCI, E-80)', () => {
  it('reads the OCI cart lines with quantities and names', () => {
    expect(
      parseOciCart({
        'NEW_ITEM-VENDORMAT[1]': 'X548844266000',
        'NEW_ITEM-QUANTITY[1]': '1.000',
        'NEW_ITEM-DESCRIPTION[1]': 'O-RING',
        'NEW_ITEM-MATNR[2]': 'F530200220390',
        'NEW_ITEM-QUANTITY[2]': '2,000',
        'NEW_ITEM-DESCRIPTION[2]': 'LICHTMASCHINE',
        'NEW_ITEM-VENDORMAT[3]': 'x548844266000',
        'NEW_ITEM-QUANTITY[3]': '3',
        'NEW_ITEM-DESCRIPTION[4]': 'ohne Teilenummer',
        '~OkCode': 'ADDI',
      }),
    ).toEqual([
      { partNo: 'X548844266000', quantity: 4, name: 'O-RING' },
      { partNo: 'F530200220390', quantity: 2, name: 'LICHTMASCHINE' },
    ]);
  });
  it('quantities: German and English decimals, fractions for fluids, nonsense = 1', () => {
    const q = (v: string) =>
      parseOciCart({ 'NEW_ITEM-VENDORMAT[1]': 'A123', 'NEW_ITEM-QUANTITY[1]': v })[0]!.quantity;
    expect(q('1.234,5')).toBe(1234.5);
    expect(q('1,234.5')).toBe(1234.5);
    expect(q('2,5')).toBe(2.5);
    expect(q('abc')).toBe(1);
    expect(q('-3')).toBe(1);
  });
  it('catalog address with return address; defaults have no hand-back until configured', () => {
    const c = {
      id: 'agco',
      label: 'AGCO',
      brands: [],
      url: 'https://x.test/?HOOK_URL={HOOK_URL}&D=1',
      mode: 'iframe' as const,
    };
    expect(catalogHasHandBack(c)).toBe(true);
    expect(catalogUrl(c, 'https://api.test/v1/parts/catalog-return/abc')).toBe(
      'https://x.test/?HOOK_URL=https%3A%2F%2Fapi.test%2Fv1%2Fparts%2Fcatalog-return%2Fabc&D=1',
    );
    expect(DEFAULT_CATALOGS.some(catalogHasHandBack)).toBe(false);
  });
});
