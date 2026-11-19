/**
 * Material offline (PROMPT 5.4/5.5, DoD 12): 12 l engine oil and a filter are taken in flight mode;
 * after sync the Meister approves and the worker writes item lines to the BC service order (mock).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BC_MOCK_URL } from '../playwright.config.js';

const writes = async (request: APIRequestContext) =>
  (await (await request.get(`${BC_MOCK_URL}/__mock/writes`)).json()) as Array<{
    method: string;
    entitySet: string;
    body: Record<string, unknown>;
    status: number;
  }>;

const available = async (page: Page, name: string) => {
  const tile = page.locator(`[data-container="${name}"]`);
  const text = await tile.locator('.font-emphasis').innerText();
  return Number(text.replace(/[^\d,]/g, '').replace(',', '.'));
};

test('take oil and a part offline, sync, Meister approves, item lines arrive in BC', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/login');
  await page.click('[data-persona="azubi-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig \(3\)/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  const orderId = href.split('id=')[1]!;

  await page.context().setOffline(true);

  // ---- Consumables shop: 12 l engine oil ----
  await page.goto(`/monteur/verbrauch?orderId=${orderId}`);
  const oil = 'Motoröl 15W-40 (Fass 200 l)';
  await expect(page.locator(`[data-container="${oil}"]`)).toBeVisible();
  const before = await available(page, oil);
  await page.locator(`[data-container="${oil}"]`).click();
  await page.getByLabel('Menge (L)').fill('12');
  await page.getByRole('button', { name: 'Buchen' }).click();
  await expect.poll(() => available(page, oil)).toBe(before - 12); // local stock reduced immediately, offline

  // ---- Parts: offline search in the location catalog, cart, take ----
  await page.goto(`/monteur/material?orderId=${orderId}`);
  await page.getByPlaceholder('Teilenummer, Bezeichnung oder EAN').fill('Motorölfilter');
  const hit = page.locator('[data-item="F931.200.020.010"]');
  await expect(hit).toBeVisible();
  await hit.getByRole('button', { name: /^Lager:/ }).click();
  await page.getByRole('button', { name: 'Entnehmen und auf Auftrag buchen' }).click();
  await expect(page.getByRole('status').filter({ hasText: /2 ausstehend/ })).toBeVisible();

  // ---- Back online ----
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').filter({ hasText: /ausstehend/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  // ---- Meister approves ----
  const meister = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const m = await meister.newPage();
  await m.goto('/login');
  await m.click('[data-persona="meister-wild"]');
  await m.waitForURL('**/meister');
  await m.goto('/meister/freigaben');
  const block = m.locator(`[data-consumptions="${orderId}"]`);
  await expect(block).toContainText('12 L Motoröl');
  await block.getByRole('button', { name: /Alle 2 freigeben/ }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Material freigegeben' })).toBeVisible();
  await meister.close();

  // ---- Worker → BC service lines of type Item ----
  await expect
    .poll(
      async () =>
        (await writes(request))
          .filter((w) => w.entitySet === 'serviceLines' && w.status === 201 && w.body.type === 'Item')
          .map((w) => `${w.body.number}:${w.body.quantity}`),
      {
        timeout: 45_000,
      },
    )
    .toEqual(expect.arrayContaining(['X990.200.000:12', 'F931.200.020.010:1']));
});
