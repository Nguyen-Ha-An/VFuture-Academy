import AxeBuilder from '@axe-core/playwright';
import { test, expect, isolatePublicContext } from './fixtures';

const catalogs = ['courses', 'projects', 'opportunities', 'resources'] as const;
async function ready(page: import('@playwright/test').Page) {
  await expect(page.locator('.public-loading')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
}

const routes = ['/', '/academy', ...catalogs.map((catalog) => `/${catalog}`), '/contact', '/privacy', '/terms'];

async function noOverflow(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('public route matrix retains one main, one H1, shared navigation, locale and metadata', async ({ page }) => {
  test.setTimeout(120_000);
  for (const locale of ['en', 'vi']) {
    for (const path of routes) {
      const response = await page.goto(`${path}?lang=${locale}`);
      await ready(page);
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('header.academy-shell-header')).toHaveCount(1);
      await expect(page.locator('footer')).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{20}/);
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
      await noOverflow(page);
    }
  }
});

test('all public catalogs fit responsive and short-height viewports', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const width of [360, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 720 });
    for (const catalog of catalogs) {
      await page.goto(`/${catalog}?lang=en`);
      await ready(page);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('[data-public-results]')).toBeVisible();
      await noOverflow(page);
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${catalog}-${width}.png`), fullPage: true });
    }
  }
});

test('resource filters reset page, announce results, synchronize on history, clear and retain locale', async ({ page }) => {
  await page.goto('/resources?lang=en&page=2');
  await ready(page);
  const form = page.locator('form').filter({ has: page.locator('[name="search"]') });
  const search = form.locator('[name="search"]');
  const type = form.locator('select[name="type"]');
  await search.fill('public-qa-no-match');
  await type.selectOption('guide');
  await form.locator('button[type="submit"], button:not([type])').click();
  await expect(page).toHaveURL(/search=public-qa-no-match/);
  let url = new URL(page.url());
  expect(url.searchParams.get('type')).toBe('guide');
  expect(url.searchParams.get('lang')).toBe('en');
  expect(url.searchParams.has('page')).toBe(false);
  await expect(page.locator('[data-public-results-focus]')).toBeFocused();
  await search.fill('second-qa-no-match');
  await form.locator('button[type="submit"], button:not([type])').click();
  await expect(page).toHaveURL(/search=second-qa-no-match/);
  await page.goBack();
  await expect(search).toHaveValue('public-qa-no-match');
  await expect(type).toHaveValue('guide');
  await page.goForward();
  await expect(search).toHaveValue('second-qa-no-match');
  const clear = page.locator('main a').filter({ hasText: /clear|reset/i }).first();
  await clear.click();
  await expect(page).toHaveURL(/\/resources\?lang=en$/);
  url = new URL(page.url());
  expect(url.searchParams.get('lang')).toBe('en');
  expect(url.searchParams.has('search')).toBe(false);
  await expect(search).toHaveValue('');
});

test('project and opportunity GET controls preserve functional query state', async ({ page }) => {
  await page.goto('/projects?lang=en');
  await ready(page);
  const projectForm = page.locator('form').filter({ has: page.locator('[name="skill"]') });
  await projectForm.locator('[name="skill"]').fill('public-qa-no-match');
  const courseFilter = projectForm.locator('select[name="course"]');
  const courseOptions = await courseFilter.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
  const selectedCourse = courseOptions[0];
  if (selectedCourse) await courseFilter.selectOption(selectedCourse);
  await projectForm.locator('button[type="submit"], button:not([type])').click();
  await expect(page).toHaveURL(/skill=public-qa-no-match/);
  expect(new URL(page.url()).searchParams.get('course')).toBe(selectedCourse ?? null);
  expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
  await page.goto('/opportunities?lang=en');
  await ready(page);
  const opportunityForm = page.locator('form').filter({ has: page.locator('[name="openNow"]') });
  await opportunityForm.locator('select[name="type"]').selectOption('hackathon');
  await opportunityForm.locator('[name="openNow"]').check();
  await opportunityForm.locator('[name="featured"]').check();
  await opportunityForm.locator('button[type="submit"], button:not([type])').click();
  await expect(page).toHaveURL(/type=hackathon/);
  const url = new URL(page.url());
  expect(url.searchParams.get('openNow')).toBe('true');
  expect(url.searchParams.get('featured')).toBe('true');
  expect(url.searchParams.get('lang')).toBe('en');
});

test('course details preserve catalog context and expose the exact protected continuation', async ({ page }, testInfo) => {
  await page.goto('/courses?lang=en');
  await ready(page);
  const detailLink = page.locator('main h2 a[href^="/courses/"]').first();
  // Public datasets may be empty. Deterministic fixture tests separately enforce
  // rich detail rendering, disclosure limits and all four context contracts.
  if (await detailLink.count() === 0) {
    testInfo.annotations.push({ type: 'data-coverage', description: 'No published courses in local dataset; deterministic server-page fixtures cover detail context.' });
    await expect(page.locator('[data-public-results]')).toBeVisible();
    return;
  }
  const href = await detailLink.getAttribute('href');
  await detailLink.click();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main a[href^="/app/courses/"]').first()).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach('course-detail-axe', { body: JSON.stringify(accessibility.violations, null, 2), contentType: 'application/json' });
  expect(accessibility.violations).toEqual([]);
  const url = new URL(page.url());
  expect(url.searchParams.get('lang')).toBe('en');
  expect(url.pathname).toBe(new URL(href!, page.url()).pathname);
  const back = page.locator('main a[href="/courses?lang=en"]').first();
  await back.click();
  await expect(page).toHaveURL(/\/courses\?lang=en$/);
});

test('mobile navigation supports keyboard focus, Escape and locale-preserving destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/projects?lang=en&skill=robotics');
  await ready(page);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.click();
  const navigation = page.locator('#academy-shell-navigation');
  await expect(navigation.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await navigation.getByRole('link', { name: 'Resources', exact: true }).click();
  await expect(page).toHaveURL(/\/resources\?lang=en$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Tiếng Việt', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
});

test('draft policies are noindex, contact is actionable, and unknown URLs have a branded 404', async ({ page }) => {
  for (const policy of ['privacy', 'terms']) {
    await page.goto(`/${policy}?lang=en`);
    await ready(page);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('main')).toContainText(/draft|review/i);
    await expect(page.locator('main')).toContainText('NGUYEN HA AN');
  }
  await page.goto('/contact?lang=en');
  await ready(page);
  await expect(page.locator('a[href="mailto:contact@vfuturelabs.org"]').first()).toBeVisible();
  const response = await page.goto('/public-qa-route-does-not-exist?lang=en');
  await ready(page);
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'VFuture Academy', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/"], a[href="/?lang=en"]').first()).toBeVisible();
});

test('public content and native resource GET filters work without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 720 } });
  await isolatePublicContext(context);
  const page = await context.newPage();
  for (const path of ['/academy', ...catalogs.map((catalog) => `/${catalog}`)]) {
    await page.goto(`${baseURL}${path}?lang=en`);
    await ready(page);
    await expect(page.locator('h1')).toBeVisible();
    await noOverflow(page);
  }
  await page.locator('input[name="search"]').fill('native-qa-no-match');
  await page.locator('form').filter({ has: page.locator('input[name="search"]') }).locator('button[type="submit"], button:not([type])').click();
  await expect(page).toHaveURL(/search=native-qa-no-match/);
  expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
  await expect(page.locator('h1')).toBeVisible();
  await context.close();
});

test('public surfaces remain readable with reduced motion, text zoom and WCAG 2.2 checks', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const violations: Array<{ catalog: string; width: number; violations: unknown[] }> = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const catalog of [...catalogs, 'academy', 'contact', 'privacy', 'terms']) {
      await page.goto(`/${catalog}?lang=en`);
      await ready(page);
      await expect(page.locator('.pin-spacer')).toHaveCount(0);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await expect(page.locator('h1')).toBeVisible();
      await noOverflow(page);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      if (width === 1440) {
        await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
        await noOverflow(page);
        await expect(page.locator('h1')).toBeVisible();
        await page.evaluate(() => { document.documentElement.style.zoom = ''; });
      }
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      await testInfo.attach(`${catalog}-${width}-axe`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      if (results.violations.length) violations.push({ catalog, width, violations: results.violations });
    }
  }
  expect(violations).toEqual([]);
});

test('mobile sticky action avoids the original CTA, consent panel and footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/academy?lang=en');
  await ready(page);
  const sticky = page.locator('.public-sticky-action');
  await expect(sticky).not.toBeVisible();
  await page.locator('.academy-workflow').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-consent-open="true"]')).toBeVisible();
  await expect(sticky).not.toBeVisible();
  await page.getByRole('button', { name: 'Reject analytics', exact: true }).click();
  await expect(sticky).toBeVisible();
  await expect(sticky.getByRole('link')).toHaveAttribute('href', '/courses?lang=en');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(sticky).not.toBeVisible();
  await page.locator('#academy-primary-action').scrollIntoViewIfNeeded();
  await expect(sticky).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.academy-workflow').scrollIntoViewIfNeeded();
  await expect(sticky).not.toBeVisible();
});

test('keyboard users can skip shared navigation and operate resource filters', async ({ page }) => {
  await page.goto('/resources?lang=en');
  await ready(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.academy-shell-skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="search"]')).toBeFocused();
  await page.keyboard.type('keyboard-qa-no-match');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/search=keyboard-qa-no-match/);
  await expect(page.locator('[data-public-results-focus]')).toBeFocused();
});

// Keep SEO replacement separate so a metadata failure does not prevent the
// filter/history/clear workflow above from exercising all its transitions.
test('filtered navigation replaces the previous robots metadata with one noindex directive', async ({ page }) => {
  await page.goto('/resources?lang=en');
  await ready(page);
  await page.locator('input[name="search"]').fill('metadata-qa-no-match');
  await page.locator('form').filter({ has: page.locator('[name="search"]') }).locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/search=metadata-qa-no-match/);
  await expect(page.locator('[data-public-results-focus]')).toBeFocused();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.locator('main a').filter({ hasText: /clear|reset/i }).first().click();
  await expect(page).toHaveURL(/\/resources\?lang=en$/);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  expect(new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).search).toBe('?lang=en');
});
