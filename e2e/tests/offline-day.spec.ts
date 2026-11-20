/**
 * Offline working day (PROMPT 7 / DoD 12): a Monteur stamps a complete day in flight mode;
 * after reconnecting everything is synced completely and without duplicates.
 */
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { API_URL, deviceDayStart } from '../playwright.config.js';

const HOUR = 3_600_000;

async function login(page: Page, persona: string) {
  await page.goto('/login');
  await page.click(`[data-persona="${persona}"]`);
  await page.waitForURL('**/monteur');
}

async function tap(page: Page, name: string) {
  // Stamp buttons live in the sticky bar or on the order page; names are unique per state.
  await page.getByRole('button', { name, exact: true }).first().click();
}

// Playwright's offline emulation in WebKit also cuts off the service worker's cached answers (navigation and
// fetch fail with "WebKit encountered an internal error"), so flight mode cannot be emulated there. Real Safari
// is not affected; the scenario runs on the smartphone project (Chromium) and must be checked on a real iPad.
test.skip(
  ({ browserName }) => browserName === 'webkit',
  'Flugmodus lässt sich in Playwright-WebKit nicht emulieren',
);

test('complete working day in flight mode, then sync without duplicates', async ({ page, context }) => {
  // Start the device clock in the past so the day can be "lived" with fast-forward.
  const start = deviceDayStart();
  await page.clock.install({ time: start });
  await login(page, 'monteur-wild');

  // Initial sync: today's three orders are on the device.
  const due = page
    .getByRole('region', { name: /Heute fällig/ })
    .or(page.locator('section[aria-labelledby="heute"]'));
  await expect(page.getByRole('heading', { name: /Heute fällig \(3\)/ })).toBeVisible({ timeout: 20_000 });
  const orderLinks = due.getByRole('link');
  const hrefs = await orderLinks.evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!),
  );
  expect(hrefs).toHaveLength(3);

  // Wait until the service worker controls the page (app shell available offline).
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

  // ---- Flight mode ----
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();

  // Order A: travel then work (Kommen is stamped implicitly).
  await page.goto(hrefs[0]!);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await tap(page, 'Fahrt');
  await expect(page.getByText('„Kommen“ wurde automatisch gestempelt')).toBeVisible();
  await page.clock.fastForward(30 * 60_000);
  await tap(page, 'Arbeit');
  await page.clock.fastForward(2 * HOUR);

  // Order B: direct switch, break in between (job resumes automatically).
  await page.goto(hrefs[1]!);
  await tap(page, 'Arbeit');
  await page.clock.fastForward(HOUR);
  await tap(page, 'Pause');
  await page.clock.fastForward(30 * 60_000);
  await tap(page, 'Pause beenden');
  await page.clock.fastForward(HOUR);

  // Order C: diagnosis, then stop and clock out.
  await page.goto(hrefs[2]!);
  await tap(page, 'Diagnose');
  await page.clock.fastForward(HOUR);
  await tap(page, 'Stopp');
  await expect(page.getByRole('button', { name: 'Gemeinkosten' })).toBeVisible();
  await tap(page, 'Gehen');
  await expect(page.getByRole('button', { name: 'Kommen' })).toBeVisible();

  // Times are visible offline, computed on the device.
  await page.goto('/monteur/zeiten');
  // 6:00 h attendance − 0:30 h break, computed on the device without network.
  const work = page
    .getByRole('term')
    .filter({ hasText: /^Arbeitszeit$/ })
    .locator('xpath=following-sibling::dd[1]');
  await expect(work).toHaveText('5:30 h');
  await expect(page.getByRole('status').filter({ hasText: /8 ausstehend/ })).toBeVisible();

  // ---- Back online ----
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').filter({ hasText: /ausstehend/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  // Server state: all 8 stamp events exactly once, times derived correctly.
  const owner = new pg.Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await owner.connect();
  try {
    const user = (await owner.query("select id from app_user where email = 'monteur.wild@example.invalid'"))
      .rows[0].id;
    const events = (await owner.query('select id, kind from stamp_event where user_id = $1', [user])).rows;
    expect(events).toHaveLength(8);
    expect(new Set(events.map((e) => e.id)).size).toBe(8);
    const sums = (
      await owner.query(
        'select kind, activity, sum(actual_minutes)::int as m from time_entry where user_id = $1 group by 1,2 order by 1,2',
        [user],
      )
    ).rows;
    const m = (kind: string, activity: string | null) =>
      sums.find((r) => r.kind === kind && r.activity === activity)?.m;
    expect(m('ORDER', 'TRAVEL')).toBe(30);
    expect(m('ORDER', 'WORK')).toBe(240); // A 120 + B 60 + B 60 after the break
    expect(m('ORDER', 'DIAGNOSIS')).toBe(60);
    expect(m('BREAK', null)).toBe(30);
    expect(m('ATTENDANCE', null)).toBe(360);
    const statuses = (
      await owner.query('select app_status from service_order where id = any($1)', [
        hrefs.map((h) => h.split('id=')[1]),
      ])
    ).rows;
    expect(statuses.every((s) => s.app_status === 'IN_ARBEIT')).toBe(true);
  } finally {
    await owner.end();
  }

  // A second sync (e.g. after reload) must not create duplicates either.
  await page.reload();
  const token = await page.evaluate(() => sessionStorage.getItem('monteur.devToken'));
  const pull = await page.request.get(`${API_URL}/v1/sync/pull`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect((await pull.json()).stampEvents).toHaveLength(8);
});
