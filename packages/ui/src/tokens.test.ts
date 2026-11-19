import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { brand, CONTRAST_PAIRS, dark, light } from './tokens.js';
import { buildThemeCss } from './css.js';

describe('design tokens', () => {
  it('uses the exact CD brand colours', () => {
    expect(brand.green).toBe('#07915E');
    expect(brand.gray).toBe('#676C6E');
    expect(light.accent).toBe(brand.green);
    expect(light.text).toBe(brand.black);
  });

  it('documents that white on brand green is only AA-large', () => {
    const r = contrastRatio('#FFFFFF', brand.green);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(4.5);
  });

  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      it(`${name}: ${fg} on ${bg} meets WCAG AA (4.5:1)`, () => {
        expect(contrastRatio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('generates css with both themes and tailwind theme mapping', () => {
    const css = buildThemeCss();
    expect(css).toContain('--color-primary: #067A4F');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('@theme inline');
  });
});
