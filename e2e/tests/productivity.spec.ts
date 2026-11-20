/**
 * Productivity (PROMPT 5.11): approved times of the previous month → the Monteur sees his own figure with target
 * corridor, categories and trend; the Meister sees the same figure in the team view.
 */
import { expect, test } from '@playwright/test';
import pg from 'pg';

const prevMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};

test('own productivity with categories and trend; same figure in the Meister team view', async ({
  page,
  browser,
}) => {
  const month = prevMonth();
  const day1 = `${month}-05`;
  const day2 = `${month}-06`;
  const owner = new pg.Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await owner.connect();
  try {
    const [u] = (await owner.query("select id from app_user where email = 'monteur.clp@example.invalid'"))
      .rows;
    const [loc] = (await owner.query("select id from location where code = 'CLP'")).rows;
    const orders = (
      await owner.query('select id from service_order where location_id = $1 order by bc_no limit 2', [
        loc.id,
      ])
    ).rows;
    await owner.query(
      "update service_order set order_type_code = 'KUNDE', rework_flag = false where id = $1",
      [orders[0].id],
    );
    await owner.query(
      "update service_order set order_type_code = 'GEBR', rework_flag = false where id = $1",
      [orders[1].id],
    );
    const add = (day: string, kind: string, min: number, orderId: string | null = null) =>
      owner.query(
        `insert into time_entry (user_id, location_id, work_date, kind, order_id, activity, start_at, end_at, actual_minutes, billable_minutes, state)
         values ($1, $2, $3, $4, $5, $6, $3::date + time '07:00', $3::date + time '07:00' + make_interval(mins => $7), $7, $8, 'APPROVED')`,
        [u.id, loc.id, day, kind, orderId, orderId ? 'WORK' : null, min, orderId ? min : null],
      );
    // 2 × (8 h present − 30 min break) = 900 min; 765 min customer service + 60 min used machines → 85 %
    for (const d of [day1, day2]) {
      await add(d, 'ATTENDANCE', 480);
      await add(d, 'BREAK', 30);
    }
    await add(day1, 'ORDER', 400, orders[0].id);
    await add(day2, 'ORDER', 365, orders[0].id);
    await add(day2, 'ORDER', 60, orders[1].id);
  } finally {
    await owner.end();
  }

  await page.goto('/login');
  await page.click('[data-persona="monteur-clp"]');
  await page.waitForURL('**/monteur');
  await page.getByRole('link', { name: /Meine Produktivität/ }).click();
  await page.waitForURL('**/monteur/produktivitaet');
  await page.getByRole('button', { name: 'Vormonat' }).click();
  await expect(page.getByTestId('productivity')).toHaveText('85 %');
  await expect(page.getByText(/im Zielkorridor/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Kundenservice 12,8 h, Intern sonstige 1 h/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Produktivität der letzten 12 Monate' })).toBeVisible();
  await page.screenshot({ path: 'test-results/productivity-monteur.png', fullPage: true });

  const m = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await m.goto('/login');
  await m.click('[data-persona="meister-clp"]');
  await m.waitForURL('**/meister');
  await m.getByRole('link', { name: /Produktivität Team/ }).click();
  await m.getByRole('button', { name: 'Vormonat' }).click();
  await expect(m.getByRole('row').filter({ hasText: 'Hendrik Wessels' })).toContainText('85 %');
  await expect(m.getByRole('row').filter({ hasText: 'gesamt' })).toContainText('85 %');
  await m.screenshot({ path: 'test-results/productivity-meister.png', fullPage: true });
  await m.context().close();
});
