import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';

for (const locale of ['en', 'vi'] as const) {
  const messages = locale === 'en' ? en : vi;
  for (const width of [390, 768, 1440]) {
    test(`${locale} student surfaces remain usable at ${width}px`, async ({ page }, testInfo) => {
      await page.addInitScript((value) => sessionStorage.setItem('fixture-locale', value), locale);
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/app', '/app/courses', '/app/courses?tab=discover', '/app/courses/completed', '/app/explore']) {
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await expect(page.locator('#learner-main')).toHaveCSS('overflow-x', 'visible');
        await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '-').replaceAll('?', '-')}.png`), fullPage: true });
      }
      const resourceCard = page.getByRole('link').filter({ has: page.getByRole('heading', { name: messages.learner.focus.resources, exact: true }) });
      await expect(resourceCard).toBeVisible();
      await expect(resourceCard).toHaveAttribute('href', '/app/resources');
      await page.goto('/app/courses/completed');
      await expect(page.getByText(messages.learner.focus.courseInformation, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: messages.learner.course.review, exact: true })).toHaveAttribute('href', '/app/courses/completed/items/first');
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(axe.violations).toEqual([]);
    });
  }

  test(`${locale} outline is reachable before long content and closes on selection`, async ({ page }) => {
    await page.addInitScript((value) => sessionStorage.setItem('fixture-locale', value), locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/courses/active/items/first');
    const trigger = page.getByRole('button', { name: messages.learner.focus.outline, exact: true });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: /First lesson/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('link', { name: /Optional practice/ }).click();
    await expect(page).toHaveURL(/items\/optional$/);
    await expect(page.getByRole('heading', { name: 'Optional practice', exact: true })).toBeFocused();
    await expect(dialog).toHaveCount(0);
  });
}

test('mobile drawer keeps theme and closes at desktop breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 759, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/app');
  await page.getByRole('button', { name: en.common.menu, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const rootToken = await page.locator('#learner-main').evaluate((element) => getComputedStyle(element).getPropertyValue('--background'));
  expect(await dialog.evaluate((element) => getComputedStyle(element).getPropertyValue('--background'))).toBe(rootToken);
  const rootColor = await page.locator('#learner-main').evaluate((element) => getComputedStyle(element).color);
  await expect(dialog).toHaveCSS('color', rootColor);
  expect(await page.locator('[data-state="open"].fixed.inset-0').evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/0\.3/);
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked', /.+/);
  await page.getByRole('link', { name: en.learner.focus.courses, exact: true }).click();
  await expect(page).toHaveURL('/app/courses');
});

test('skip link focuses main and loading respects reduced motion', async ({ page }) => {
  await page.goto('/app');
  const skip = page.getByRole('link', { name: en.learner.skipToContent });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#learner-main')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/loading');
  const skeleton = page.getByRole('status').and(page.locator('.vf-l-skeleton'));
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  await expect(skeleton).toContainText(en.learner.focus.loading);
  // PageSkeleton is static: no shimmer, sweep or pulse on any part of it.
  expect(await skeleton.locator('*').evaluateAll((elements) => elements.length > 0 && elements.every((element) => getComputedStyle(element).animationName === 'none'))).toBe(true);
});

test('catalog navigation preserves filters, clear preserves tab and history restores controls', async ({ page }) => {
  await page.goto('/app/courses?tab=learning&language=en');
  const nav = page.getByRole('navigation', { name: en.learner.focus.courses, exact: true });
  await nav.getByRole('link', { name: en.learner.focus.discoverTab }).click();
  await expect(page).toHaveURL(/language=en.*tab=discover|tab=discover.*language=en/);
  const form = page.getByRole('form', { name: en.learner.catalog.filters });
  const language = form.getByRole('combobox', { name: en.learner.catalog.language, exact: true });
  await expect(language).toHaveValue('en');
  await form.getByRole('link', { name: en.learner.directory.clear, exact: true }).click();
  await expect(page).toHaveURL('/app/courses?tab=discover');
  await expect(language).toHaveValue('');
  await page.goBack();
  await expect(language).toHaveValue('en');
  await page.goForward();
  await expect(page).toHaveURL('/app/courses?tab=discover');
  await expect(language).toHaveValue('');
});

// C12 activity frame geometry, on the real item page (the student harness mounts a fixture FocusPage).
test('activity frame: a long title keeps the full width on a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/courses/active/items/long');
  const heading = page.locator('main h1');
  await expect(heading).toBeVisible();
  const title = await heading.boundingBox();
  const trigger = await page.getByRole('button', { name: en.learner.focus.outline, exact: true }).boundingBox();
  expect(title!.width).toBeGreaterThanOrEqual(300);
  // The outline trigger lives in the focus bar, never on the h1's row.
  expect(trigger!.y + trigger!.height <= title!.y || trigger!.y >= title!.y + title!.height).toBe(true);
  const bar = page.getByRole('navigation', { name: 'Activity', exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.locator('a[href="/app"]')).toHaveCount(0);
  await expect(page.locator('[aria-haspopup="dialog"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
});

test('activity frame: the pager keeps Previous before Next on screen and in the tab order at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/courses/active/items/optional');
  const pager = page.locator('.vf-activity-pager');
  const previous = pager.locator('a[data-dir="previous"]');
  const next = pager.locator('a[data-dir="next"]');
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  const [top, bottom] = [await previous.boundingBox(), await next.boundingBox()];
  expect(top!.y + top!.height).toBeLessThanOrEqual(bottom!.y);
  // Next keeps its signal emphasis without moving.
  expect(await next.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe('2px');
  await previous.focus();
  await page.keyboard.press('Tab');
  await expect(next).toBeFocused();
});

test('activity frame: head, body and footer share one left edge at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/courses/active/items/first');
  await expect(page.locator('main h1')).toBeVisible();
  const edges = await page.evaluate(() => ['.vf-activity-head', '.vf-activity-main', '[data-activity-footer]', '.vf-activity-pager']
    .map((selector) => Math.round(document.querySelector(selector)!.getBoundingClientRect().left)));
  expect(new Set(edges).size).toBe(1);
  const width = await page.locator('.vf-activity-head').evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(761);
});

test('activity frame: the exam aside sits beside the questions at 1440px and stacks at 1024px', async ({ page }) => {
  const geometry = async () => page.evaluate(() => {
    const main = document.querySelector('.vf-exam-split > [data-area="main"]')!.getBoundingClientRect();
    const aside = document.querySelector('.vf-exam-split > [data-area="aside"]')!.getBoundingClientRect();
    return { main: { left: main.left, right: main.right, width: main.width }, aside: { left: aside.left, width: aside.width } };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/courses/active/items/exam');
  await expect(page.getByRole('timer').first()).toBeVisible();
  const wide = await geometry();
  expect(wide.aside.left).toBeGreaterThanOrEqual(wide.main.right);
  expect(Math.round(wide.aside.width)).toBe(280);
  // An active attempt hides the pager; leaving goes through the exam guard.
  await expect(page.locator('.vf-activity-pager')).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 900 });
  const narrow = await geometry();
  expect(narrow.aside.left).toBeLessThan(narrow.main.left + narrow.main.width / 2);
});
