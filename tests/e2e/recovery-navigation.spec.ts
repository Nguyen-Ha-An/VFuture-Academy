import { expect, test } from './support/fixtures';

test.describe('@recovery-02 legacy navigation', () => {
  test('temporarily redirects legacy pages while preserving identifiers and repeated query values', async ({ request }) => {
    const cases = [
      ['/home', '/app'],
      ['/learn', '/app/courses'],
      ['/learn/ai-foundations', '/app/courses/ai-foundations'],
      ['/learn/ai-foundations/items/what-is-ai', '/app/courses/ai-foundations/items/what-is-ai'],
      ['/build', '/app/projects'],
      ['/build/recovery-approved-project', '/app/projects/recovery-approved-project'],
      ['/profile', '/app/profile'],
      ['/leaderboard', '/app/leaderboard'],
    ];
    for (const [legacy, canonical] of cases) {
      const response = await request.get(`${legacy}?lang=en&tag=one&tag=two`, { maxRedirects: 0 });
      expect(response.status(), legacy).toBe(307);
      const location = new URL(response.headers().location, response.url());
      expect(location.pathname, legacy).toBe(canonical);
      expect(location.searchParams.get('lang')).toBe('en');
      expect(location.searchParams.getAll('tag')).toEqual(['one', 'two']);
    }
  });
});

test.describe('@recovery-02 learner navigation', () => {
  test.use({ role: 'learner' });

  test('uses one shell across direct links, refresh, and browser history', async ({ rolePage: page }, testInfo) => {
    await page.goto('/app');
    await expect(page.locator('#learner-main')).toHaveCount(1);
    await expect(page.locator('#learner-main h1')).toBeVisible();
    await page.locator('nav a[href="/app/courses"]').click();
    await expect(page).toHaveURL(/\/app\/courses$/);
    await page.reload();
    await expect(page.locator('#learner-main')).toHaveCount(1);
    await expect(page.locator('nav a[href="/app/courses"]')).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('nav a[href="/app"]')).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: testInfo.outputPath('learner-desktop.png'), fullPage: true });
  });

  test('keeps the landing page public after login and enforces Studio access on direct requests', async ({ rolePage: page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('h1').first()).toBeVisible();
    const response = await page.goto('/studio');
    expect(response?.status()).toBe(403);
    await expect(page.locator('a[href="/studio/courses"]')).toHaveCount(0);
  });

  test('opens and closes mobile navigation with keyboard focus and follows links', async ({ rolePage: page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app');
    const trigger = page.locator('button[aria-controls="learner-mobile-navigation"]');
    await trigger.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('learner-mobile-menu.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await drawer.locator('a[href="/app/courses"]').click();
    await expect(page).toHaveURL(/\/app\/courses$/);
    await expect(drawer).toHaveCount(0);
    await expect(page.locator('#learner-main h1')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('learner-mobile-courses.png'), fullPage: true });
  });
});

test.describe('@recovery-02 staff workspace switch', () => {
  test.use({ role: 'admin' });

  test('switches from learner navigation to the permitted Studio workspace and back', async ({ rolePage: page }, testInfo) => {
    await page.goto('/app');
    await page.locator('a[href="/studio"]:visible').first().click();
    await expect(page).toHaveURL(/\/studio(?:\/courses)?$/);
    await expect(page.locator('main')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
    // The legacy shells show the learning link in the header; the Catmin shell keeps it in the user menu.
    const learning = page.locator('a[href="/app"]:visible');
    if (!(await learning.count())) await page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]').click();
    await page.locator('a[href="/app"]:visible').first().click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#learner-main')).toHaveCount(1);
  });
});
