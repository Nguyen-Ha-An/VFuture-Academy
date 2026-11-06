import { test, expect } from './fixtures';

test('entrance presents sign in and language and legal links on desktop and mobile', async ({ page }, testInfo) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto('/?lang=en');
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /privacy/i })).toBeVisible();
    await expect(page.locator('header.academy-shell-header')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`entrance-${width}.png`), fullPage: true });
  }
});

test('retired public paths redirect to the corresponding app path', async ({ request }) => {
  for (const section of ['courses', 'resources', 'opportunities', 'projects']) {
    for (const suffix of ['', '/sample']) {
      const response = await request.get(`/${section}${suffix}?lang=en`, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain(`/app/${section}${suffix}`);
      expect(response.headers().location).toContain('lang=en');
    }
  }
});

test('auth language links preserve the return path', async ({ page }) => {
  for (const path of ['/signup', '/forgot-password']) {
    await page.goto(`${path}?next=%2Fapp%2Fcourses&lang=vi`);
    await page.getByRole('link', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/app/courses');
  }
});
