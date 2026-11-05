import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';

const name = 'A very long learner name used to verify account menu geometry and truncation behavior';
const normalName = 'Avery Nguyen';
const desktopNavigationWidth = 768;
const locales = ['en', 'vi'] as const;
const themes = ['light', 'dark'] as const;
const widths = [390, 768, 1440];
// F1: empty params from "any" options and a whitespace-only search are absent, not invalid.
const f1Routes = ['/app/opportunities?type=&openNow=true&featured=', '/app/resources?search=%20'];
const routes = [
  '/app', '/app/courses', '/app/courses?tab=discover', '/app/courses/ai-basics', '/app/explore', '/app/profile', '/app/resources',
  '/app/resources/fixture-resource?type=reading&tag=systems&page=1',
  '/app/opportunities?type=workshop&openNow=true&featured=true&page=1',
  ...f1Routes,
  '/app/opportunities/fixture-opportunity?type=workshop&openNow=true&featured=true&page=1',
  '/app/projects?status=active&skill=systems&course=ai-basics',
  '/app/projects/fixture-project?status=active&skill=systems&course=ai-basics',
  '/app/projects/new',
  '/app/leaderboard', '/app/leaderboard?scope=branch',
  // C12: every lesson block inside the activity frame, so both theme runs check engine contrast.
  '/app/courses/ai-basics/items/lesson-blocks',
];

const accountLabel = (locale: string) => locale === 'vi' ? vi.learner.focus.account : en.learner.focus.account;
const accountDialog = (page: Page, locale: string) => page.getByRole('dialog', { name: accountLabel(locale), exact: true });
const accountTrigger = (page: Page, locale: string) => page.locator('.canvas-global-nav:not(.canvas-global-nav-mobile)')
  .getByRole('button', { name: accountLabel(locale), exact: true });

async function openAccount(page: Page, locale: string) {
  if (page.viewportSize()!.width < desktopNavigationWidth) {
    await page.locator('button[aria-controls="learner-mobile-navigation"]').click();
    const drawer = page.getByRole('dialog', { name: locale === 'vi' ? vi.common.learnerNavigation : en.common.learnerNavigation, exact: true });
    await drawer.getByRole('button', { name: accountLabel(locale), exact: true }).click();
    await expect(drawer).toHaveCount(0);
  } else await accountTrigger(page, locale).click();
  const tray = accountDialog(page, locale);
  await expect(tray).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  return tray;
}

async function chooseTheme(tray: ReturnType<Page['getByRole']>, value: string, locale = 'en') {
  const select = tray.getByRole('combobox', { name: locale === 'vi' ? 'Giao diện' : 'Theme', exact: true });
  await select.click();
  await tray.getByRole('option', { name: value, exact: true }).click();
  await expect(select).toHaveValue(value);
}

