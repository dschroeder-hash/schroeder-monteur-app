/**
 * Absences end to end (PROMPT 5.9/5.10, DoD "Urlaub und Krankmeldung laufen Ende-zu-Ende inklusive BC-Transfer"):
 * the Monteur reports sick in 2 taps and requests vacation – both offline; after sync the Meister acknowledges and
 * approves, sets the end of the sick report; both arrive in BC as employee absences. Personal sees both.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { BC_MOCK_URL } from '../playwright.config.js';

const writes = async (request: APIRequestContext) =>
  (await (await request.get(`${BC_MOCK_URL}/__mock/writes`)).json()) as Array<{
    method: string;
    entitySet: string;
    body: Record<string, unknown>;
    status: number;
  }>;

const berlinDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

test('sick report and vacation offline → Meister decides → employee absences in BC, Personal overview', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/login');
  await page.click('[data-persona="azubi-wild"]');
  await page.waitForURL('**/monteur');
  await expect(page.getByRole('heading', { name: /Heute fällig/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

  await page.context().setOffline(true);

  // ---- Sick report: 2 taps from the dashboard ----
  await page.getByRole('button', { name: 'Krank melden' }).click();
  await expect(page.getByText(/eAU/)).toBeVisible();
  await page.getByRole('button', { name: 'Krankmeldung senden' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ---- Vacation request (offline), remaining vacation computed on the device ----
  await page.getByRole('link', { name: 'Abwesenheit' }).click();
  await page.waitForURL('**/monteur/abwesenheit');
  await expect(page.getByText(/Krank gemeldet ab/)).toBeVisible();
  await page.getByLabel('Von', { exact: true }).fill('2027-03-01');
  await page.getByLabel('Bis', { exact: true }).fill('2027-03-05');
  await expect(page.getByText('5 Arbeitstage (ohne Wochenenden und Feiertage)')).toBeVisible();
  await page.getByRole('button', { name: 'Urlaub beantragen' }).click();
  await expect(page.getByText(/Urlaub · 01\.03\.2027 – 05\.03\.2027/)).toBeVisible();
  await expect(page.getByText(/beantragt · 5 Arbeitstage · wird übertragen/)).toBeVisible();

  // ---- Back online → sync ----
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/wird übertragen/)).toHaveCount(0, { timeout: 30_000 });

  // ---- Meister: inbox ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const m = await ctx.newPage();
  await m.goto('/login');
  await m.click('[data-persona="meister-wild"]');
  await m.waitForURL('**/meister');
  await m.goto('/meister/freigaben');
  const sick = m.locator('article[data-absence]').filter({ hasText: 'Fynn Ahlers · Krankmeldung' });
  await expect(sick).toBeVisible();
  await sick.getByRole('button', { name: 'Zur Kenntnis genommen' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Krankmeldung bestätigt' })).toBeVisible();
  const vac = m.locator('article[data-absence]').filter({ hasText: 'Fynn Ahlers · Urlaubsantrag' });
  await expect(vac.getByText('01.03.2027 – 05.03.2027 · 5 Arbeitstage')).toBeVisible();
  await vac.getByRole('button', { name: 'Genehmigen' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Urlaub genehmigt' })).toBeVisible();

  // ---- Meister: end of the sick report (the Monteur called) ----
  await m.goto('/meister/abwesenheiten');
  const row = m.getByRole('row').filter({ hasText: 'Fynn Ahlers' }).filter({ hasText: 'Krank' });
  await row.getByLabel(/Ende der Krankmeldung/).fill(berlinDate(1));
  await row.getByRole('button', { name: 'Ende speichern' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Ende gespeichert' })).toBeVisible();
  await ctx.close();

  // ---- BC: two employee absences (KRANK, URLAUB) for employee M0003, no comment text ----
  await expect
    .poll(
      async () =>
        (await writes(request))
          .filter((w) => w.entitySet === 'employeeAbsences' && w.method === 'POST' && w.status === 201)
          .map(
            (w) =>
              `${w.body.employeeNumber}|${w.body.causeOfAbsenceCode}|${w.body.fromDate}|${w.body.toDate}`,
          ),
      { timeout: 45_000 },
    )
    .toEqual(
      expect.arrayContaining([
        `M0003|URLAUB|2027-03-01|2027-03-05`,
        `M0003|KRANK|${berlinDate()}|${berlinDate(1)}`,
      ]),
    );

  // ---- Monteur sees the decision ----
  await page.reload();
  await expect(page.getByText(/genehmigt · 5 Arbeitstage/)).toBeVisible({ timeout: 30_000 });

  // ---- Personal: overview across locations ----
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.goto('/login');
  await p.click('[data-persona="personal"]');
  await p.waitForURL('**/personal');
  await p.getByLabel('Bis', { exact: true }).fill('2027-03-31');
  const personalRows = p.getByRole('row').filter({ hasText: 'Fynn Ahlers' });
  await expect(personalRows.filter({ hasText: 'Urlaub' }).filter({ hasText: 'in BC' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(personalRows.filter({ hasText: 'Krank' })).toBeVisible();
  await p.context().close();
});
