import { expect, test } from '@playwright/test';

for (const width of [390, 1440, 1920]) test(`Admin overview fits the available width at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/admin?uiv2=1&lang=en&scope=central');
  await expect(page.locator('.canvas-admin-overview')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work waiting' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/academy-task2-admin-overview-${width}.png` });
});
