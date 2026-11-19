/**
 * Documentation & communication (PROMPT 5.6–5.8): report with quick documentation, photo and chat written
 * offline; after sync the Meister sees everything, answers, approves – the report reaches BC as comment lines.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { BC_MOCK_URL } from '../playwright.config.js';

// 8×8 px JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAIAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/aAAgBAQAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oACAEBAAAAEH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
  'base64',
);

const writes = async (request: APIRequestContext) =>
  (await (await request.get(`${BC_MOCK_URL}/__mock/writes`)).json()) as Array<{
    method: string;
    entitySet: string;
    body: Record<string, unknown>;
    status: number;
  }>;

test('report, photo and chat offline → Meister reviews, answers and approves → comment lines in BC', async ({
  page,
  browser,
  request,
}) => {
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

  // ---- Status "Fertig" ----
  await page.getByRole('button', { name: 'Fertig', exact: true }).click();
  // the button disappears once the status is stored locally
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toHaveCount(0);

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

  // ---- Meister ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const m = await ctx.newPage();
  await m.goto('/login');
  await m.click('[data-persona="meister-clp"]');
  await m.waitForURL('**/meister');
  await m.goto(`/meister/auftrag?id=${orderId}`);
  await expect(m.getByText('Motoröl, Getriebe-/Hydrauliköl und alle Filter gewechselt.')).toBeVisible();
  await expect(
    m.getByRole('img', { name: 'Sonstiges' }).or(m.getByRole('img', { name: 'Schaden vorher' })),
  ).toBeVisible();
  await m.getByRole('link', { name: 'Chat öffnen' }).click();
  await expect(m.getByText('Kunde bittet um Rückruf')).toBeVisible();
  await expect(m.getByText('Status: Fertig')).toBeVisible();
  await m.getByRole('textbox', { name: 'Nachricht', exact: true }).fill('Danke, ich rufe an.');
  await m.getByRole('button', { name: 'Senden', exact: true }).click();
  await m.goto(`/meister/auftrag?id=${orderId}`);
  await m.getByRole('button', { name: 'Auftrag freigeben' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Freigegeben' })).toBeVisible();
  await ctx.close();

  // ---- Monteur receives the answer with read receipt flow ----
  await page.goto(`/monteur/chat?orderId=${orderId}`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Danke, ich rufe an.')).toBeVisible({ timeout: 30_000 });

  // ---- BC: report as service comment lines (≤ 80 chars) ----
  await expect
    .poll(
      async () =>
        (await writes(request))
          .filter((w) => w.entitySet === 'serviceCommentLines' && w.status === 201)
          .map((w) => String(w.body.comment)),
      { timeout: 45_000 },
    )
    .toEqual(expect.arrayContaining([expect.stringContaining('Probefahrt durchgeführt')]));
});
