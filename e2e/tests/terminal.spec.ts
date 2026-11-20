/** Workshop PC (E-72): personnel number + PIN, then one tap – the stamp belongs to the employee. */
import { expect, test } from '@playwright/test';

test('an employee without iPad stamps in and out at the workshop PC', async ({ page }) => {
  await page.goto('/login');
  await page.click('[data-persona="werkstatt-pc-wild"]');
  await page.waitForURL('**/terminal');

  await page.getByLabel('Personalnummer').fill('M0002');
  await page.getByLabel('PIN').fill('1234');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Lukas Bruns (Monteur WILD)')).toBeVisible();
  await page.getByRole('button', { name: 'Kommen' }).click();
  await expect(page.getByRole('status')).toContainText('Kommen gestempelt');
  // the form is empty again for the next colleague
  await expect(page.getByLabel('Personalnummer')).toHaveValue('');

  await page.getByLabel('Personalnummer').fill('M0002');
  await page.getByLabel('PIN').fill('1234');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Gehen' }).click();
  await expect(page.getByRole('status')).toContainText('Gehen gestempelt');

  await page.getByLabel('Personalnummer').fill('M0002');
  await page.getByLabel('PIN').fill('9999');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('alert')).toContainText('Personalnummer oder PIN falsch');
});
