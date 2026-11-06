import { test, expect } from './fixtures';

test('entrance remains usable in short and narrow viewports', async ({ page }) => {
  for (const viewport of [{ width: 360, height: 640 }, { width: 1440, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?lang=en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
