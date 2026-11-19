import { describe, expect, it } from 'vitest';
import { fillTemplate, reportCompleteness, wrapForBc } from './report.js';

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
