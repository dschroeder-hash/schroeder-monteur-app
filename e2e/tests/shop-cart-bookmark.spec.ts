/**
 * "Warenkorb kopieren" (E-77): the bookmark runs on the shop's cart page and copies every cart line (also below the
 * fold) with quantity – recommendations are skipped; "Warenkorb übertragen" in the app takes them over.
 */
import { expect, test } from '@playwright/test';
import { SHOP_CART_BOOKMARKLET } from '../../packages/shared/dist/material/shop-cart.js';

const CART_PAGE = `<!doctype html><html><body>
<main><h1>Warenkorb</h1>
  <div class="row"><div><h3>O-RING</h3><p>AGCO-Teilenr. X548844266000</p></div>
    <div><button>-</button><input value="1"><button>+</button></div><p>1 X 2,32 € pro Stück</p><a>Entfernen</a></div>
  <div class="row"><div><h3>LICHTMASCHINE</h3><p>AGCO-Teilenr. F930200020010</p></div>
    <div><button>-</button><input value="2"><button>+</button></div><a>Entfernen</a></div>
  <div style="height:3000px"></div>
  <div class="row"><div><h3>FILTER</h3><p>AGCO-Teilenr. F931.200.020.010</p></div>
    <div><input value="3"></div><a>Entfernen</a></div>
</main>
<aside><h2>Empfohlene Artikel</h2>
  <div><h3>KEILRIEMEN</h3><p>AGCO-Teilenr. X999000111222</p><p>12,50 €</p><button>In den Warenkorb</button></div>
</aside></body></html>`;

test('bookmark copies only the cart lines, the app takes them over with quantities', async ({ page }) => {
  // 1) On the shop page
  await page.setContent(CART_PAGE);
  await page.evaluate(() => {
    (window as unknown as { copied: string }).copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => ((window as unknown as { copied: string }).copied = t) },
    });
    window.alert = () => undefined;
  });
  await page.evaluate(
    (code) => new Function(decodeURI(code.slice('javascript:'.length)))(),
    SHOP_CART_BOOKMARKLET,
  );
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied.split('\n').slice(1)).toEqual([
    'X548844266000\t1',
    'F930200020010\t2',
    'F931.200.020.010\t3',
  ]);

  // 2) In the app
  await page.addInitScript((text) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: async () => text, writeText: async () => undefined },
    });
  }, copied);
  await page.goto('/login');
  await page.click('[data-persona="monteur-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig/ })).toBeVisible({ timeout: 20_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  await page.goto(`/monteur/material?orderId=${href.split('id=')[1]}`);
  await page.getByRole('button', { name: 'Warenkorb übertragen' }).click();
  await expect(page.getByRole('heading', { name: 'Aus dem Katalog (3 Teilenummern)' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '3 × F931.200.020.010' })).toBeVisible();
  await expect(page.getByText('X999000111222')).toHaveCount(0);
  await page.getByRole('button', { name: 'Alle in den Warenkorb' }).click();
  await expect(page.locator('section[aria-labelledby="warenkorb"]')).toBeVisible();
});
