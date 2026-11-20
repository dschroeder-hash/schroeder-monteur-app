import { describe, expect, it } from 'vitest';
import { fillTemplate, reportCompleteness, wrapForBc } from './report.js';
import { checklistItemsFor, checklistLines, checklistMissing, pickChecklistTemplate } from './checklist.js';

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

describe('service checklists (yellow card)', () => {
  const items = [
    { id: 'h1', text: 'Verbrauchsmaterial', kind: 'heading' as const },
    { id: 'oel', text: 'Motoröl', kind: 'line' as const, checkbox: true },
    {
      id: 'oelart',
      text: 'Auswahl Motoröl',
      kind: 'line' as const,
      answer: 'option' as const,
      options: ['15W-40', '10W-40'],
    },
    {
      id: 'oelmenge',
      text: 'Menge Motoröl',
      kind: 'line' as const,
      answer: 'number' as const,
      unitOptions: ['Liter', 'St.'],
    },
    { id: 'kaelte', text: 'Kältemittel', kind: 'line' as const, answer: 'number' as const, unit: 'g' },
    { id: 'h2', text: 'Nur bei Kulanz', kind: 'heading' as const, orderTypes: ['KULANZ', 'GARANTIE'] },
    {
      id: 'altteile',
      text: 'Altteile sauber eingelagert',
      kind: 'line' as const,
      checkbox: true,
      required: true,
    },
    { id: 'h3', text: 'Reparaturende', kind: 'heading' as const },
    { id: 'alles', text: 'Alle Arbeiten ausgeführt?', kind: 'line' as const, checkbox: true, required: true },
  ];
  const a = (checked: boolean, value: string | null = null, unit: string | null = null) => ({
    checked,
    value,
    unit,
  });

  it('hides sections that only apply to other order types', () => {
    expect(checklistItemsFor(items, 'KUNDE').map((i) => i.id)).not.toContain('altteile');
    expect(checklistItemsFor(items, 'KULANZ').map((i) => i.id)).toContain('altteile');
  });
  it('lists required lines, numbers that are none and missing units', () => {
    const visible = checklistItemsFor(items, 'KUNDE');
    expect(checklistMissing(visible, {})).toEqual(['Alle Arbeiten ausgeführt?']);
    expect(
      checklistMissing(visible, { oelmenge: a(false, 'zwölf'), kaelte: a(false, '650'), alles: a(true) }),
    ).toEqual(['Menge Motoröl (Zahl)', 'Menge Motoröl (Einheit)']);
    expect(checklistMissing(visible, { oelmenge: a(false, '12', 'Liter'), alles: a(true) })).toEqual([]);
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
    expect(pickChecklistTemplate([], { locationId: 'L2', orderTypeCode: 'KUNDE', brand: null })).toBeNull();
  });
  it('writes only filled-in lines, grouped under their heading', () => {
    expect(
      checklistLines(items, {
        oel: a(true),
        oelart: a(false, '15W-40'),
        oelmenge: a(false, '12', 'Liter'),
        kaelte: a(false, '650'),
        alles: a(true),
      }),
    ).toEqual([
      'Verbrauchsmaterial:',
      '[x] Motoröl',
      'Auswahl Motoröl: 15W-40',
      'Menge Motoröl: 12 Liter',
      'Kältemittel: 650 g',
      'Reparaturende:',
      '[x] Alle Arbeiten ausgeführt?',
    ]);
  });
});
