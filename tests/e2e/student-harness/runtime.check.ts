import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';
import { BLOCK, COURSE, ITEM, START, OUTLINE_DESTINATION, FIRST_DESTINATION, SECOND_DESTINATION, RESPONSE } from './src/runtime-fixture-data';

const origin = 'http://127.0.0.1:4180';
type Write = { path: string; method: string; body: unknown; status: number };
type NavigationWindow = Window & { runtimeCommits: string[] };

async function installBackend(page: Page) {
 const writes: Write[] = [];
 const unexpected: string[] = [];
 const errors: string[] = [];
 const releases: Array<() => void> = [];
 let status = 503;
 let hold = false;
 let heldCount = 0;
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => {
  const observed = window as unknown as NavigationWindow;
  observed.runtimeCommits = [];
  const push = history.pushState.bind(history);
  history.pushState = (data, unused, url) => {
   observed.runtimeCommits.push(new URL(String(url), location.href).href);
   return push(data, unused, url);
  };
 });
 await page.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) { unexpected.push(`external ${request.method()} ${url.href}`); return route.abort('blockedbyclient'); }
  if (!url.pathname.startsWith('/api/')) {
   if (request.method() !== 'GET') { unexpected.push(`non-API write ${request.method()} ${url.pathname}`); return route.fulfill({ status: 501, body: 'Unconfigured write' }); }
   return route.continue();
  }
  const isBlock = url.pathname === `/api/v1/progress/blocks/${BLOCK}` && request.method() === 'PUT';
  const isViewed = url.pathname === '/api/v1/progress/viewed' && request.method() === 'POST';
  if (!isBlock && !isViewed) {
   unexpected.push(`${request.method()} ${url.pathname}`);
   return route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNCONFIGURED', message: 'Unexpected fixture request' } }) });
  }
  const responseStatus = isBlock ? status : 200;
  writes.push({ path: url.pathname, method: request.method(), body: request.postDataJSON(), status: responseStatus });
  if (isBlock && hold) {
   heldCount++;
   await new Promise<void>(resolve => releases.push(resolve));
  }
  await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(responseStatus === 200 ? { data: {} } : { error: { code: 'FIXTURE_UNAVAILABLE', message: 'Progress storage temporarily unavailable' } }) });
 });
 return {
  writes, unexpected, errors,
  configure(nextStatus: number, shouldHold = false) { status = nextStatus; hold = shouldHold; },
  held: () => heldCount,
  release() { hold = false; releases.splice(0).forEach(resolve => resolve()); },
 };
}
type Backend = Awaited<ReturnType<typeof installBackend>>;

