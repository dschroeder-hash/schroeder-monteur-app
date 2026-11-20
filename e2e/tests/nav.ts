import type { Page } from '@playwright/test';

/**
 * Opens an area through the main navigation: side navigation on the iPad, drawer behind "Menü" on phones.
 * In the iPad portrait icon rail the full name is the link's accessible name as well.
 */
export async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menü', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name, exact: true })
    .click();
}
