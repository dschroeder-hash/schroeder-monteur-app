/**
 * "Arbeit abgeschlossen" without a Meister (E-66 to E-68): the Monteur checks the workshop order, fills in the
 * service checklist, the customer signs on the device – the worker hands everything to BC on its own: report and
 * checklist as comment lines, the signed workshop order as PDF attachment, the status.
 * Online flow, so it runs on the iPad (WebKit) as well.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BC_MOCK_URL } from '../playwright.config.js';

const writes = async (request: APIRequestContext) =>
  (await (await request.get(`${BC_MOCK_URL}/__mock/writes`)).json()) as Array<{
    entitySet: string;
    body: Record<string, unknown>;
    status: number;
  }>;

async function sign(page: Page) {
  const pad = page.getByTestId('signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(box.x + 30 + i * 20, box.y + box.height / 2 + (i % 2 ? -25 : 25), { steps: 2 });
  await page.mouse.up();
}

test('Monteur finishes the order with checklist and customer signature – BC receives report, PDF and status', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.click('[data-persona="monteur2-wild"]');
  await page.waitForURL('**/monteur');
  const due = page.locator('section[aria-labelledby="heute"] a');
  await expect(due.first()).toBeVisible({ timeout: 20_000 });
  const href = (await due.first().getAttribute('href'))!;
  const orderId = href.split('id=')[1]!;

  // ---- Report ----
  await page.goto(`/monteur/bericht?orderId=${orderId}`);
  await page.getByRole('button', { name: 'Öle und Filter gewechselt' }).click();
  const hours = page.getByLabel(/Betriebsstunden/);
  if (await hours.count()) await hours.fill('4321');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.waitForURL('**/monteur/auftrag?id=*');

  // ---- Completion page: workshop order, checklist, signature ----
  await page.getByRole('link', { name: /Arbeit abgeschlossen/ }).click();
  await page.waitForURL('**/monteur/abschluss?orderId=*');
  await expect(page.getByRole('article', { name: 'Werkstattauftrag' })).toBeVisible();
  const finish = page.getByRole('button', { name: 'Arbeit abgeschlossen', exact: true });
  await expect(finish).toBeDisabled();

  const checklist = page.getByRole('heading', { name: /Checkliste:/ });
  if (await checklist.count()) {
    // yellow card: tick every "Eingabe" checkbox (the end-of-repair questions are mandatory), one quantity with unit
    const open = page.locator('[data-check] [role="checkbox"][aria-checked="false"]');
    while ((await open.count()) > 0) await open.first().click();
    const qty = page.getByRole('textbox', { name: 'Menge Motoröl' });
    if (await qty.count()) {
      await qty.fill('12');
      await page.getByRole('combobox', { name: 'Einheit Menge Motoröl' }).selectOption('Liter');
    }
    await expect(page.getByText(/Noch offen/)).toHaveCount(0);
  }

  await page.getByLabel('Name des Unterzeichners').fill('Hinrich Kunde');
  await sign(page);
  await page.getByRole('button', { name: 'Unterschrift übernehmen' }).click();
  await expect(page.getByText('Unterschrieben von Hinrich Kunde')).toBeVisible();
  await page.screenshot({ path: 'test-results/abschluss.png', fullPage: true });

  await expect(finish).toBeEnabled();
  await finish.click();
  await page.waitForURL('**/monteur/auftrag?id=*');
  await expect(page.getByText('Arbeit abgeschlossen').first()).toBeVisible();

  // ---- BC (mock): comment lines, signed PDF, status – without anybody approving ----
  await expect
    .poll(
      async () => {
        const w = (await writes(request)).filter((x) => x.status === 201 || x.status === 200);
        return {
          report: w.some(
            (x) => x.entitySet === 'serviceCommentLines' && String(x.body.comment).includes('Filter'),
          ),
          pdf: w.some(
            (x) =>
              x.entitySet === 'serviceOrderAttachments' &&
              String(x.body.fileName).startsWith('Werkstattauftrag_') &&
              Buffer.from(String(x.body.fileContent), 'base64').subarray(0, 5).toString() === '%PDF-',
          ),
        };
      },
      { timeout: 60_000 },
    )
    .toEqual({ report: true, pdf: true });
});