async function open(page: Page, path: string, locale: string) {
  const [base, hash] = path.split('#');
  const query = new URLSearchParams(new URL(base, 'http://127.0.0.1:4180').search);
  query.set('lang', locale);
  const pathname = base.split('?')[0];
  await page.goto(`${pathname}?${query}${hash ? `#${hash}` : ''}`);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('main h1')).not.toHaveText('Unavailable fixture route');
}
async function screenshot(page: Page, info: TestInfo, label: string) {
  // Routine CI already captures failure screenshots/traces. Full evidence is
  // available locally and through the manually dispatched cross-browser suite.
  if (process.env.CI && process.env.STUDENT_CAPTURE_EVIDENCE !== 'true') return;
  await page.evaluate(() => document.fonts.ready);
  await info.attach(`${label}-fonts`, { body: JSON.stringify(await page.evaluate(() => ({ declaredFamily: getComputedStyle(document.body).fontFamily, loadedFaces: Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })), limitation: 'Self-hosted production faces are imported; declared family alone is not proof. Inspect loadedFaces after document.fonts.ready.' }))), contentType: 'application/json' });
  const path = info.outputPath(`${label}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(label, { path, contentType: 'image/png' });
}
async function axe(page: Page, info: TestInfo, label: string) {
  await page.evaluate(() => document.fonts.ready);
  if (label.includes('lesson-blocks')) await expect(page.locator('[data-code-block] .shiki')).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await info.attach(`${label}-axe`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect.soft(result.violations, `${label} axe violations`).toEqual([]);
}
async function viewport(page: Page) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal document overflow').toBe(true);
}

async function selectedNavigationContrast(surface: ReturnType<Page['getByRole']>, locale: string, info: TestInfo) {
  const selected = surface.getByRole('link', { name: locale === 'en' ? 'Dashboard' : 'Tổng quan', exact: true });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  for (const state of ['default', 'hover', 'focus'] as const) {
    if (state === 'hover') await selected.hover();
    if (state === 'focus') await selected.focus();
    const reading = await selected.evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); const value = context.getImageData(0, 0, 1, 1).data; return [value[0], value[1], value[2], value[3] / 255]; };
      const blend = (front: number[], back: number[]) => [0, 1, 2].map(index => front[index] * front[3] + back[index] * (1 - front[3]));
      const text = Array.from(element.querySelectorAll<HTMLElement>('*')).reverse().find(node => node.textContent?.trim() && !node.children.length && !node.closest('svg')) ?? element;
      const layers: number[][] = []; let parent: Element | null = text;
      while (parent) { layers.push(rgba(getComputedStyle(parent).backgroundColor)); parent = parent.parentElement; }
      let background = [255, 255, 255];
      for (const layer of layers.reverse()) background = blend(layer, background);
      const foreground = blend(rgba(getComputedStyle(text).color), background);
      const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return { foreground, background, ratio: (values[0] + 0.05) / (values[1] + 0.05), current: element.getAttribute('aria-current') };
    });
    await info.attach(`selected-navigation-${state}`, { body: JSON.stringify(reading), contentType: 'application/json' });
    expect(reading.ratio, `selected navigation ${state} foreground/background`).toBeGreaterThanOrEqual(4.5);
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4180') return route.abort('blockedbyclient');
    if (url.pathname === '/api/v1/analytics' && route.request().method() === 'POST') return route.fulfill({ status: 202, body: '' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'Unconfigured fixture request' }) });
    return route.continue();
  });
});

for (const locale of locales) for (const theme of themes) for (const width of widths) {
  test.describe(`${locale} ${theme} ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, colorScheme: theme, contextOptions: { reducedMotion: 'reduce' } });

    test('real pages geometry and axe', async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const path of routes) {
        await open(page, path, locale);
        await viewport(page);
        await axe(page, info, path.replace(/[^a-z0-9]/gi, '-'));
        if (f1Routes.includes(path)) await expect(page.locator('main [role="alert"]')).toHaveCount(0);
        if (locale === 'en' && theme === 'light' && width === 1440) await screenshot(page, info, `page-family-${path.replace(/[^a-z0-9]/gi, '-')}`);
        if (path.includes('/fixture-')) {
          const url = new URL(path, 'http://127.0.0.1:4180');
          const listPath = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
          // Page-owned breadcrumbs (DESIGN D3): the section crumb returns to the list with its query.
          const crumbs = page.locator('main').getByRole('navigation', { name: locale === 'en' ? 'Breadcrumbs' : 'Đường dẫn trang', exact: true });
          await expect(crumbs).toHaveCount(1);
          const back = crumbs.locator(`a[href^="${listPath}"]`);
          await expect(back).toBeVisible();
          const actual = new URL((await back.getAttribute('href'))!, 'http://127.0.0.1:4180');
          expect(actual.pathname).toBe(listPath);
          expect(Object.fromEntries(actual.searchParams)).toEqual(Object.fromEntries(url.searchParams));
        }
        if (path === '/app' || path === '/app/profile') await screenshot(page, info, path === '/app' ? 'dashboard' : 'profile');
      }
      expect(errors).toEqual([]);
      await open(page, '/app/profile#certificates-heading', locale);
      await expect(page.locator('#certificates-heading')).toBeFocused();
      await page.evaluate(() => { location.hash = 'xp-heading'; });
      await expect(page.locator('#xp-heading')).toBeFocused();
    });

    // C14: the bench bar's search slot and the ⌘K palette (axe with the dialog open).
    test('command menu shortcut, geometry and axe', async ({ page }, info) => {
      await open(page, '/app', locale);
      const trigger = page.locator('.canvas-learner-header button[aria-keyshortcuts]');
      await expect(trigger).toBeVisible();
      await expect(trigger.locator('.vf-l-search-label')).toBeVisible({ visible: width >= 1100 });
      expect.soft((await trigger.boundingBox())!.height, 'trigger target (0.1px numeric epsilon)').toBeGreaterThanOrEqual(43.9);
      await page.keyboard.press('ControlOrMeta+k');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeFocused();
      const heights = await dialog.getByRole('option').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(10);
      for (const height of heights) expect.soft(height, 'palette row height').toBeGreaterThanOrEqual(43.9);
      const bounds = await dialog.boundingBox();
      expect.soft(bounds!.x).toBeGreaterThanOrEqual(0);
      expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await dialog.getByRole('combobox').fill(locale === 'vi' ? 'khoa hoc' : 'courses');
      await expect(dialog.getByRole('option').first()).toBeVisible();
      await axe(page, info, 'command-open');
      if (locale === 'en' && theme === 'light') await screenshot(page, info, `command-open-${width}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test('shared Account tray, mobile handoff, geometry, focus and native signout', async ({ page }, info) => {
      await open(page, '/app?longName=1', locale);
      await screenshot(page, info, 'before-navigation-open');
      const messages = locale === 'vi' ? vi : en;
      const menuButton = page.locator('button[aria-controls="learner-mobile-navigation"]');
      const global = page.getByRole('navigation', { name: locale === 'en' ? 'Global navigation' : 'Điều hướng toàn cục', exact: true });
      if (width >= desktopNavigationWidth) {
        await expect(global).toBeVisible();
        await expect(menuButton).toBeHidden();
        await expect(accountTrigger(page, locale)).toBeVisible();
        for (const href of ['/studio', '/grading', '/admin']) await expect(global.locator('a[href="' + href + '"]')).toBeVisible();
      } else {
        await expect(global).toBeHidden();
        await expect(menuButton).toBeVisible();
        await menuButton.click();
        const drawer = page.getByRole('dialog', { name: messages.common.learnerNavigation, exact: true });
        await expect(drawer).toBeVisible();
        await selectedNavigationContrast(drawer, locale, info);
        for (const href of ['/studio', '/grading', '/admin']) await expect(drawer.locator('a[href="' + href + '"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(menuButton).toBeFocused();
        await menuButton.click();
        await page.setViewportSize({ width: desktopNavigationWidth, height: 900 });
        await expect(drawer).toBeHidden();
        await expect(page.locator('main h1')).toBeFocused();
        await screenshot(page, info, 'after-resize-768');
        await page.setViewportSize({ width, height: 900 });
      }
      let surface = await openAccount(page, locale);
      await expect(surface.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(surface.locator('.canvas-account-avatar')).toContainText('TB');
      await expect(surface.getByText('@fixture-learner', { exact: true })).toBeVisible();
      await expect(surface.getByRole('button', { name: messages.common.close, exact: true })).toBeFocused();
      const accountLinks = surface.getByRole('navigation', { name: accountLabel(locale), exact: true }).getByRole('link');
      await expect(accountLinks).toHaveCount(4);
      expect(await accountLinks.evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href).pathname + new URL((link as HTMLAnchorElement).href).hash))).toEqual([
        '/app/profile', '/app/profile#profile-settings-heading', '/app/profile#certificates-heading', '/app/leaderboard',
      ]);
      const rows = await accountLinks.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height }; }));
      await info.attach('account-row-geometry', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
      for (let i = 0; i < rows.length; i++) {
        expect.soft(rows[i].height, rows[i].text + ' height (0.1px numeric epsilon)').toBeGreaterThanOrEqual(43.9);
        if (i) expect.soft(rows[i].y, 'rows vertically stacked without overlap').toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height - 1);
      }
      const language = surface.getByRole('combobox', { name: messages.common.language, exact: true });
      const selectedLanguage = messages.locale[locale];
      await expect(language).toHaveValue(selectedLanguage);
      await language.click();
      await expect(surface.getByRole('option')).toHaveCount(2);
      await surface.getByRole('option', { name: selectedLanguage, exact: true }).click();
      const theme = surface.getByRole('combobox', { name: locale === 'vi' ? 'Giao diện' : 'Theme', exact: true });
      await expect(theme).toBeVisible();
      const selectedTheme = await theme.inputValue();
      await theme.click();
      await expect(surface.getByRole('option')).toHaveCount(3);
      await surface.getByRole('option', { name: selectedTheme, exact: true }).click();
      await expect(surface).toBeVisible();
      for (const control of [language, theme]) expect.soft((await control.boundingBox())!.height, 'native preference target').toBeGreaterThanOrEqual(43.9);
      const bounds = await surface.boundingBox();
      expect(bounds).not.toBeNull();
      expect.soft(bounds!.x).toBeGreaterThanOrEqual(0);
      expect.soft(bounds!.y).toBeGreaterThanOrEqual(0);
      expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'browser received reduced-motion preference').toBe(true);
      expect.soft(await surface.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
      await screenshot(page, info, 'after-account-open');
      await axe(page, info, 'account-open');
      await surface.locator('a[href="/app/profile#certificates-heading"]').click();
      await expect(surface).toBeHidden();
      await expect(page.locator('#certificates-heading')).toBeFocused();
      // The shared tray exposes Account settings; XP remains covered by the direct hash test.
      for (let i = 0; i < 2; i++) {
        surface = await openAccount(page, locale);
        await surface.locator('a[href="/app/profile#profile-settings-heading"]').click();
        await expect(surface).toBeHidden();
        await info.attach('hash-focus-attempt-' + (i + 1), { body: JSON.stringify(await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.outerHTML }))), contentType: 'application/json' });
        await expect(page.locator('#profile-settings-heading')).toBeFocused();
      }
      await screenshot(page, info, 'after-account-hash-focus');
      surface = await openAccount(page, locale);
      await page.keyboard.press('Escape');
      await expect(surface).toBeHidden();
      await expect(width >= desktopNavigationWidth ? accountTrigger(page, locale) : menuButton).toBeFocused();
      surface = await openAccount(page, locale);
      const signout = surface.getByRole('button', { name: messages.common.signOut, exact: true });
      const nativeForm = page.locator('form[action="/auth/signout"][method="post"]');
      await expect(nativeForm).toHaveCount(1);
      expect(await nativeForm.evaluate((form: HTMLFormElement) => ({ method: form.method, action: new URL(form.action).pathname }))).toEqual({ method: 'post', action: '/auth/signout' });
      await page.route('**/auth/signout', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture signed out</title><h1>Fixture signed out</h1>' }));
      const request = page.waitForRequest(request => new URL(request.url()).pathname === '/auth/signout');
      await signout.click();
      expect((await request).method()).toBe('POST');
      await expect(page.getByRole('heading', { name: 'Fixture signed out' })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('vfuture:auth:signed-out'))).toBeTruthy();
    });

    test('real outline and quiz preserves answer on check failure then retries', async ({ page }, info) => {
      await open(page, '/app/courses/ai-basics/items/lesson-1', locale);
      await expect(page.locator('header').filter({ has: page.locator('a[href="/app"]') })).toHaveCount(0);
      // This fixture mounts actual FocusBar/FocusOutline/QuizRenderer; it is not canonical ItemPlayer proof.
      // Global search remains in the Canvas header while its palette starts closed.
      const bar = page.getByRole('navigation', { name: locale === 'en' ? 'Activity' : 'Hoạt động', exact: true });
      await expect(bar).toBeVisible();
      expect(await bar.evaluate(element => element.tagName)).toBe('NAV');
      await expect(bar.locator('a[href="/app"]')).toHaveCount(0);
      await expect(bar.getByRole('link', { name: locale === 'en' ? 'Back to course: AI basics' : 'Quay lại khoá học: AI basics', exact: true })).toHaveAttribute('href', '/app/courses/ai-basics');
      expect(await bar.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(56);
      await expect(page.locator('[cmdk-root], [data-command-menu]')).toHaveCount(0);
      // The activity bar owns one outline trigger; the shell also owns global dialogs.
      await expect(bar.locator('[aria-haspopup="dialog"]')).toHaveCount(1);
      const trigger = bar.locator('button[aria-haspopup="dialog"]');
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await screenshot(page, info, 'outline-open');
      await axe(page, info, 'outline');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.getByRole('radio', { name: 'First option' }).check();
      await screenshot(page, info, 'before-check');
      await page.getByRole('button', { name: locale === 'en' ? 'Check answer' : 'Kiểm tra đáp án', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(locale === 'en' ? 'Your answer is still here' : 'Đáp án của bạn vẫn được giữ lại');
      await expect(page.getByRole('radio', { name: 'First option' })).toBeChecked();
      await screenshot(page, info, 'after-check-failure');
      await axe(page, info, 'quiz-failure');
      await page.getByRole('button', { name: locale === 'en' ? 'Try checking again' : 'Thử kiểm tra lại', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'First option' })).toBeChecked();
      expect(await page.evaluate(() => (window as unknown as { fixtureChecks: unknown }).fixtureChecks)).toEqual({ checks: 2, answer: 'yes' });
      await screenshot(page, info, 'after-check-retry');
    });
  });
}

test.describe('refined learner theme state', () => {
  test.use({ colorScheme: 'light' });

  test('mobile Account tray reflects the theme selected before reopening', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, '/app', 'en');
    let tray = await openAccount(page, 'en');
    await chooseTheme(tray, 'Dark');
    await expect(page.locator('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    expect((await page.context().cookies()).find(cookie => cookie.name === 'vf-theme')?.value).toBe('dark');
    await page.keyboard.press('Escape');
    await expect(tray).toBeHidden();
    await expect(page.locator('button[aria-controls="learner-mobile-navigation"]')).toBeFocused();
    tray = await openAccount(page, 'en');
    await expect(tray.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('Dark');
  });

  test('desktop Account tray reflects the theme selected before reopening', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app', 'en');
    let tray = await openAccount(page, 'en');
    await expect(tray.getByRole('heading', { name: normalName, exact: true })).toBeVisible();
    await chooseTheme(tray, 'Dark');
    await expect(page.locator('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    expect((await page.context().cookies()).find(cookie => cookie.name === 'vf-theme')?.value).toBe('dark');
    await page.keyboard.press('Escape');
    await expect(tray).toBeHidden();
    await expect(accountTrigger(page, 'en')).toBeFocused();
    tray = await openAccount(page, 'en');
    await expect(tray.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('Dark');
  });

  // The shared native Tray uses the learner surface/ink tokens in its portal.
  test('Account tray portal reads the learner surface tokens in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app', 'en');
    const trayStyle = () => accountDialog(page, 'en').evaluate(element => {
      const panel = element.querySelector<HTMLElement>('.canvas-account-panel')!;
      const style = getComputedStyle(panel);
      const probe = document.createElement('span');
      const root = document.querySelector('.vf-workspace');
      if (!root) throw new Error('Expected the owning learner workspace');
      probe.style.backgroundColor = 'var(--vf-surface)'; probe.style.color = 'var(--vf-ink)'; root.append(probe);
      const expected = getComputedStyle(probe);
      const result = { background: style.backgroundColor, expectedBackground: expected.backgroundColor, color: style.color,
        expectedColor: expected.color, inOwnedMount: Boolean(element.closest('.canvas-account-mount')), inWorkspace: element.closest('.vf-workspace') === root };
      probe.remove();
      return result;
    });
    let tray = await openAccount(page, 'en');
    const light = await trayStyle();
    expect(light.inOwnedMount).toBe(true); expect(light.inWorkspace).toBe(true); expect(light.background).toBe(light.expectedBackground); expect(light.color).toBe(light.expectedColor);
    await chooseTheme(tray, 'Dark');
    await page.keyboard.press('Escape');
    await expect(tray).toBeHidden();
    tray = await openAccount(page, 'en');
    const dark = await trayStyle();
    expect(dark.inOwnedMount).toBe(true); expect(dark.inWorkspace).toBe(true); expect(dark.background).toBe(dark.expectedBackground); expect(dark.color).toBe(dark.expectedColor);
    expect(dark.background).not.toBe(light.background);
  });
});

// The shell owns width (DESIGN D2): brand, breadcrumbs and h1 share one left edge on every column page.
const columnRoutes = [
  '/app/courses', '/app/explore', '/app/resources', '/app/opportunities', '/app/projects', '/app/profile', '/app/leaderboard',
  '/app/resources/fixture-resource', '/app/opportunities/fixture-opportunity', '/app/projects/fixture-project', '/app/projects/new',
];
test.describe('shared left edge', () => {
  test.use({ colorScheme: 'light', contextOptions: { reducedMotion: 'reduce' } });

  for (const width of [1440, 768]) test(`content gutters and global rail stay coherent at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const rows: Array<Record<string, unknown>> = [];
    for (const path of columnRoutes) {
      await open(page, path, 'en');
      const brandLink = page.getByRole('navigation', { name: 'Global navigation', exact: true }).getByRole('link', { name: 'VFuture', exact: true });
      await expect(brandLink).toBeVisible();
      const geometry = await brandLink.evaluate(brand => {
        const main = document.querySelector<HTMLElement>('#learner-main')!;
        const box = (element: Element) => element.getBoundingClientRect();
        const x = (element: Element | null) => element ? box(element).left : null;
        const bounds = box(main); const style = getComputedStyle(main);
        // Profile identity is intentionally inside a padded surface. Its outer edge
        // follows the page gutter; the heading follows that surface's content edge.
        const identityPanel = main.querySelector('#profile-title')?.closest('section.canvas-panel');
        const identityStyle = identityPanel ? getComputedStyle(identityPanel) : null;
        const identityLeft = identityPanel ? box(identityPanel).left : null;
        const headingLeft = identityPanel && identityStyle
          ? box(identityPanel).left + parseFloat(identityStyle.borderLeftWidth) + parseFloat(identityStyle.paddingLeft)
          : bounds.left + parseFloat(style.paddingLeft);
        const rail = document.querySelector('.canvas-global-nav:not(.canvas-global-nav-mobile)')!;
        const railBounds = box(rail);
        const aside = main.querySelector(':scope > .vf-l-split[data-aside] > [data-area="aside"], :scope > .vf-l-split[data-aside] > [data-area="action"]');
        return { h1: x(main.querySelector('h1')), crumbs: x(main.querySelector('nav ol.vf-crumbs')),
          expectedLeft: bounds.left + parseFloat(style.paddingLeft), expectedHeadingLeft: headingLeft, identityLeft, contentRight: bounds.right - parseFloat(style.paddingRight),
          rail: { left: railBounds.left, right: railBounds.right, width: railBounds.width }, brand: { left: box(brand).left, right: box(brand).right },
          mainLeft: bounds.left, frameRight: Math.max(...Array.from(main.children, child => box(child).right)),
          aside: aside && innerWidth >= 1100 ? { left: box(aside).left, right: box(aside).right, width: box(aside).width } : null,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      rows.push({ path, ...geometry });
      expect.soft(Math.abs(geometry.h1! - geometry.expectedHeadingLeft), `${path} heading content gutter`).toBeLessThanOrEqual(1);
      if (geometry.identityLeft !== null) expect.soft(Math.abs(geometry.identityLeft - geometry.expectedLeft), `${path} identity surface page gutter`).toBeLessThanOrEqual(1);
      if (geometry.crumbs !== null) expect.soft(Math.abs(geometry.crumbs - geometry.h1!), `${path} crumbs/title`).toBeLessThanOrEqual(1);
      expect.soft(geometry.mainLeft, `${path} content does not overlap rail`).toBeGreaterThanOrEqual(geometry.rail.right - 1);
      expect.soft(geometry.brand.left, `${path} brand inside rail`).toBeGreaterThanOrEqual(geometry.rail.left - 1);
      expect.soft(geometry.brand.right, `${path} brand inside rail`).toBeLessThanOrEqual(geometry.rail.right + 1);
      expect.soft(geometry.frameRight, `${path} frame fits available content`).toBeLessThanOrEqual(geometry.contentRight + 1);
      if (geometry.aside) expect.soft(geometry.aside.right, `${path} aside inside frame`).toBeLessThanOrEqual(geometry.contentRight + 1);
      expect.soft(geometry.overflow, `${path} overflow`).toBe(false);
    }
    await info.attach(`content-rail-geometry-${width}`, { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    expect(rows.some(row => row.crumbs !== null)).toBe(true);
  });

  // No hand-copied token mirror: the surface element and a portal-free control read the same values as :root.
  for (const theme of themes) test(`learner tokens resolve on the surface element ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app/courses', 'en');
    const values = await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('.vf-workspace')!;
      const token = (element: Element, name: string) => getComputedStyle(element).getPropertyValue(name).trim().toLowerCase();
      const select = document.querySelector('main select')!;
      const probe = document.createElement('span');
      probe.style.color = 'var(--vf-ink)';
      surface.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      return {
        rootSignal: token(document.documentElement, '--vf-signal'), surfaceSignal: token(surface, '--vf-signal'),
        rootRadius: token(document.documentElement, '--radius-lg'), surfaceRadius: token(surface, '--radius-lg'),
        button: getComputedStyle(document.querySelector('main .vf-btn')!).borderTopLeftRadius,
        selectColor: getComputedStyle(select).color, ink,
      };
    });
    expect(values.surfaceSignal).toBe(values.rootSignal);
    expect(values.rootSignal).toBe(theme === 'light' ? '#08666a' : '#72d5d7');
    expect(values.surfaceRadius).toBe('4px');
    expect(values.rootRadius).toBe(values.surfaceRadius);
    expect(values.button).toBe(values.surfaceRadius);
    expect(values.selectColor).toBe(values.ink);
  });

  // Actual task-first composition: a bounded sidebar at wide widths, stacked below1200.
  for (const width of [1440, 1024]) test(`task-first dashboard main and sidebar at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/app?fixture=dense', 'en');
    await expect(page.locator('.canvas-dashboard-main')).toBeVisible();
    await expect(page.locator('.canvas-dashboard-side')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      return { title: box('main h1'), dashboard: box('.canvas-dashboard-refined'), main: box('.canvas-dashboard-main'), mainDisplay: getComputedStyle(document.querySelector('.canvas-dashboard-main')!).display, aside: box('.canvas-dashboard-side'), resume: box('.canvas-dashboard-resume'), courses: box('.canvas-dashboard-course-section'), results: box('.canvas-dashboard-results'), work: box('.canvas-coursework'), rail: box('.canvas-global-nav:not(.canvas-global-nav-mobile)') };
    });
    await info.attach(`task-first-frame-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' });
    expect(Math.abs(geometry.title.x - geometry.work.x)).toBeLessThanOrEqual(1);
    expect(geometry.work.x).toBeGreaterThanOrEqual(geometry.rail.right);
    expect(geometry.resume.x).toBeGreaterThanOrEqual(geometry.courses.x);
    expect(geometry.resume.right).toBeLessThanOrEqual(geometry.courses.right + 1);
    if (width >= 1200) {
      expect(geometry.aside.width).toBeCloseTo(270, 0);
      expect(geometry.aside.x - geometry.main.right).toBeCloseTo(30, 0);
      expect(Math.abs(geometry.aside.top - geometry.main.top)).toBeLessThanOrEqual(1);
    } else {
      // At this breakpoint the semantic main wrapper is display:contents, not a box.
      expect(Math.abs(geometry.aside.x - geometry.work.x)).toBeLessThanOrEqual(1);
      expect(geometry.aside.top).toBeGreaterThanOrEqual(geometry.work.bottom);
      expect(geometry.courses.top).toBeGreaterThanOrEqual(geometry.aside.bottom);
      expect(geometry.results.top).toBeGreaterThanOrEqual(geometry.courses.bottom);
      expect(Math.abs(geometry.aside.width - geometry.work.width)).toBeLessThanOrEqual(1);
    }
    await open(page, '/app?fixture=tasks-error', 'en');
    await expect(page.getByRole('status').filter({ hasText: 'Coursework is temporarily unavailable' })).toBeVisible();
    for (const label of ['To do', 'Overdue', 'Submitted']) await expect(page.getByRole('button', { name: new RegExp(`${label}.*—`) })).toBeVisible();
    await viewport(page);
  });

  test('no horizontal overflow at 360', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/app', ...columnRoutes]) {
      await open(page, path, 'en');
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} overflow`).toBe(true);
    }
  });
});

for (const theme of themes) test(`StatusNotice all tones contrast ${theme}`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await open(page, '/app/notices', 'en');
  await expect(page.locator('main [role="status"]')).toHaveCount(3);
  await expect(page.locator('main [role="alert"]')).toHaveCount(1);
  await screenshot(page, info, `notices-${theme}`);
  await axe(page, info, `notices-${theme}`);
});

