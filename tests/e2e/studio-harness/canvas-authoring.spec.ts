import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';

for (const locale of ['en', 'vi'] as const) {
  test(`Canvas authoring defaults visual and preserves bilingual text across JSON in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: locale === 'vi' ? 390 : 1440, height: 900 });
    await page.addInitScript(() => localStorage.removeItem('academy.canvas.editor-mode'));
    await page.route('**/api/v1/studio/content/course/minimal/workflow', route => route.fulfill({ json: { data: { content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } } }));
    await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
      const body = route.request().postDataJSON();
      const result = await compileCourse(body, fixtureResolver, { locales: [body.locale] });
      await route.fulfill({ json: { data: { item: null, course: result.compiled ?? null, report: result.report } } });
    });
    await page.route('**/api/v1/studio/courses/minimal/draft/workspace', async route => {
      const snapshot = route.request().postDataJSON();
      await route.fulfill({ json: { data: { id: 'draft-minimal', courseId: 'minimal', ...snapshot, checklist: {}, updatedAt: '2026-09-06T00:00:01.000Z' } } });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/studio/courses/minimal?uiv2=1&lang=${locale}`);
    const visual = page.getByRole('tab', { name: locale === 'vi' ? 'Trực quan' : 'Visual', exact: true });
    await expect(visual).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('combobox', { name: locale === 'vi' ? 'Ngôn ngữ soạn thảo' : 'Editing language' }).click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    const title = page.getByRole('textbox', { name: locale === 'vi' ? 'Tiêu đề (EN)' : 'Title (EN)', exact: true }).first();
    await expect(title).toBeEnabled();
    await title.fill('Canvas bilingual title');
    const accessibility = await new AxeBuilder({ page }).include('#studio-editor').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('Canvas bilingual title');
    await expect(editor).toContainText('Khóa học tối giản');
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('{');
    const invalidText = await page.evaluate(() => window.__studioEditorSource?.() ?? '');
    await visual.click();
    await expect(page.getByText(locale === 'vi' ? /JSON của tài liệu chưa hợp lệ/ : /This document has invalid JSON/)).toBeVisible();
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__studioEditorSource?.())).toBe(invalidText);
    expect(errors).toEqual([]);
  });
}

test('a long visual course form remains wheel-scrollable while the header save action stays in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.removeItem('academy.canvas.editor-mode'));
  await page.goto('/studio/courses/minimal?uiv2=1&lang=en');
  const editor = page.locator('#workspace-editor');
  await expect(editor.locator('.studio-visual-editor')).toBeVisible();
  const pageScroll = await page.evaluate(() => scrollY);
  await editor.hover();
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => editor.evaluate(root => [root, ...root.querySelectorAll<HTMLElement>('*')].some(node => /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollTop > 100))).toBe(true);
  await expect(page.getByText('Identifiers and schema', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
});
