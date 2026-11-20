/**
 * DoD (PROMPT 12): the Meister plans by drag & drop and approves; the data arrives at the BC service order
 * (here: BC mock, written by the worker through the transfer queue).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API_URL, BC_MOCK_URL } from '../playwright.config.js';

async function devToken(request: APIRequestContext, persona: string) {
  const personas = await (await request.get(`${API_URL}/dev/personas`)).json();
  const p = personas.find((x: { key: string }) => x.key === persona);
  const res = await request.post(`${API_URL}/dev/token`, {
    data: { oid: p.oid, name: p.name, email: p.email, roles: p.roles },
  });
  return (await res.json()).accessToken as string;
}

async function bcWrites(request: APIRequestContext) {
  return (await (await request.get(`${BC_MOCK_URL}/__mock/writes`)).json()) as Array<{
    method: string;
    entitySet: string;
    body: Record<string, unknown>;
    status: number;
  }>;
}

async function dragTo(page: Page, source: string, target: string) {
  const from = await page.locator(source).first().boundingBox();
  const to = await page.locator(target).first().boundingBox();
  if (!from || !to) throw new Error('drag source or target not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });

test('Meister plans by drag & drop and approves times – data arrives in BC', async ({ page, request }) => {
  // A finished working day of a Monteur (stamped via the sync API, yesterday).
  const monteur = await devToken(request, 'monteur2-wild');
  const me = await (
    await request.get(`${API_URL}/v1/me`, { headers: { authorization: `Bearer ${monteur}` } })
  ).json();
  const pull = await (
    await request.get(`${API_URL}/v1/sync/pull`, { headers: { authorization: `Bearer ${monteur}` } })
  ).json();
  const orderId = pull.assignments[0].orderId as string;
  const bcNo = pull.orders.find((o: { id: string }) => o.id === orderId).bcNo as string;
  const yesterday = new Date(Date.now() - 24 * 3_600_000);
  const at = (h: number) =>
    new Date(
      Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), h),
    ).toISOString();
  const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(at(8)));
  const cmd = (type: string, h: number, payload: object, seq: number) => ({
    id: randomUUID(),
    type,
    deviceTime: at(h),
    deviceSeq: seq,
    payload,
  });
  const pushed = await request.post(`${API_URL}/v1/sync/push`, {
    headers: { authorization: `Bearer ${monteur}` },
    data: {
      deviceId: 'e2e-meister',
      deviceNow: new Date().toISOString(),
      commands: [cmd('StampJobStart', 6, { orderId, activity: 'WORK' }, 1), cmd('StampClockOut', 9, {}, 2)],
    },
  });
  expect(pushed.ok()).toBe(true);

  // ---- Planning board: drag an unplanned order onto a Monteur at 09:00 ----
  await page.goto('/login');
  await page.click('[data-persona="meister-wild"]');
  await page.waitForURL('**/meister');
  await page.getByRole('link', { name: 'Plantafel' }).click();
  await expect(page.locator('[data-drag^="order|"]').first()).toBeVisible();
  const draggedOrder = (await page.locator('[data-drag^="order|"]').first().getAttribute('data-drag'))!.split(
    '|',
  )[1]!;
  await dragTo(page, '[data-drag^="order|"]', '[data-cell$="|09"]');
  // Saved – possibly with a double-booking warning (warn, never block).
  await expect(page.getByRole('status').filter({ hasText: /Eingeplant|Gespeichert, aber/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /09:00 Uhr abgelegt/ })).toHaveCount(1);
  await expect(page.locator('[data-cell$="|09"] [data-drag^="assign|"]').first()).toBeVisible();

  // Worker writes the Service Order Allocation to BC.
  await expect
    .poll(
      async () =>
        (await bcWrites(request)).some(
          (w) => w.method === 'POST' && w.entitySet === 'serviceOrderAllocations' && w.status === 201,
        ),
      { timeout: 45_000 },
    )
    .toBe(true);
  expect(draggedOrder).toBeTruthy();

  // ---- Approval inbox: approve the Monteur's day ----
  await page.getByRole('link', { name: 'Freigaben' }).click();
  const day = page.locator(`[data-day="${me.id}|${workDate}"]`);
  await expect(day).toBeVisible();
  await day.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'freigegeben' })).toBeVisible();

  // Worker creates the resource line (3 h) on the BC service order.
  await expect
    .poll(
      async () =>
        (await bcWrites(request)).find(
          (w) =>
            w.method === 'POST' &&
            w.entitySet === 'serviceLines' &&
            w.status === 201 &&
            w.body.documentNumber === bcNo,
        )?.body,
      { timeout: 45_000 },
    )
    .toMatchObject({ type: 'Resource', number: 'R0002', quantity: 3, workTypeCode: 'ARBEIT' });
});
