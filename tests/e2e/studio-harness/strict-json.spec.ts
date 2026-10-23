import { expect, test, type Page } from '@playwright/test';

import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';
import minimalManifest from '../../../src/content-engine/fixtures/minimal/course.json';

/**
 * Browser coverage for the strict-JSON and local-recovery behaviour: real
 * CodeMirror, real IndexedDB, real BroadcastChannel. Only the Studio HTTP API is
 * mocked — no database is touched.
 */

type Snapshot = { manifest: unknown; items: Record<string, unknown>; baseVersionId?: string | null };
type PreviewRequest = Snapshot & { selectedRef?: { kind: string; id?: string }; selectedDocId: string; locale: 'vi' | 'en' };

const RECOVERY_DB = 'vfuture-studio-recovery';
const SAVE_URL = '**/api/v1/studio/courses/minimal/draft/workspace';

function manifestWith(title: unknown) {
  const manifest = structuredClone(minimalManifest) as Record<string, unknown>;
  manifest.languages = ['vi', 'en'];
  manifest.defaultLanguage = 'vi';
  manifest.title = title;
  manifest.summary = { vi: 'Khóa học nhỏ nhất hợp lệ.', en: 'Smallest valid course.' };
  manifest.learningOutcomes = [{ vi: 'Mở một bài học.', en: 'Open a lesson.' }];
  return manifest;
}

async function mockApi(page: Page) {
  const previews: PreviewRequest[] = [];
  let saves = 0;
  await page.route('**/api/v1/studio/content/course/minimal/workflow', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
      content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null },
      activeReview: null, publication: null,
      actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true },
    } }) });
  });
  await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
    const body = route.request().postDataJSON() as PreviewRequest;
    previews.push(body);
    // The server resolves the document from the authoritative reference, which is
    // the only way an item named `manifest` can be told from the course itself.
    const ref = body.selectedRef ?? (body.selectedDocId === 'manifest' ? { kind: 'course' } : { kind: 'item', id: body.selectedDocId });
    const result = await compileCourse({ manifest: body.manifest as never, items: body.items as never }, fixtureResolver, { locales: [body.locale] });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        item: ref.kind === 'item' ? result.compiled?.items[ref.id!] ?? null : null,
        course: ref.kind === 'course' ? result.compiled ?? null : null,
        report: result.report,
      } }),
    });
  });
  await page.route(SAVE_URL, async route => {
    saves += 1;
    const body = route.request().postDataJSON() as Snapshot;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: 'draft-minimal', courseId: 'minimal', ...body, checklist: {}, updatedAt: `2026-09-06T00:00:0${saves}.000Z` } }) });
  });
  await page.route('**/api/v1/studio/courses/minimal/draft', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: 'draft-minimal', courseId: 'minimal', manifest: manifestWith({ vi: 'Khóa học tối giản', en: 'Minimal course' }), items: {}, baseVersionId: null, checklist: {}, updatedAt: '2026-09-06T00:00:00.000Z' } }) });
  });
  return { previews, saves: () => saves };
}

async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/studio/courses/minimal${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  return errors;
}

async function replaceEditor(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(text);
  await expect.poll(() => editorText(page)).toContain(text.slice(0, 24));
}