async function evidence(page: Page, info: TestInfo, name: string) {
 await page.evaluate(() => document.fonts.ready);
 const path = info.outputPath(`${name}.png`);
 await page.screenshot({ path, fullPage: true });
 await info.attach(name, { path, contentType: 'image/png' });
 await info.attach(`${name}-state`, { body: JSON.stringify(await page.evaluate(() => ({
  url: location.href, active: document.activeElement?.outerHTML,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  fontFamily: getComputedStyle(document.body).fontFamily,
  loadedFonts: Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })),
  commits: (window as unknown as NavigationWindow).runtimeCommits,
 })), null, 2), contentType: 'application/json' });
}
async function audit(page: Page, info: TestInfo) {
 const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
 await info.attach('leave-dialog-axe', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
 expect.soft(result.violations).toEqual([]);
}
async function commits(page: Page) { return page.evaluate(() => (window as unknown as NavigationWindow).runtimeCommits); }
async function confirmDestination(page: Page, href: string) {
 await expect(page).toHaveURL(origin + href);
 await expect(page.locator('#runtime-destination')).toHaveText(href);
 await expect(page.getByRole('heading', { name: 'Destination fixture' })).toBeVisible();
 await expect(page.locator('textarea')).toHaveCount(0);
 expect(await commits(page)).toEqual([origin + href]);
}

for (const scenario of [{ locale: 'en', theme: 'dark' }, { locale: 'vi', theme: 'light' }] as const) {
 test.describe(`runtime ${scenario.locale} ${scenario.theme}`, () => {
  const messages = scenario.locale === 'en' ? en : vi;
  const labels = messages.learner.item;
  const outlineLabel = messages.learner.focus.outline;
  let backend: Backend;

  test.beforeEach(async ({ page }) => {
   backend = await installBackend(page);
   await page.setViewportSize({ width: 390, height: 900 });
   await page.clock.setFixedTime('2026-09-09T00:00:00Z');
   await page.emulateMedia({ colorScheme: scenario.theme, reducedMotion: 'reduce' });
   await page.goto(`/runtime.html?lang=${scenario.locale}`);
   expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
   expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scenario.theme === 'dark');
   await expect(page.locator('textarea')).toBeVisible();
  });
  test.afterEach(async ({}, info) => {
   if (!backend) return; // Browser setup failed before any fixture request existed.
   backend.release();
   await info.attach('backend-ledger', { body: JSON.stringify({ writes: backend.writes, unexpected: backend.unexpected, errors: backend.errors }, null, 2), contentType: 'application/json' });
   expect.soft(backend.unexpected, 'No unconfigured requests may escape fixture boundaries').toEqual([]);
   expect.soft(backend.errors, 'No browser module/render exceptions').toEqual([]);
  });

  async function dirty(page: Page) {
   await page.locator('textarea').fill(RESPONSE);
   // Reflection Save queues the real 800ms debounced runtime write; typing alone does not.
   await page.getByRole('button', { name: scenario.locale === 'en' ? 'Save' : 'Lưu', exact: true }).click();
   await expect.poll(() => backend.writes.filter(write => write.path.endsWith(`/${BLOCK}`) && write.status === 503).length).toBeGreaterThan(0);
   await expect(page.getByRole('alert').filter({ hasText: labels.saveError })).toBeVisible();
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
  }
  async function leaveThroughOutline(page: Page, info: TestInfo) {
   const trigger = page.getByRole('button', { name: outlineLabel, exact: true });
   await trigger.click();
   const outline = page.getByRole('dialog', { name: outlineLabel, exact: true });
   await expect(outline).toBeVisible();
   await evidence(page, info, 'before-outline-navigation');
   await outline.locator(`a[href="${OUTLINE_DESTINATION}"]`).click();
   await expect(outline).toHaveCount(0);
   const dialog = page.getByRole('dialog', { name: labels.leaveTitle, exact: true });
   await expect(dialog).toBeVisible();
   await expect(page.getByRole('dialog')).toHaveCount(1);
   await expect(dialog).toHaveAccessibleDescription(labels.leaveSaveFailed);
   expect(await commits(page)).toEqual([]);
   await expect(page).toHaveURL(`${origin}${START}?lang=${scenario.locale}`);
   await evidence(page, info, 'after-outline-closed-leave-dialog');
   return { dialog, trigger };
  }

  test('failed debounced save and flush closes outline; accessible Stay and Escape restore trigger', async ({ page }, info) => {
   await dirty(page);
   const { dialog, trigger } = await leaveThroughOutline(page, info);
   await audit(page, info);
   for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'focus stays in the sole leave dialog').toBe(true);
   }
   await dialog.getByRole('button', { name: labels.stayOnItem, exact: true }).click();
   await expect(dialog).toHaveCount(0);
   await expect(trigger).toBeFocused();
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
   expect(await commits(page)).toEqual([]);
   await evidence(page, info, 'after-stay');
   const second = await leaveThroughOutline(page, info);
   await page.keyboard.press('Escape');
   await expect(second.dialog).toHaveCount(0);
   await expect(trigger).toBeFocused();
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
   expect(await commits(page)).toEqual([]);
  });

  test('Leave Anyway resumes exact original outline href with one click', async ({ page }, info) => {
   await dirty(page);
   const { dialog } = await leaveThroughOutline(page, info);
   await dialog.getByRole('button', { name: labels.leaveAnyway, exact: true }).click();
   await confirmDestination(page, OUTLINE_DESTINATION);
   await evidence(page, info, 'after-leave-anyway');
  });

  test('Retry 503 then 200 preserves response and resumes exact pending href', async ({ page }, info) => {
   await dirty(page);
   const { dialog } = await leaveThroughOutline(page, info);
   const failures = backend.writes.length;
   await dialog.getByRole('button', { name: labels.retrySave, exact: true }).click();
   await expect.poll(() => backend.writes.length).toBeGreaterThan(failures);
   await expect(dialog.getByRole('button', { name: labels.retrySave, exact: true })).toBeEnabled();
   await expect(dialog).toBeVisible();
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
   expect(await commits(page)).toEqual([]);
   backend.configure(200, true);
   await dialog.getByRole('button', { name: labels.retrySave, exact: true }).click();
   await expect.poll(() => backend.held()).toBeGreaterThan(0);
   await expect(dialog.getByRole('button', { name: labels.retryingSave, exact: true })).toBeDisabled();
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
   const recovered = backend.writes.filter(write => write.path.endsWith(`/${BLOCK}`) && write.status === 200);
   expect(recovered.length).toBeGreaterThan(0);
   for (const write of recovered) expect(write.body).toMatchObject({ courseId: COURSE, itemId: ITEM, state: { text: RESPONSE, completed: true }, completed: true });
   await evidence(page, info, 'retry-pending-text-preserved');
   backend.release();
   await confirmDestination(page, OUTLINE_DESTINATION);
   await evidence(page, info, 'after-successful-retry');
  });

  test('rapid different real links commit only the first exact destination', async ({ page }, info) => {
   // Hold the first failed flush so both pointer activations occur before its confirmation.
   await page.locator('textarea').fill(RESPONSE);
   backend.configure(503, true);
   await page.getByRole('button', { name: scenario.locale === 'en' ? 'Save' : 'Lưu', exact: true }).click();
   await page.locator('#runtime-first').click();
   await expect.poll(() => backend.held()).toBeGreaterThan(0);
   await page.locator('#runtime-second').click();
   expect(await commits(page)).toEqual([]);
   backend.release();
   const dialog = page.getByRole('dialog', { name: labels.leaveTitle, exact: true });
   await expect(dialog).toBeVisible();
   await expect(page.getByRole('dialog')).toHaveCount(1);
   await dialog.getByRole('button', { name: labels.leaveAnyway, exact: true }).click();
   await confirmDestination(page, FIRST_DESTINATION);
   expect(await commits(page)).not.toContain(origin + SECOND_DESTINATION);
   await evidence(page, info, 'after-rapid-links-first-wins');
  });

  test('dirty native document exit triggers real beforeunload; dismiss preserves response', async ({ page }, info) => {
   await dirty(page);
   const dialogPromise = page.waitForEvent('dialog');
   const click = page.locator('#runtime-native-exit').click({ noWaitAfter: true });
   const dialog = await dialogPromise;
   const type = dialog.type();
   await dialog.dismiss();
   await click;
   expect(type).toBe('beforeunload');
   await expect(page).toHaveURL(`${origin}${START}?lang=${scenario.locale}`);
   await expect(page.locator('textarea')).toHaveValue(RESPONSE);
   expect(await commits(page)).toEqual([]);
   await evidence(page, info, 'after-native-beforeunload-dismiss');
   await info.attach('native-dialog', { body: JSON.stringify({ type, decision: 'dismiss', source: 'actual anchor document navigation with dirty real runtime' }), contentType: 'application/json' });
  });
 });
}
