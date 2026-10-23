import { expect, test } from '@playwright/test';
import { openRoleContext, setLocale, unavailableRoleStorageStateMessage } from './support/auth';

const audiences = [
  { role: 'public', paths: ['/', '/courses', '/resources', '/opportunities', '/projects'] },
  { role: 'learner', paths: ['/app', '/app/courses', '/app/resources', '/app/opportunities', '/app/projects', '/app/profile'] },
  { role: 'admin', paths: ['/studio/courses', '/admin/users', '/admin/exams'] },
] as const;

for (const locale of ['en', 'vi'] as const) {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    test(`@recovery-15 primary screens render without page overflow in ${locale} on ${viewport.name}`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(240_000);
      if (!baseURL) throw new Error('Responsive acceptance requires an explicit application origin.');
      const unavailable = unavailableRoleStorageStateMessage(['admin', 'learner']);
      if (unavailable) throw new Error(unavailable);
      for (const audience of audiences) {
        const context = audience.role === 'public'
          ? await browser.newContext({ baseURL })
          : await openRoleContext(browser, audience.role, baseURL);
        try {
          await setLocale(context, baseURL, locale);
          const page = await context.newPage();
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          for (const path of audience.paths) {
            const response = await page.goto(path);
            expect(response?.status(), `${locale}/${viewport.name} ${path}`).toBe(200);
            await expect(page.locator('h1').first()).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await page.evaluate(() => document.fonts.ready);
            const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
            expect.soft(width.page, `${locale}/${viewport.name} ${path} page overflow`).toBeLessThanOrEqual(width.viewport + 1);
            await page.screenshot({ path: testInfo.outputPath(`${locale}-${viewport.name}-${audience.role}-${path.replaceAll('/', '-') || 'landing'}.png`), fullPage: true });
          }
        } finally {
          await context.close();
        }
      }
    });
  }
}
