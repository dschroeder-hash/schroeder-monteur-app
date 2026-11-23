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

import {
  parseShopCart,
  parseShopCartText,
  SHOP_CART_MARKER,
  shopCartBookmarklet,
} from './shop-cart.js';

describe('shop cart bookmark (E-77)', () => {
  it('reads the lines the bookmark copied, sums duplicates', () => {
    expect(
      parseShopCart(`${SHOP_CART_MARKER}\nX548844266000\t1\nF530200220390\t2\nx548844266000\t3\nPreis\tx`),
    ).toEqual([
      { partNo: 'X548844266000', quantity: 4 },
      { partNo: 'F530200220390', quantity: 2 },
    ]);
    expect(parseShopCart('AGCO-Teilenr. X548844266000')).toBeNull();
  });
  it('bookmark is a single-line javascript: URL that sends the page text to the app (E-78)', () => {
    const code = shopCartBookmarklet('https://werkstatt.example/app/', 'tok-123');
    expect(code.startsWith('javascript:')).toBe(true);
    expect(code).not.toMatch(/\s/);
    const js = decodeURI(code.slice('javascript:'.length));
    let opened = '';
    const fakeDocument = { body: { innerText: 'AGCO-Teilenr. X548844266000\n1 X 2,32 € pro Stück\nÖl' } };
    new Function('document', 'window', 'location', js)(
      fakeDocument,
      { open: (u: string) => ((opened = u), {}) },
      {},
    );
    expect(opened.startsWith('https://werkstatt.example/app/warenkorb-senden#t=tok-123&p=')).toBe(true);
    const text = Buffer.from(opened.split('&p=')[1]!, 'base64url').toString('utf8');
    expect(text).toContain('Öl');
    expect(parseShopCartText(text)).toEqual([{ partNo: 'X548844266000', quantity: 1 }]);
  });
});

describe('shop cart page text (E-77)', () => {
  it('takes cart lines with quantity, skips recommendations', () => {
    const page = [
      'Warenkorb',
      'O-RING',
      'AGCO-Teilenr. X548844266000',
      '1',
      '2,32 €',
      '1 X 2,32 € pro Stück',
      'Vorrätig',
      'Entfernen',
      'LICHTMASCHINE',
      'AGCO-Teilenr.',
      'F530200220390',
      '2',
      '1.826,00 €',
      '2 X 913,00 € pro Stück',
      'Empfohlene Artikel',
      'KEILRIEMEN',
      'AGCO-Teilenr. X999000111222',
      '12,50 €',
      'Zusammenfassung der Bestellanfrage',
    ].join('\n');
    expect(parseShopCartText(page)).toEqual([
      { partNo: 'X548844266000', quantity: 1 },
      { partNo: 'F530200220390', quantity: 2 },
    ]);
  });
});
