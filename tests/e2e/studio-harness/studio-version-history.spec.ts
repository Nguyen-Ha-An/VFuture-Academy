import { expect, test } from '@playwright/test';
import messages from '../../../src/messages/en.json';
import manifest from '../../../src/content-engine/fixtures/minimal/course.json';
import lesson from '../../../src/content-engine/fixtures/minimal/items/intro.json';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';

for (const readOnly of [false, true]) test(`published versions ${readOnly ? 'remain downloadable for a reader without restore' : 'restore through the canonical Workspace snapshot'}`, async ({ page }) => {
  const version = 3;
  const versionId = '00000000-0000-4000-8000-000000000003';
  const restored = { manifest: { ...manifest, title: 'Restored course' }, items: { intro: lesson }, baseVersionId: versionId };
  // Published legacy inline documents normalize to item storage; their bodies must survive intact.
  const canonical = {
    manifest: { ...restored.manifest, modules: [{ ...manifest.modules[0], items: [
      { type: 'lesson', id: 'intro' }, { type: 'assignment', id: 'hello', title: 'Say hello' },
    ] }] },
    items: { intro: lesson, hello: {
      schemaVersion: 1, kind: 'assignment', id: 'hello', title: 'Say hello',
      instructions: manifest.modules[0]!.items[1]!.instructions,
      submission: manifest.modules[0]!.items[1]!.submission,
    } },
    baseVersionId: versionId,
  };
  let reads = 0;
  let saved: unknown = null;
  await page.route('**/api/v1/studio/content/course/minimal/workflow', route => route.fulfill({ json: { data: {
    content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null },
    activeReview: null, publication: null,
    actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true },
  } } }));
  await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
    const body = route.request().postDataJSON();
    const result = await compileCourse({ manifest: body.manifest, items: body.items }, fixtureResolver, { locales: [body.locale] });
    await route.fulfill({ json: { data: { course: result.compiled, item: null, report: result.report } } });
  });
  await page.route('**/api/v1/studio/courses/minimal/draft/workspace', async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { data: { id: 'draft-minimal', courseId: 'minimal', ...(saved as typeof restored), checklist: {}, updatedAt: '2026-11-05T00:00:00.000Z' } } });
  });
  await page.route('**/api/v1/studio/courses/minimal/versions', route => route.fulfill({ json: { data: [{ id: versionId, version, published_at: '2026-11-01T00:00:00Z', notes: 'Reviewed course release.' }] } }));
  await page.route('**/api/v1/studio/courses/minimal/versions/3', route => {
    reads += 1;
    return route.fulfill({ json: { data: restored } });
  });
  await page.goto(`/studio/courses/minimal?uiv2=1&lang=en${readOnly ? '&readonly=1' : ''}`);
  if (!readOnly) {
    // The manifest also contains module titles; identify the actual course field by its source value.
    const courseTitle = page.getByRole('textbox', { name: 'Title (VI)', exact: true }).and(page.locator('input[value="Khóa học tối giản"]'));
    await expect(courseTitle).toHaveCount(1);
    await expect(courseTitle).toBeEnabled();
  }
  await page.getByRole('button', { name: messages.studioWorkspace.more, exact: true }).click();
  await page.getByRole('button', { name: messages.workspace.versions.trigger, exact: true }).click();
  const history = page.getByRole('dialog', { name: messages.workspace.versions.title, exact: true });
  await expect(history.getByRole('heading', { name: 'Version 3', exact: true })).toBeVisible();
  await expect(history.getByRole('link', { name: messages.workspace.versions.exportBundle })).toHaveAttribute('href', '/api/v1/studio/courses/minimal/export?version=3&format=bundle');
  await expect(history.getByRole('link', { name: messages.workspace.versions.exportSingle })).toHaveAttribute('href', '/api/v1/studio/courses/minimal/export?version=3&format=single');
  if (readOnly) {
    await expect(history.getByRole('button', { name: messages.workspace.versions.restore, exact: true })).toHaveCount(0);
    expect(reads).toBe(0);
  } else {
    page.once('dialog', dialog => dialog.accept());
    await history.getByRole('button', { name: messages.workspace.versions.restore, exact: true }).click();
    await expect(history).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Restored course' })).toBeVisible();
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('Restored course');
    expect(await page.evaluate(() => JSON.parse(window.__studioEditorSource!()))).toEqual(canonical.manifest);
    await expect.poll(() => saved).toEqual(canonical);
    expect((saved as typeof canonical).items.hello.instructions).toEqual(manifest.modules[0]!.items[1]!.instructions);
    expect((saved as typeof canonical).items.hello.submission).toEqual(manifest.modules[0]!.items[1]!.submission);
    expect(reads).toBe(1);
  }
});
