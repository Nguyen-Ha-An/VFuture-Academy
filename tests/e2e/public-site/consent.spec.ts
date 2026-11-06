import { test, expect } from './fixtures';

test('legal notices remain reachable from the entrance', async ({ page }) => {
  await page.goto('/?lang=en');
  const privacy = page.getByRole('link', { name: /privacy/i });
  await expect(privacy).toHaveAttribute('href', '/privacy?lang=en');
  await privacy.click();
  await expect(page).toHaveURL(/\/privacy/);
  await expect(page.locator('main')).toBeVisible();
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await page.getByRole('button', { name: 'Cookie preferences' }).click();
  await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/?lang=en');
  await page.getByRole('link', { name: /terms/i }).click();
  await expect(page).toHaveURL(/\/terms/);
  await expect(page.locator('main')).toBeVisible();
});
