import { expect, test, type Page } from '@playwright/test';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';
import minimalManifest from '../../../src/content-engine/fixtures/minimal/course.json';

type Snapshot = { manifest: unknown; items: Record<string, unknown>; baseVersionId?: string | null };

async function preview(snapshot: Snapshot, selectedDocId: string, locale: 'vi' | 'en') {
  const result = await compileCourse({ manifest: snapshot.manifest as never, items: snapshot.items as never }, fixtureResolver, { locales: [locale] });
  return {
    item: selectedDocId === 'manifest' ? null : result.compiled?.items[selectedDocId] ?? null,
    course: selectedDocId === 'manifest' ? result.compiled ?? null : null,
    report: result.report,
  };
}

async function mockStudioApi(page: Page) {
  let saves = 0;
  let latest: Snapshot | null = null;
  await page.route('**/api/v1/studio/content/course/minimal/workflow', async route => {
    const pending = new URL(page.url()).searchParams.get('workflow') === 'pending';
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
      content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null },
      activeReview: pending ? { id: 'review-1', status: 'pending', revisionKey: '2026-09-06T00:00:00.000Z', note: null } : null,
      publication: null,
      actions: { requestReview: !pending, withdrawReview: pending, approveAndPublish: false, mutate: !pending },
    } }) });
  });
  await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
    const body = route.request().postDataJSON() as Snapshot & { selectedDocId: string; locale: 'vi' | 'en' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: await preview(body, body.selectedDocId, body.locale) }) });
  });
  await page.route('**/api/v1/studio/courses/minimal/draft/workspace', async route => {
    saves += 1;
    latest = route.request().postDataJSON() as Snapshot;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: 'draft-minimal', courseId: 'minimal', ...latest, checklist: {}, updatedAt: `2026-09-06T00:00:0${saves}.000Z` } }) });
  });
  return { saves: () => saves, latest: () => latest };
}