const editorText = (page: Page) => page.evaluate(() => (document.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '');

/**
 * Every recovery record the browser actually wrote, read straight out of IndexedDB.
 * The database is never created here — an un-versioned open would make an empty one
 * and mask the very writes this is checking.
 */
const recoveryRecords = (page: Page) => page.evaluate(async (dbName: string) => {
  const existing = await indexedDB.databases();
  const found = existing.find(entry => entry.name === dbName);
  if (!found) return [];
  const open = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, found.version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
  try {
    if (!open.objectStoreNames.contains('drafts')) return [];
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = open.transaction('drafts', 'readonly').objectStore('drafts').getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    return rows as { key: string; tabId: string; accountId: string; courseId: string; sources: Record<string, string> }[];
  } finally { open.close(); }
}, RECOVERY_DB);

// A course manifest with `title` written twice. `JSON.parse` keeps only the last
// one, so nothing downstream may accept, reformat or save this text.
const DUPLICATE_TITLE_MANIFEST = JSON.stringify(manifestWith({ vi: 'A', en: 'A' }), null, 2)
  .replace('"kind": "course"', '"title": "Duplicated first",\n  "kind": "course"');

test.describe('strict JSON in the browser', () => {
  test('rejects a duplicate key, keeps the exact bytes through Format, and blocks the save', async ({ page }) => {
    const api = await mockApi(page);
    const errors = await open(page);
    await replaceEditor(page, DUPLICATE_TITLE_MANIFEST);

    await page.locator('#studio-json summary').click();
    await expect(page.locator('#studio-json li', { hasText: /khai báo|declared/i }).first()).toBeVisible();

    // Format must not reinterpret rejected text.
    const before = await editorText(page);
    await page.getByRole('button', { name: /Định dạng|Format/ }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await editorText(page)).toBe(before);

    // And the save is refused locally: nothing reaches the server.
    await page.getByRole('button', { name: /Lưu nháp|Save draft/, exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(api.saves()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('rejects an overflowing number and a code-fenced document', async ({ page }) => {
    const api = await mockApi(page);
    await open(page);

    await replaceEditor(page, JSON.stringify(manifestWith('x'), null, 2).replace('"schemaVersion": 1', '"schemaVersion": 1e999'));
    await page.getByRole('button', { name: /Lưu nháp|Save draft/, exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();

    await replaceEditor(page, '```json\n{ "kind": "course" }\n```');
    await page.getByRole('button', { name: /Lưu nháp|Save draft/, exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();

    expect(api.saves()).toBe(0);
  });

  test('jumps to a diagnostic without needing Buffer in the browser', async ({ page }) => {
    await mockApi(page);
    const errors = await open(page);
    await replaceEditor(page, JSON.stringify({ ...manifestWith('x'), modules: 'not-a-list' }, null, 2));

    await page.locator('#studio-json summary').click();
    const first = page.locator('#studio-json li button').first();
    await expect(first).toBeVisible();
    await first.click();

    await expect(page.locator('.cm-content')).toBeVisible();
    expect(errors.filter(message => /Buffer|is not defined/.test(message))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('local recovery in the browser', () => {
  test('writes invalid text to IndexedDB and restores the exact bytes after a reload', async ({ page }) => {
    await mockApi(page);
    await open(page);

    const halfTyped = '{\n  "kind": "course",\n  "id": "minimal",\n  "title": "Half typed';
    await replaceEditor(page, halfTyped);

    // A real IndexedDB write, after the debounce.
    await expect.poll(async () => (await recoveryRecords(page)).length, { timeout: 5_000 }).toBe(1);
    const [stored] = await recoveryRecords(page);
    expect(stored.sources.course).toBe(halfTyped);
    expect(stored.accountId).toBe('browser-author');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The server draft loaded; the stored text is only offered.
    expect(await editorText(page)).not.toBe(halfTyped);
    await expect(page.getByRole('button', { name: /Phục hồi nội dung|Restore edits/ })).toBeVisible();

    await page.getByRole('button', { name: /Phục hồi nội dung|Restore edits/ }).click();
    await expect.poll(() => editorText(page)).toBe(halfTyped);
  });

  test('discarding removes the stored record', async ({ page }) => {
    await mockApi(page);
    await open(page);
    await replaceEditor(page, '{ "kind": "course", "id": "minimal"');
    await expect.poll(async () => (await recoveryRecords(page)).length, { timeout: 5_000 }).toBe(1);

    await page.reload();
    await page.getByRole('button', { name: /Xóa nội dung đã lưu trên máy|Delete stored edits/ }).click();

    await expect.poll(async () => (await recoveryRecords(page)).length).toBe(0);
  });

  test('two live tabs on the same course keep distinct recovery writers', async ({ page, context }) => {
    await mockApi(page);
    await open(page);
    await replaceEditor(page, '{ "kind": "course", "id": "minimal", "from": "first tab"');
    await expect.poll(async () => (await recoveryRecords(page)).length, { timeout: 5_000 }).toBe(1);
    const [first] = await recoveryRecords(page);

    // A second tab in the same browser context: same origin, same storage.
    const second = await context.newPage();
    await mockApi(second);
    await open(second);
    await replaceEditor(second, '{ "kind": "course", "id": "minimal", "from": "second tab"');
    await expect.poll(async () => (await recoveryRecords(second)).length, { timeout: 5_000 }).toBe(2);

    const records = await recoveryRecords(second);
    expect(new Set(records.map(record => record.tabId)).size).toBe(2);
    expect(records.find(record => record.tabId === first.tabId)?.sources.course).toContain('first tab');
    expect(records.find(record => record.tabId !== first.tabId)?.sources.course).toContain('second tab');
    await second.close();
  });

  test('keeps text typed while a save is in flight recoverable', async ({ page }) => {
    await mockApi(page);
    let release: (() => void) | null = null;
    let saves = 0;
    await page.unroute(SAVE_URL);
    await page.route(SAVE_URL, async route => {
      const body = route.request().postDataJSON() as Snapshot;
      saves += 1;
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: 'draft-minimal', courseId: 'minimal', ...body, checklist: {}, updatedAt: '2026-09-06T00:00:01.000Z' } }) });
    });
    await open(page);

    await replaceEditor(page, JSON.stringify(manifestWith({ vi: 'Đã lưu', en: 'Saved title' }), null, 2));
    await expect.poll(async () => (await recoveryRecords(page)).length, { timeout: 5_000 }).toBe(1);

    await page.getByRole('button', { name: /Lưu nháp|Save draft/, exact: true }).click();
    await expect.poll(() => release !== null, { timeout: 5_000 }).toBe(true);

    // Typed while the request is outstanding.
    const newer = JSON.stringify(manifestWith({ vi: 'Mới hơn', en: 'Newer title' }), null, 2);
    await replaceEditor(page, newer);
    await expect.poll(async () => (await recoveryRecords(page))[0]?.sources.course, { timeout: 5_000 }).toContain('Newer title');

    release!();
    await expect.poll(() => saves).toBe(1);

    // The acknowledgement matched only the older snapshot, so the newer text stays.
    await expect.poll(async () => (await recoveryRecords(page))[0]?.sources.course, { timeout: 5_000 }).toContain('Newer title');
  });
});

test.describe('an item whose id is literally `manifest`', () => {
  test('is a different document from the course, on screen and on the wire', async ({ page }) => {
    const api = await mockApi(page);
    const errors = await open(page, '?itemnamedmanifest=1&lang=en');

    await page.getByRole('button', { name: /Item named manifest/ }).click();

    await expect.poll(() => api.previews.at(-1)?.selectedRef, { timeout: 20_000 })
      .toEqual({ kind: 'item', id: 'manifest' });
    // The item's own body renders, not the course overview.
    await expect(page.locator('#studio-preview')).not.toContainText('Course overview');

    // Editing it touches only its own source.
    const body = await editorText(page);
    expect(body).toContain('"id": "manifest"');
    expect(body).toContain('"kind": "lesson"');

    await page.getByRole('button', { name: 'Course manifest' }).click();
    await expect.poll(() => api.previews.at(-1)?.selectedRef, { timeout: 20_000 }).toEqual({ kind: 'course' });
    expect(await editorText(page)).toContain('"kind": "course"');
    expect(errors).toEqual([]);
  });

  test('saves both documents without one overwriting the other', async ({ page }) => {
    const api = await mockApi(page);
    let submitted: Snapshot | null = null;
    await page.unroute(SAVE_URL);
    await page.route(SAVE_URL, async route => {
      submitted = route.request().postDataJSON() as Snapshot;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: 'draft-minimal', courseId: 'minimal', ...submitted, checklist: {}, updatedAt: '2026-09-06T00:00:01.000Z' } }) });
    });
    await open(page, '?itemnamedmanifest=1&lang=en');

    await page.getByRole('button', { name: /Item named manifest/ }).click();
    const current = await editorText(page);
    await replaceEditor(page, current.replace('"Item named manifest"', '"Edited item"'));

    await page.getByRole('button', { name: /Save draft/, exact: true }).click();
    await expect.poll(() => submitted !== null, { timeout: 10_000 }).toBe(true);

    expect((submitted as unknown as Snapshot).items.manifest).toMatchObject({ id: 'manifest', kind: 'lesson' });
    expect((submitted as unknown as Snapshot).manifest).toMatchObject({ kind: 'course', id: 'minimal' });
    expect(api.previews.length).toBeGreaterThan(0);
  });
});
