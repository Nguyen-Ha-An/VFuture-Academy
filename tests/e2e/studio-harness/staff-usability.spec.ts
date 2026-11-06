import { expect, test } from '@playwright/test';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';

for (const width of [390, 820, 1440, 1920]) {
  test(`review detail uses the viewport and returns queue context at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4174' }]);
    const queue = '/studio/reviews?uiv2=1&lang=en&scope=central&fixture=long&type=course';
    await page.goto(queue);
    const list = page.getByRole('region', { name: 'Review requests' });
    await expect(list).toBeVisible();
    if (width !== 820) await page.screenshot({ path: `/tmp/academy-task2-queue-${width}.png` });
    const listBox = await list.boundingBox();
    const mainBox = await page.locator('#studio-main').boundingBox();
    expect(listBox!.width).toBeGreaterThan(mainBox!.width - 60);
    await page.evaluate(() => scrollTo(0, 350));
    const scroll = await page.evaluate(() => scrollY);
    // The first real immutable review is selected without allowing Playwright to scroll it into view.
    await page.getByRole('link', { name: 'Read submitted version' }).first().evaluate(node => (node as HTMLAnchorElement).click());
    await expect(page).toHaveURL(/\/studio\/reviews\/fixture-review-1\?/);
    await expect(page.getByRole('link', { name: 'Back to review queue' })).toBeInViewport();
    await expect(page.locator('.canvas-global-nav')).toHaveCount(0);
    await expect(page.locator('.canvas-review-shell')).toHaveCSS('padding-left', '0px');
    await expect(page.getByRole('navigation', { name: 'Review content' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hello world', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Review content' }).getByRole('button').nth(1).click();
    if (width !== 820) await page.screenshot({ path: `/tmp/academy-task2-detail-${width}.png` });
    await expect(page.locator('[id^="review-item-"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Back to review queue' }).click();
    await expect(page).toHaveURL(queue);
    await expect(page.getByRole('combobox', { name: 'Content type' })).toHaveValue('course');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll);
  });

  test(`editor full screen preserves the pane and dirty draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route('**/api/v1/studio/content/course/minimal/workflow', route => route.fulfill({ json: { data: { content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } } }));
    await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
      const body = route.request().postDataJSON();
      const result = await compileCourse(body, fixtureResolver, { locales: [body.locale] });
      await route.fulfill({ json: { data: { item: null, course: result.compiled ?? null, report: result.report } } });
    });
    await page.goto('/studio/courses/minimal?uiv2=1&lang=en');
    await expect(page.locator('#studio-preview h3')).toHaveCount(1);
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const editor = page.locator('.cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    // An invalid dirty draft cannot autosave; expansion must preserve its exact source.
    await page.keyboard.insertText('{"unsaved":');
    if (width < 1280) await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Full screen preview' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview', exact: true });
    await expect(preview).toBeVisible();
    const box = await preview.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width, height: 800 });
    const courseBox = await preview.locator('.canvas-preview-course').boundingBox();
    expect(courseBox!.width).toBeGreaterThanOrEqual(width - 65);
    if (width !== 820) await page.screenshot({ path: `/tmp/academy-task2-preview-${width}.png` });
    await preview.locator('.vf-staff-preview-island').evaluate(node => { (node as HTMLElement).dataset.preserved = 'yes'; });
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    expect(await page.locator('#studio-preview .vf-staff-preview-island').getAttribute('data-preserved')).toBe('yes');
    if (width < 1280) await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(editor).toContainText('{"unsaved":');
    const editorBox = await page.locator('#workspace-editor').boundingBox();
    expect(editorBox!.height).toBeGreaterThan(200);
    expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(800);
  });
}

for (const width of [390, 1440, 1920]) test(`Studio overview uses available width at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/studio?uiv2=1&lang=en');
  await expect(page.locator('.canvas-studio-home')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Shortcuts' })).toHaveCount(0);
  await page.screenshot({ path: `/tmp/academy-task2-studio-overview-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('staff Courses tray restores focus to desktop trigger after mobile resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/v1/learning/courses?*', route => route.fulfill({ json: { data: { courses: [] } } }));
  await page.route('**/api/v1/teaching/assigned-courses?*', route => route.fulfill({ json: { data: { courses: [] } } }));
  await page.goto('/studio?uiv2=1&lang=en');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Courses', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Courses', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Courses', exact: true })).toBeHidden();
  await expect(page.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-courses-tray"]')).toBeFocused();
});

test('staff Courses tray yields focus to the destination heading after history Back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.route('**/api/v1/learning/courses?*', route => route.fulfill({ json: { data: { courses: [] } } }));
  await page.route('**/api/v1/teaching/assigned-courses?*', route => route.fulfill({ json: { data: { courses: [] } } }));
  await page.goto('/studio/courses?uiv2=1&lang=en');
  await page.evaluate(() => { history.pushState({}, '', '/studio?uiv2=1&lang=en'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.canvas-studio-home')).toBeVisible();
  await page.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-courses-tray"]').click();
  await expect(page.getByRole('dialog', { name: 'Courses', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/studio/courses?uiv2=1&lang=en');
  await expect(page.getByRole('dialog', { name: 'Courses', exact: true })).toBeHidden();
  await expect(page.locator('#studio-main h1[tabindex="-1"]')).toBeFocused();
  await expect(page.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-courses-tray"]')).not.toBeFocused();
});