async function open(page: Page, query = '') {
  await page.goto(`/studio/courses/minimal${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (!query.includes('readonly=1') && !query.includes('workflow=pending')) {
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  }
  if ((page.viewportSize()?.width ?? 1280) >= 1280) await expect(page.locator('#studio-preview h3')).toBeVisible({ timeout: 20_000 });
}

function manifestWith(title: unknown) {
  const manifest = structuredClone(minimalManifest) as Record<string, unknown>;
  manifest.languages = ['vi', 'en']; manifest.defaultLanguage = 'vi';
  manifest.title = title;
  manifest.summary = { vi: 'Khóa học nhỏ nhất hợp lệ.', en: 'Smallest valid course.' };
  manifest.learningOutcomes = [{ vi: 'Mở một bài học.', en: 'Open a lesson.' }];
  return manifest;
}

async function replaceManifest(page: Page, value: unknown) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(JSON.stringify(value, null, 2));
}

test.describe('Studio browser harness', () => {
  for (const viewport of [{ width: 1440, height: 650 }, { width: 390, height: 844 }]) {
    test(`JSON scrolls inside its pane with errors open at ${viewport.width}px`, async ({ page }) => {
      await mockStudioApi(page);
      await page.setViewportSize(viewport);
      await open(page);
      await replaceManifest(page, { ...manifestWith('Scroll test'), unexpected: Array.from({ length: 180 }, (_, i) => `line-${i}`) });
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await page.locator('#studio-json summary').click();
      const scroller = page.locator('.cm-scroller');
      await scroller.evaluate(node => { node.scrollTop = 0; });
      await scroller.hover();
      const pageScroll = await page.evaluate(() => window.scrollY);
      const bounds = await scroller.boundingBox();
      expect(bounds?.height).toBeGreaterThan(60);
      expect(bounds?.height).toBeLessThan(viewport.height);
      await page.mouse.wheel(0, 450);
      await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScroll);
      if (viewport.width >= 1280) {
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 1);
      }
    });
  }

  test('desktop keeps the real workspace in three columns without horizontal overflow', async ({ page }, testInfo) => {
    await mockStudioApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const panes = page.locator('#studio-json').locator('..');
    await expect(panes).toHaveCSS('display', 'grid');
    await expect(panes).toHaveCSS('grid-template-columns', /240px/);
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
  });

  test('a CodeMirror edit updates preview without saving, then saves one full snapshot', async ({ page }) => {
    const api = await mockStudioApi(page);
    await open(page);
    const changed = manifestWith({ vi: 'Khóa học đã sửa', en: 'Changed course' });
    await replaceManifest(page, changed);
    await expect(page.getByRole('heading', { name: 'Khóa học đã sửa' })).toBeVisible({ timeout: 8_000 });
    expect(api.saves()).toBe(0);
    await page.getByRole('button', { name: 'Lưu nháp' }).click();
    await expect(page.getByText('Đã lưu')).toBeVisible();
    expect(api.saves()).toBe(1);
    expect(api.latest()).toMatchObject({ manifest: { title: { vi: 'Khóa học đã sửa' } }, items: { intro: { id: 'intro' } }, baseVersionId: null });
  });

  test('autosaves 1500ms after a valid edit and exposes timing marks', async ({ page }) => {
    const api = await mockStudioApi(page);
    await open(page);
    const started = Date.now();
    await replaceManifest(page, manifestWith({ vi: 'Tự động lưu', en: 'Autosaved course' }));

    await expect.poll(api.saves, { timeout: 5_000 }).toBe(1);

    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    await expect(page.getByRole('status').first()).toContainText(/Đã lưu.*\d{2}:\d{2}:\d{2}/);
    const metrics = await page.evaluate(() => performance.getEntriesByType('measure').map(entry => entry.name));
    expect(metrics).toContain('studio.workspace.save.prepare');
    expect(metrics).toContain('studio.workspace.save.request');
  });

  test('keeps the editor and save action locked while review is pending', async ({ page }) => {
    await mockStudioApi(page);
    await open(page, '?workflow=pending&lang=en');

    await expect(page.getByText(/Pending review/)).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  test('keeps a large-source edit responsive while analysis runs in the worker', async ({ page }) => {
    await mockStudioApi(page);
    await page.goto('/studio/courses/minimal?lang=en&large=1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
    // Wait for the initial worker result, then position the cursor before starting
    // Event Timing. Click and Ctrl/Meta+End are setup interactions over a 120 KB
    // CodeMirror document; including them does not measure the edit handler.
    await expect.poll(async () => (await page.locator('#studio-json summary').textContent())?.startsWith('0 errors')).toBe(false);
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => {
      const entries: Array<{ name: string; duration: number }> = [];
      const capture = { entries, inputCount: 0, frameMs: null as number | null, supported: PerformanceObserver.supportedEntryTypes.includes('event') };
      (window as unknown as { studioInputCapture: typeof capture }).studioInputCapture = capture;
      const startedAt = performance.now();
      document.querySelector('.cm-content')!.addEventListener('beforeinput', () => {
        const inputStartedAt = performance.now();
        requestAnimationFrame(() => { capture.frameMs = performance.now() - inputStartedAt; });
      }, { once: true, capture: true });
      document.querySelector('.cm-content')!.addEventListener('input', () => { capture.inputCount += 1; }, { once: true });
      // Event Timing can deliver unrelated keyboard/pointer entries after setup.
      // Measure only this edit, not cursor positioning or browser hover events.
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= startedAt && (entry.name === 'beforeinput' || entry.name === 'input')) {
            entries.push({ name: entry.name, duration: entry.duration });
          }
        }
      });
      observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    });
    await page.keyboard.insertText(' ');
    await page.waitForTimeout(500);

    const evidence = await page.evaluate(() => {
      const capture = (window as unknown as { studioInputCapture: { entries: Array<{ name: string; duration: number }>; inputCount: number; frameMs: number | null; supported: boolean } }).studioInputCapture;
      const inputEvents = capture.entries;
      return {
        inputEvents,
        inputCount: capture.inputCount,
        inputToFrameMs: capture.frameMs,
        eventTimingSupported: capture.supported,
        maxInputDuration: Math.max(0, ...inputEvents.map(entry => entry.duration)),
        workerLoaded: performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/studio-workers/workspace-analysis.js')),
        mainThreadFallbacks: performance.getEntriesByName('studio.workspace.analysis').length,
      };
    });
    expect(evidence.workerLoaded).toBe(true);
    expect(evidence.mainThreadFallbacks).toBe(0);
    expect(evidence.eventTimingSupported).toBe(true);
    expect(evidence.inputCount).toBe(1);
    expect(evidence.inputToFrameMs).not.toBeNull();
    expect(evidence.inputToFrameMs).toBeLessThanOrEqual(100);
    // No reported entry means the input remained below Event Timing's 16 ms floor.
    expect(evidence.maxInputDuration).toBeLessThanOrEqual(100);
    const workerScript = await page.request.get('/studio-workers/workspace-analysis.js');
    expect(workerScript.ok()).toBe(true);
    expect(workerScript.headers()['content-type']).toContain('javascript');
    const source = await workerScript.text();
    expect(source).not.toMatch(/\bimport\s+type\b|\bas\s+unknown\s+as\b/);
  });

  test('invalid JSON retains the last preview and does not send a preview request', async ({ page }) => {
    await mockStudioApi(page);
    await open(page);
    await replaceManifest(page, '{');
    await expect(page.getByText('Đang hiển thị bản hợp lệ trước đó.')).toBeVisible();
    await expect(page.getByText('Sửa lỗi JSON để xem trước nội dung.')).toHaveCount(0);
  });

  test('mobile exposes pane tabs and both navigation drawers', async ({ page }) => {
    await mockStudioApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole('tab', { name: 'Xem trước' }).click();
    await expect(page.locator('#studio-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Nội dung khóa học' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('internal links offer Stay, Discard, and Save for unsaved work', async ({ page }) => {
    const api = await mockStudioApi(page);
    await open(page);
    await replaceManifest(page, manifestWith('Edited title'));
    const courses = page.locator('a[href="/studio/courses"]:visible').first();
    await courses.click();
    await expect(page.getByRole('dialog', { name: 'Bạn có thay đổi chưa lưu' })).toBeVisible();
    await page.getByRole('button', { name: 'Ở lại' }).click();
    await expect(page).toHaveURL(/\/studio\/courses\/minimal/);
    await courses.click();
    await page.getByRole('button', { name: 'Lưu nháp' }).last().click();
    await expect.poll(api.saves).toBe(1);
    await expect(page).toHaveURL(/\/studio\/courses$/);
  });

  test('browser Back and Forward are guarded while dirty', async ({ page }) => {
    await mockStudioApi(page);
    await open(page);
    await page.evaluate(() => history.pushState({}, '', '/studio/courses/minimal?step=1'));
    await replaceManifest(page, manifestWith('Dirty history'));
    await expect(page.getByRole('button', { name: 'Lưu nháp' })).toBeEnabled();
    await page.evaluate(() => history.back());
    await expect(page.getByRole('dialog', { name: 'Bạn có thay đổi chưa lưu' })).toBeVisible();
    await page.getByRole('button', { name: 'Ở lại' }).click();
    await expect(page).toHaveURL(/\/studio\/courses\/minimal\?step=1$/);
    await page.evaluate(() => history.back());
    await expect(page.getByRole('dialog', { name: 'Bạn có thay đổi chưa lưu' })).toBeVisible();
    await page.getByRole('button', { name: 'Bỏ thay đổi' }).click();
    await expect(page).toHaveURL(/\/studio\/courses\/minimal$/);
    await page.evaluate(() => history.forward());
    await expect(page.getByRole('dialog', { name: 'Bạn có thay đổi chưa lưu' })).toBeVisible();
    await page.getByRole('button', { name: 'Bỏ thay đổi' }).click();
    await expect(page).toHaveURL(/\/studio\/courses\/minimal\?step=1$/);
  });

  test('read-only workspace never writes', async ({ page }) => {
    let writes = 0;
    await mockStudioApi(page);
    await page.route('**/api/v1/studio/courses/minimal/draft/workspace', route => { writes += 1; return route.abort(); });
    await open(page, '?readonly=1');
    await expect(page.getByText('Chỉ xem')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu nháp' })).toHaveCount(0);
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    expect(writes).toBe(0);
  });

  test('English locale renders and previews English content', async ({ page }) => {
    await mockStudioApi(page);
    await open(page, '?lang=en');
    await expect(page.getByRole('heading', { name: 'Minimal course' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  });
});
