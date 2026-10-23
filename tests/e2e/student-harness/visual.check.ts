import { test, expect } from '@playwright/test';

const account = 'A very long learner name used to verify account menu geometry and truncation behavior';
for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
 test.describe(`account visual en ${theme} ${width}`, () => {
  test.use({ viewport: { width, height: 900 }, colorScheme: theme, contextOptions: { reducedMotion: 'reduce' } });
  test('keyboard-open account surface', async ({ page }, info) => {
   await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4180') return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 501, body: 'Unexpected visual fixture API request' });
    return route.continue();
   });
   await page.goto('/app?lang=en');
   await expect(page.locator('main h1')).toBeVisible();
   expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
   expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
   const trigger = width >= 760 ? page.getByRole('button', { name: account }) : page.locator('button[aria-controls="learner-mobile-navigation"]');
   await trigger.focus();
   await trigger.press(width >= 760 ? 'ArrowDown' : 'Enter');
   const surface = page.getByRole(width >= 760 ? 'menu' : 'dialog');
   await expect(surface).toBeVisible();
   if (width >= 760) await expect(surface.getByRole('menuitem').first()).toBeFocused();
   else {
    // Radix's first focus target is the real drawer Close control.
    await expect(surface.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
   }
   expect(await surface.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
   await page.evaluate(() => document.fonts.ready);
   await info.attach('visual-fonts-and-platform', { body: JSON.stringify({ platform: process.platform, viewport: width, theme, fonts: await page.evaluate(() => Array.from(document.fonts).map(font => ({ family: font.family, status: font.status }))), limitation: 'Platform fallback fonts; not an exact production typography baseline.' }), contentType: 'application/json' });
   await expect(surface).toHaveScreenshot(`account-refined-en-${theme}-${width}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.01 });
  });
 });
}
