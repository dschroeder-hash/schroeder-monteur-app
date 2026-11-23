/**
 * Bookmark "→ Werkstatt-App" (E-78): the Monteur creates the personal bookmark once, taps it on the shop's cart
 * page – the app picks up the whole cart (also below the fold) with quantities by itself; recommendations are
 * skipped. No clipboard, no screenshot, no button in the app.
 */
import { expect, test } from '@playwright/test';

const CART_PAGE = `<!doctype html><html><head><title>Warenkorb</title></head><body>
<main><h1>Warenkorb</h1>
  <div><h3>O-RING</h3><p><span>AGCO-Teilenr.</span> <span>X548844266000</span></p>
    <div><button>-</button><input value="1"><button>+</button></div><p>2,32 €</p><p>1 X 2,32 € pro Stück</p><a>Entfernen</a></div>
  <div><h3>LICHTMASCHINE</h3><p>AGCO-Teilenr.</p><p>F930200020010</p>
    <div><input value="2"></div><p>1.826,00 €</p><p>2 X 913,00 € pro Stück</p><a>Entfernen</a></div>
  <div style="height:3000px"></div>
  <div><h3>FILTER</h3><p>AGCO-Teilenr. F931.200.020.010</p>
    <div><input value="3"></div><p>3 X 18,40 € pro Stück</p><a>Entfernen</a></div>
</main>
<aside><h2>Empfohlene Artikel</h2>
  <div><h3>KEILRIEMEN</h3><p>AGCO-Teilenr. X999000111222</p><p>12,50 €</p><button>In den Warenkorb</button></div>
</aside></body></html>`;

test('bookmark sends the cart, the app picks it up by itself with quantities', async ({ page, context }) => {
  await page.goto('/login');
  await page.click('[data-persona="monteur-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig/ })).toBeVisible({ timeout: 20_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  await page.goto(`/monteur/material?orderId=${href.split('id=')[1]}`);

  // ---- one-time setup: personal bookmark ----
  await page.getByRole('button', { name: /Lesezeichen „→ Werkstatt-App“ einrichten/ }).click();
  await page.getByRole('button', { name: 'Mein Lesezeichen erzeugen' }).click();
  const bookmark = page.getByTestId('bookmark-setup').getByText('→ Werkstatt-App', { exact: true });
  await expect(bookmark).toHaveAttribute('href', /^javascript:/);
  const code = (await bookmark.getAttribute('href'))!;

  // ---- in the shop tab: tap the bookmark ----
  const shop = await context.newPage();
  await shop.setContent(CART_PAGE);
  await shop.evaluate(() => {
    (window as unknown as { opened: string }).opened = '';
    window.open = ((u: string) => (
      ((window as unknown as { opened: string }).opened = u),
      {}
    )) as typeof window.open;
  });
  await shop.evaluate((c) => new Function(decodeURI(c.slice('javascript:'.length)))(), code);
  const target = await shop.evaluate(() => (window as unknown as { opened: string }).opened);
  expect(target).toMatch(/\/warenkorb-senden#t=.+&p=/);
  await shop.goto(target);
  await expect(shop.getByText('3 Positionen geschickt')).toBeVisible();
  await expect(shop).not.toHaveURL(/#t=/); // token not left in the history
  await shop.close();

  // ---- back in the app: the cart arrives by itself ----
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: 'Aus dem Katalog (3 Teilenummern)' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('listitem').filter({ hasText: '3 × F931.200.020.010' })).toBeVisible();
  await expect(page.getByText('X999000111222')).toHaveCount(0);
  await page.getByRole('button', { name: 'Alle in den Warenkorb' }).click();
  await expect(page.locator('section[aria-labelledby="warenkorb"]')).toBeVisible();
});
