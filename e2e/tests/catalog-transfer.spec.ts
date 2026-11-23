/**
 * Manufacturer catalog side by side (iPad Split View): part numbers marked in the catalog are dragged into the app
 * (or pasted) and resolved against the item master – single number directly, several as a list.
 */
import { expect, test } from '@playwright/test';

test('part numbers dragged or pasted from the catalog are resolved against the item master', async ({
  page,
}) => {
  await page.goto('/login');
  await page.click('[data-persona="monteur-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig/ })).toBeVisible({ timeout: 20_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  await page.goto(`/monteur/material?orderId=${href.split('id=')[1]}`);
  await expect(page.locator('[data-catalog="agco-start"]')).toBeVisible();

  // ---- Catalog inside the page (E-74): the AGCO start page full screen, closable ----
  await page.getByRole('button', { name: 'Katalog hier anzeigen' }).click();
  await expect(page.locator('iframe[title="AGCO-Teilekatalog"]')).toHaveAttribute('src', /agcocorp\.com/);
  // Full screen: a part number dropped on the bar above the catalog shows up below it, the catalog stays open.
  const one = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'F931.200.020.010');
    return dt;
  });
  const bar = page.getByTestId('catalog-embed-drop');
  await bar.dispatchEvent('dragover', { dataTransfer: one });
  await bar.dispatchEvent('drop', { dataTransfer: one });
  await expect(page.getByTestId('catalog-embed').locator('[data-item="F931.200.020.010"]')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page.locator('iframe[title="AGCO-Teilekatalog"]')).toHaveCount(0);
  await page.getByPlaceholder('Teilenummer, Bezeichnung oder EAN').fill('');

  // ---- Several lines marked in the catalog and dropped onto the catalog area ----
  const data = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData(
      'text/plain',
      'Teilenummer: F931.200.020.010 Motorölfilter\nX999.999.999 unbekanntes Teil\nMenge 1',
    );
    return dt;
  });
  const zone = page.getByTestId('catalog-drop');
  await zone.dispatchEvent('dragover', { dataTransfer: data });
  await zone.dispatchEvent('drop', { dataTransfer: data });
  const list = page.getByRole('heading', { name: 'Aus dem Katalog (2 Teilenummern)' });
  await expect(list).toBeVisible();
  const known = page.getByRole('listitem').filter({ hasText: 'F931.200.020.010' });
  const unknown = page.getByRole('listitem').filter({ hasText: 'X999.999.999' });
  await expect(unknown).toContainText('nicht im Artikelstamm');
  await expect(unknown.getByRole('button', { name: 'Beim Lager anfragen' })).toBeVisible();
  await known.getByRole('button', { name: 'Auswählen' }).click();
  await expect(page.locator('[data-item="F931.200.020.010"]')).toBeVisible();

  // ---- Single number pasted into the field: shown directly, no extra tap ----
  await page.getByPlaceholder('Teilenummer, Bezeichnung oder EAN').fill('');
  await page.getByLabel('Teilenummer aus dem Katalog').focus();
  await page.evaluate(() => {
    const el = document.getElementById('paste')!;
    const dt = new DataTransfer();
    dt.setData('text/plain', 'F931.200.020.010');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByPlaceholder('Teilenummer, Bezeichnung oder EAN')).toHaveValue('F931.200.020.010');
  await expect(page.locator('[data-item="F931.200.020.010"]')).toBeVisible();
});