// The current segment inverts (ink fill, background text) on every page that uses the segmented control.
for (const theme of themes) test(`segmented current link stays readable ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ['/app/courses', '/app/leaderboard']) {
    await open(page, path, 'en');
    const [color, background] = await page.locator('main .vf-seg a[aria-current="page"]').evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor]);
    expect.soft(color, `${path} current segment`).not.toBe(background);
  }
});

// F6: directory filters. Actions take their own row from 760px (two columns) and join the one
// filter row from 1100px; a select never clips its shown value; a stacked row never leaves its
// lead (the part code or status tag) alone on a line.
const directoryRoutes = ['/app/courses', '/app/projects?status=active&skill=systems&course=ai-basics'];
async function filterGeometry(page: Page) {
  return page.locator('main form.vf-l-filter-form').evaluate(form => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    const canvas = document.createElement('canvas').getContext('2d')!;
    const selects = Array.from(form.querySelectorAll('select'), select => {
      const style = getComputedStyle(select);
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const shown = select.selectedOptions[0]?.textContent ?? '';
      // The native arrow sits inside the padding box; leave it 24px.
      const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
      return { name: select.name, shown, scrollWidth: select.scrollWidth, clientWidth: select.clientWidth, boundingWidth: select.getBoundingClientRect().width, font: canvas.font, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, rawText: canvas.measureText(shown).width, rawRoom: room, text: Math.ceil(canvas.measureText(shown).width), room: Math.floor(room) };
    });
    return {
      fields: Array.from(form.querySelectorAll(':scope > .vf-l-filter-field, :scope > .vf-l-filter-checks'), box),
      actions: box(form.querySelector(':scope > .vf-l-filter-actions')!),
      selects,
    };
  });
}
test.describe('directory filter geometry', () => {
  test.use({ colorScheme: 'light', contextOptions: { reducedMotion: 'reduce' } });

  for (const locale of locales) for (const path of directoryRoutes) {
    test(`${locale} ${path.split('?')[0]} at 768: actions on their own row, no clipped select`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 900 });
      await open(page, path, locale);
      const { fields, actions, selects } = await filterGeometry(page);
      expect(fields.length).toBeGreaterThan(0);
      expect(actions.top).toBeGreaterThanOrEqual(Math.max(...fields.map(field => field.bottom)));
      for (const select of selects) {
        expect.soft(select.scrollWidth, `${select.name} scrollWidth`).toBeLessThanOrEqual(select.clientWidth);
        expect.soft(select.text, `${select.name} shown value fits`).toBeLessThanOrEqual(select.room);
      }
    });

    test(`${locale} ${path.split('?')[0]} at 1280: fields and actions share one row`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, path, locale);
      const { fields, actions, selects } = await filterGeometry(page);
      await info.attach('filter-raw-box-text-metrics', { body: JSON.stringify({ fields, actions, selects }, null, 2), contentType: 'application/json' });
      const tops = fields.map(field => field.top);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
      for (const field of fields) {
        expect(actions.top).toBeLessThan(field.bottom);
        expect(actions.bottom).toBeGreaterThan(field.top);
        expect(actions.left).toBeGreaterThanOrEqual(field.right);
      }
      for (const select of selects) {
        // WebKit snaps a fractional-width select's scrollWidth up and clientWidth to nearest
        // (269.6px box: client 268, scroll 269), so allow that one rounding pixel; the shown
        // value check below is what proves nothing is clipped.
        expect.soft(select.scrollWidth, `${select.name} scrollWidth`).toBeLessThanOrEqual(select.clientWidth + 1);
        expect.soft(select.text, `${select.name} shown value fits`).toBeLessThanOrEqual(select.room);
      }
    });
  }

  test('stacked rows never leave the lead alone on a line at 375', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/app/courses', '/app/courses?tab=discover', '/app/projects']) {
      await open(page, path, 'en');
      if (path.startsWith('/app/courses')) {
        const region = page.getByRole('region', { name: path.includes('discover') ? 'Available courses' : 'Your courses', exact: true });
        const cards = region.getByRole('listitem');
        expect(await cards.count(), `${path} course cards`).toBeGreaterThan(0);
        for (const card of await cards.all()) {
          const title = card.getByRole('heading', { level: 3 });
          await expect(title).toBeVisible();
          const links = card.getByRole('link');
          await expect(links).toHaveCount(2);
          expect(await links.nth(0).getAttribute('href')).toBe(await links.nth(1).getAttribute('href'));
          await expect(links.nth(1)).toBeVisible();
          const bounds = await card.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
        }
        await viewport(page);
        continue;
      }
      const tables = page.getByRole('table');
      expect(await tables.count(), `${path} native project tables`).toBeGreaterThan(0);
      let rowCount = 0;
      for (const table of await tables.all()) {
        const rows = table.getByRole('row').filter({ has: page.getByRole('link', { name: /^Open / }) });
        for (const row of await rows.all()) {
          rowCount += 1;
          const status = row.getByRole('cell', { name: /^Status:/ });
          const project = row.getByRole('cell', { name: /^Project:/ });
          await expect(status).toBeVisible(); await expect(status).toContainText('Active');
          await expect(project.getByRole('heading', { level: 3 })).toBeVisible();
          await expect(project.getByRole('link', { name: /^Open / })).toHaveAttribute('href', '/app/projects/fixture-project');
          await expect(project).toContainText('Systems'); await expect(project).toContainText('Collaboration');
          const bounds = await row.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
        }
      }
      expect(rowCount, `${path} rows with associated status/title/metadata`).toBeGreaterThan(0);
      await viewport(page);
    }
  });

  // F2 in a browser: Apply pushes a compact query, Clear returns every select to "All". (The harness
  // remounts per URL, so the same-mount rerender is covered by the unit tests.)
  for (const [path, select, value] of [['/app/courses?tab=learning', 'Level', 'specialization'], ['/app/projects', 'Status', 'active']] as const) {
    test(`Apply then Clear on ${path.split('?')[0]} leaves no empty params and resets every select`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, path, 'en');
      const form = page.locator('main').getByRole('form').filter({ has: page.locator('select') });
      await form.getByRole('combobox', { name: select, exact: true }).selectOption(value);
      await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
      const pathname = path.split('?')[0];
      const expected = { ...Object.fromEntries(new URL(path, 'http://127.0.0.1:4180').searchParams), [select === 'Level' ? 'level' : 'status']: value };
      await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(expected);
      expect(new URL(page.url()).pathname).toBe(pathname);
      await expect(page.locator('main [tabindex="-1"].vf-l-results-count')).toBeFocused();
      await expect(form.getByRole('combobox', { name: select, exact: true })).toHaveValue(value);
      await form.getByRole('link', { name: 'Clear filters', exact: true }).click();
      await expect.poll(() => new URL(page.url()).search).toBe(path.includes('?') ? `?${path.split('?')[1]}` : '');
      expect([...new URL(page.url()).searchParams].filter(([, entry]) => entry === '')).toEqual([]);
      const values = await form.locator('select').evaluateAll(selects => selects.map(element => (element as HTMLSelectElement).value));
      expect(values.length).toBeGreaterThan(0);
      expect(values.every(entry => entry === '')).toBe(true);
    });
  }
});
