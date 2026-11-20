/**
 * Lighthouse, mobile (DoD: Performance / Accessibility ≥ 90). Runs only with LIGHTHOUSE=1 (slow):
 *   LIGHTHOUSE=1 pnpm test:e2e tests/lighthouse.spec.ts
 * Playwright signs in; Lighthouse then measures in the SAME tab (the dev token lives in sessionStorage, a new tab
 * would only show the login page).
 * Lighthouse 12 has no separate PWA category any more; installability/offline is covered by the E2E offline tests.
 */
import { chromium, expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer-core';

const PORT = 9333;
const PAGES: Array<[string, string | null]> = [
  ['/login', null],
  ['/monteur', 'monteur-wild'],
  ['/monteur/auftrag', 'monteur-wild'],
  ['/monteur/abwesenheit', 'monteur-wild'],
  ['/meister/freigaben', 'meister-wild'],
];

test.skip(!process.env.LIGHTHOUSE, 'nur mit LIGHTHOUSE=1');

test('Lighthouse mobile ≥ 90 (performance, accessibility, best practices)', async ({ baseURL }) => {
  test.setTimeout(900_000);
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const results: Array<Record<string, unknown>> = [];
  let signedIn: string | null = null;
  for (const [path, persona] of PAGES) {
    if (persona && signedIn !== persona) {
      // switching roles in the same tab: end the previous dev session first
      if (signedIn) await page.evaluate(() => sessionStorage.clear());
      await page.goto(`${baseURL}/login`);
      await page.click(`[data-persona="${persona}"]`);
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      signedIn = persona;
    }
    let url = `${baseURL}${path}`;
    if (path === '/monteur/auftrag') {
      await page.goto(`${baseURL}/monteur`);
      const href = await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href');
      url = `${baseURL}${href}`;
    }
    const pp = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
    const tab = (await pp.pages()).find((x) => x.url().startsWith(baseURL!))!;
    const r = await lighthouse(
      url,
      {
        port: PORT,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        formFactor: 'mobile',
        disableStorageReset: true,
      },
      undefined,
      tab as never,
    );
    await pp.disconnect();
    const c = r!.lhr.categories;
    const row = {
      path,
      performance: Math.round((c.performance!.score ?? 0) * 100),
      accessibility: Math.round((c.accessibility!.score ?? 0) * 100),
      bestPractices: Math.round((c['best-practices']!.score ?? 0) * 100),
      lcp: r!.lhr.audits['largest-contentful-paint']?.displayValue,
      tbt: r!.lhr.audits['total-blocking-time']?.displayValue,
      cls: r!.lhr.audits['cumulative-layout-shift']?.displayValue,
      shifts: JSON.stringify(
        (r!.lhr.audits['layout-shifts']?.details as { items?: unknown[] } | undefined)?.items?.slice(0, 3) ??
          [],
      ).slice(0, 600),
      issues: JSON.stringify(
        (r!.lhr.audits['inspector-issues']?.details as { items?: unknown[] } | undefined)?.items?.slice(
          0,
          3,
        ) ?? [],
      ).slice(0, 600),
      consoleErrors: JSON.stringify(
        (r!.lhr.audits['errors-in-console']?.details as { items?: unknown[] } | undefined)?.items?.slice(
          0,
          3,
        ) ?? [],
      ).slice(0, 600),
      failing: Object.values(r!.lhr.audits)
        .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary')
        .map((a) => a.id),
    };
    results.push(row);
    console.log(`LH ${JSON.stringify(row)}`);
  }
  writeFileSync('test-results/lighthouse.json', JSON.stringify(results, null, 2));
  await browser.close();
  for (const r of results) {
    expect.soft(r.performance as number, `${r.path} performance`).toBeGreaterThanOrEqual(90);
    expect.soft(r.accessibility as number, `${r.path} accessibility`).toBeGreaterThanOrEqual(90);
    expect.soft(r.bestPractices as number, `${r.path} best practices`).toBeGreaterThanOrEqual(90);
  }
});
