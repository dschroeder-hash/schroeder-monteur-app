/**
 * Accessibility (PROMPT 8: WCAG 2.1 AA, Lighthouse a11y ≥ 90): axe-core scan of every main page per role,
 * in light and dark mode. Serious and critical violations fail the test; the full list is attached to the report.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES: Record<string, string[]> = {
  'monteur-wild': [
    '/monteur',
    '/monteur/kalender',
    '/monteur/zeiten',
    '/monteur/material',
    '/monteur/verbrauch',
    '/monteur/abwesenheit',
    '/monteur/produktivitaet',
  ],
  'meister-wild': [
    '/meister',
    '/meister/plantafel',
    '/meister/freigaben',
    '/meister/abwesenheiten',
    '/meister/produktivitaet',
    '/meister/textbausteine',
  ],
  'lager-wild': ['/lager'],
  personal: ['/personal'],
  admin: ['/admin', '/admin/uebertragungen'],
};

async function scan(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return res.violations.map((v) => ({
    page: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

for (const theme of ['light', 'dark'] as const)
  for (const [persona, urls] of Object.entries(PAGES))
    test(`no serious accessibility violations: ${persona} (${theme})`, async ({ page }, info) => {
      const all: Awaited<ReturnType<typeof scan>> = [];
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/login');
      if (persona === 'monteur-wild') all.push(...(await scan(page, `/login (${theme})`)));
      await page.click(`[data-persona="${persona}"]`);
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      for (const url of urls) {
        await page.goto(url);
        // networkidle never settles (sync polling) – wait for the page heading instead
        await page.locator('h1').first().waitFor();
        await page.waitForTimeout(800);
        all.push(...(await scan(page, `${url} (${theme})`)));
      }
      await info.attach('axe-violations.json', {
        body: JSON.stringify(all, null, 2),
        contentType: 'application/json',
      });
      console.log(`AXE ${JSON.stringify(all)}`);
      const serious = all.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
