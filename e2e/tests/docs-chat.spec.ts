/**
 * Documentation & communication (PROMPT 5.6–5.8): report with quick documentation, photo and chat written
 * offline; after sync everything is on the server.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../playwright.config.js';

// 8×8 px JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAIAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/aAAgBAQAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oACAEBAAAAEH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
  'base64',
);

async function token(request: APIRequestContext) {
  const personas = await (await request.get(`${API_URL}/dev/personas`)).json();
  const p = personas.find((x: { key: string }) => x.key === 'monteur-clp');
  const res = await request.post(`${API_URL}/dev/token`, {
    data: { oid: p.oid, name: p.name, email: p.email, roles: p.roles },
  });
  return (await res.json()).accessToken as string;
}

// Playwright's offline emulation in WebKit also cuts off the service worker's cached answers (navigation and
// fetch fail with "WebKit encountered an internal error"), so flight mode cannot be emulated there. Real Safari
// is not affected; the scenario runs on the smartphone project (Chromium) and must be checked on a real iPad.
test.skip(
  ({ browserName }) => browserName === 'webkit',
  'Flugmodus lässt sich in Playwright-WebKit nicht emulieren',
);

test('report, photo and chat written offline arrive after sync', async ({ page, request }) => {
  await page.goto('/login');
  await page.click('[data-persona="monteur-clp"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig \(3\)/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const href = (await page.locator('section[aria-labelledby="heute"] a').first().getAttribute('href'))!;
  const orderId = href.split('id=')[1]!;

  await page.context().setOffline(true);

  // ---- Report with quick documentation ----
  await page.goto(`/monteur/bericht?orderId=${orderId}`);
  await page.getByRole('button', { name: 'Öle und Filter gewechselt' }).click();
  await page.getByRole('button', { name: 'Probefahrt ohne Befund' }).click();
  const hours = page.getByLabel(/Betriebsstunden/);
  if (await hours.count()) await hours.fill('4210');
  await expect(page.getByRole('status').filter({ hasText: 'Dokumentation vollständig' })).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.waitForURL('**/monteur/auftrag?id=*');

  // ---- Photo (compressed on the device, queued) ----
  await page
    .getByTestId('photo-input')
    .setInputFiles({ name: 'typenschild.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(page.getByText('wartet auf Upload')).toBeVisible();

  // ---- Chat ----
  await page.goto(`/monteur/chat?orderId=${orderId}`);
  await page
    .getByRole('textbox', { name: 'Nachricht', exact: true })
    .fill('Fertig. Kunde bittet um Rückruf wegen Rechnung.');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByText('wird gesendet')).toBeVisible();

  // ---- Online ----
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').filter({ hasText: /ausstehend/ })).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.goto(`/monteur/auftrag?id=${orderId}`);
  await expect(page.getByText('✓ hochgeladen')).toBeVisible({ timeout: 30_000 });

  // ---- Report and photo arrive on the server (the order is finished on the completion page, completion.spec.ts) ----
  const reports = await (
    await request.get(`${API_URL}/v1/orders/${orderId}/report`, {
      headers: { authorization: `Bearer ${await token(request)}` },
    })
  ).json();
  expect(reports.body).toContain('Probefahrt');
});
