import { describe, expect, it } from 'vitest';
import { fillTemplate, reportCompleteness, wrapForBc } from './report.js';
import { checklistLines, checklistMissing, pickChecklistTemplate } from './checklist.js';

describe('quick documentation', () => {
  it('fills placeholders and marks missing values', () => {
    expect(
      fillTemplate('Wartung {Maschine} bei {Betriebsstunden} h durchgeführt.', {
        Maschine: 'Fendt 724 Vario',
        Betriebsstunden: 4210,
      }),
    ).toBe('Wartung Fendt 724 Vario bei 4.210 h durchgeführt.');
    expect(fillTemplate('Stand {Betriebsstunden} h, {Unbekannt}', {})).toBe('Stand … h, {Unbekannt}');
  });

  it('checks required fields per order type', () => {
    expect(reportCompleteness({ body: 'Öle gewechselt', requiredFields: {} }, ['operatingHours'])).toEqual({
      complete: false,
      missing: ['Betriebsstunden'],
    });
    expect(
      reportCompleteness({ body: '', requiredFields: { operatingHours: 10 } }, ['operatingHours']).missing,
    ).toEqual(['Arbeitsbericht']);
    expect(
      reportCompleteness({ body: 'ok', requiredFields: { operatingHours: 0 } }, ['operatingHours']).complete,
    ).toBe(true);
  });
});

describe('BC comment lines', () => {
  it('wraps at 80 characters without losing words', () => {
    const text =
      'Wartung nach Herstellerplan durchgeführt. Öle und Filter gewechselt. Probefahrt ohne Befund, Fehlerspeicher gelöscht und Kunde informiert.';
    const lines = wrapForBc(text);
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(lines.join(' ')).toBe(text);
  });
  it('keeps paragraphs and splits over-long tokens', () => {
    const lines = wrapForBc(`Zeile eins\n\nZeile zwei ${'x'.repeat(170)}`, 80);
    expect(lines[0]).toBe('Zeile eins');
    expect(lines[1]).toBe('');
    expect(lines.slice(2).every((l) => l.length <= 80)).toBe(true);
    expect(lines.slice(3).join('')).toBe('x'.repeat(170));
  });
});

describe('service checklists', () => {
  const items = [
    { id: 'oil', text: 'Motorölstand', kind: 'check' as const },
    { id: 'tyre', text: 'Reifendruck vorne', kind: 'value' as const, unit: 'bar' },
    { id: 'misc', text: 'Sonstiges', kind: 'text' as const, required: false },
  ];
  it('lists unanswered required items and "not OK" without a note', () => {
    expect(checklistMissing(items, {})).toEqual(['Motorölstand', 'Reifendruck vorne']);
    expect(
      checklistMissing(items, {
        oil: { state: 'NOK', value: null, note: '' },
        tyre: { state: null, value: '1,8', note: '' },
      }),
    ).toEqual(['Motorölstand (Bemerkung)']);
  });
  it('picks the most specific template', () => {
    const t = (
      id: string,
      locationId: string | null,
      orderTypeCode: string | null,
      brand: string | null,
    ) => ({
      id,
      title: id,
      locationId,
      orderTypeCode,
      brand,
      items: [],
    });
    const list = [
      t('global', null, null, null),
      t('wartung', null, 'WARTUNG', null),
      t('fendt', 'L1', 'WARTUNG', 'FENDT'),
    ];
    expect(
      pickChecklistTemplate(list, { locationId: 'L1', orderTypeCode: 'WARTUNG', brand: 'Fendt' })?.id,
    ).toBe('fendt');
    expect(
      pickChecklistTemplate(list, { locationId: 'L2', orderTypeCode: 'WARTUNG', brand: 'Fendt' })?.id,
    ).toBe('wartung');
    expect(pickChecklistTemplate(list, { locationId: 'L2', orderTypeCode: 'KUNDE', brand: null })?.id).toBe(
      'global',
    );
    expect(pickChecklistTemplate([], { locationId: 'L2', orderTypeCode: 'KUNDE', brand: null })).toBeNull();
  });
  it('writes one comment text per answered item', () => {
    expect(
      checklistLines(items, {
        oil: { state: 'NOK', value: null, note: 'nachgefüllt' },
        tyre: { state: null, value: '1,8', note: '' },
      }),
    ).toEqual(['n.i.O. Motorölstand – nachgefüllt', 'Reifendruck vorne: 1,8 bar']);
  });
});
