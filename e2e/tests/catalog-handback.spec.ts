/**
 * Manufacturer catalog with cart hand-back (E-80), like the Schröder parts shop: the catalog opens inside the parts
 * page with a return address for this order; "Warenkorb übergeben" in the catalog sends the cart (OCI) back – the
 * tractor flies and the parts are in the order's list with quantities. No bookmark, no clipboard, no screenshot.
 */
import { expect, test } from '@playwright/test';

test('cart handed back by the dealer catalog lands in the order with quantities', async ({ page }) => {
  await page.goto('/login');
  await page.click('[data-persona="monteur-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig/ })).toBeVisible({ timeout: 20_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  await page.goto(`/monteur/material?orderId=${href.split('id=')[1]}`);

  await page.locator('[data-catalog="testkatalog"]').click();
  const frame = page.frameLocator('[data-testid="catalog-embed"] iframe');
  await expect(frame.getByRole('heading', { name: 'Test-Teilekatalog (Händler)' })).toBeVisible();
  await frame.getByRole('button', { name: 'Warenkorb übergeben' }).click();

  // The catalog's answer page tells the app: the frame closes, the cart is there.
  await expect(page.getByRole('heading', { name: 'Aus dem Katalog (2 Teilenummern)' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="catalog-embed"]')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: '2 × F931.200.020.010' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'X548844266000' })).toContainText(
    'nicht im Artikelstamm',
  );
  await page.getByRole('button', { name: 'Alle in den Warenkorb' }).click();
  await expect(page.locator('section[aria-labelledby="warenkorb"]')).toContainText('Motorölfilter');
});
