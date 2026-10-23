import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const name = 'A very long learner name used to verify account menu geometry and truncation behavior';
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
  await info.attach(`${label}-fonts`, { body: JSON.stringify(await page.evaluate(() => ({ declaredFamily: getComputedStyle(document.body).fontFamily, loadedFaces: Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })), limitation: 'Google Fonts are not fetched: screenshots use platform fallback fonts, not exact production typography.' }))), contentType: 'application/json' });
  const path = info.outputPath(`${label}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(label, { path, contentType: 'image/png' });
}
async function axe(page: Page, info: TestInfo, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await info.attach(`${label}-axe`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect.soft(result.violations, `${label} axe violations`).toEqual([]);
}
async function viewport(page: Page) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal document overflow').toBe(true);
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
      const trigger = page.locator('header .vf-bench-right > button[aria-keyshortcuts]');
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

    test('account menu or drawer geometry focus and native signout', async ({ page }, info) => {
      await open(page, '/app', locale);
      await screenshot(page, info, 'before-navigation-open');
      // The bench nav and account menu take over from the drawer at 760px (DESIGN D7).
      const menuButton = page.locator('button[aria-controls="learner-mobile-navigation"]');
      if (width >= 760) {
        await expect(page.locator('header .vf-bench-nav')).toBeVisible();
        await expect(menuButton).toBeHidden();
        await expect(page.getByRole('button', { name }).locator('.vf-l-account-initials')).toHaveText('TB');
        await expect(page.getByRole('button', { name }).locator('.vf-l-account-name')).toBeVisible({ visible: width >= 1100 });
      } else {
        await expect(page.locator('header .vf-bench-nav')).toBeHidden();
        await expect(menuButton).toBeVisible();
      }
      let surface;
      if (width >= 760) {
        await page.getByRole('button', { name }).click();
        surface = page.getByRole('menu');
        await expect(surface).toBeVisible();
        await expect(surface.getByText('@fixture-learner')).toBeVisible();
        const languages = surface.getByRole('menuitemradio').and(surface.locator('[lang]'));
        await expect(languages).toHaveCount(2);
        await expect(languages.and(page.locator(`[lang="${locale}"]`))).toHaveAttribute('aria-checked', 'true');
        const rows = await surface.getByRole('menuitem').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height }; }));
        await info.attach('account-row-geometry', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
        expect(rows).toHaveLength(8);
        for (let i = 0; i < rows.length; i++) {
          // Subpixel transform math can produce 43.999969 for an exact 44px target.
          expect.soft(rows[i].height, `${rows[i].text} height (0.1px numeric epsilon)`).toBeGreaterThanOrEqual(43.9);
          if (i) expect.soft(rows[i].y, 'rows vertically stacked without overlap').toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height - 1);
        }
      } else {
        const trigger = page.locator('button[aria-controls="learner-mobile-navigation"]');
        await trigger.click();
        surface = page.getByRole('dialog');
        await expect(surface).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(surface).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.click();
        const themeTargets = await surface.locator('.vf-theme-option:not([lang])').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        expect(themeTargets).toHaveLength(3);
        for (const height of themeTargets) expect(height).toBeGreaterThanOrEqual(43.9);
        const languageTargets = await surface.locator('.vf-theme-option[lang]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        expect(languageTargets).toHaveLength(2);
        for (const height of languageTargets) expect(height).toBeGreaterThanOrEqual(43.9);
      }
      const bounds = await surface.boundingBox();
      expect(bounds).not.toBeNull();
      expect.soft(bounds!.x).toBeGreaterThanOrEqual(0);
      expect.soft(bounds!.y).toBeGreaterThanOrEqual(0);
      expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'browser received reduced-motion preference').toBe(true);
      expect.soft(await surface.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
      await screenshot(page, info, 'after-navigation-open');
      await axe(page, info, 'navigation-open');
      if (width < 760) {
        await page.setViewportSize({ width: 760, height: 900 });
        await expect(surface).toBeHidden();
        // CSS hides the drawer before matchMedia and Radix finish restoring
        // focus. Wait for the actual desktop target instead of sampling once.
        await expect(page.locator('header a[aria-current="page"]').first()).toBeFocused();
        await screenshot(page, info, 'after-resize-760');
        await page.setViewportSize({ width, height: 900 });
        await page.locator('button[aria-controls="learner-mobile-navigation"]').click();
        surface = page.getByRole('dialog');
      }
      // Actual account links: cross-route certificates, same-page XP, repeat same hash.
      await surface.locator('a[href="/app/profile#certificates-heading"]').click();
      await expect(page.locator('#certificates-heading')).toBeFocused();
      await expect(surface).toBeHidden();
      const reopen = async () => {
        if (width >= 760) await page.getByRole('button', { name }).click();
        else await page.locator('button[aria-controls="learner-mobile-navigation"]').click();
        return width >= 760 ? page.getByRole('menu') : page.getByRole('dialog');
      };
      for (let i = 0; i < 2; i++) {
        surface = await reopen();
        await surface.locator('a[href="/app/profile#xp-heading"]').click();
        await expect(surface).toBeHidden();
        await info.attach(`hash-focus-attempt-${i + 1}`, { body: JSON.stringify(await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.outerHTML }))), contentType: 'application/json' });
        await expect(page.locator('#xp-heading')).toBeFocused();
      }
      await screenshot(page, info, 'after-account-hash-focus');
      surface = await reopen();
      await page.keyboard.press('Escape');
      await expect(surface).toBeHidden();
      await expect(width >= 760 ? page.getByRole('button', { name }) : page.locator('button[aria-controls="learner-mobile-navigation"]')).toBeFocused();
      surface = await reopen();
      const signout = surface.locator('button[type="submit"]');
      expect(await signout.evaluate((button: HTMLButtonElement) => ({ method: button.form?.method, action: new URL(button.form!.action).pathname }))).toEqual({ method: 'post', action: '/auth/signout' });
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
      // Focus routes draw the FocusBar: a nav (not a header) with no brand link and no command menu.
      const bar = page.getByRole('navigation', { name: locale === 'en' ? 'Activity' : 'Hoạt động', exact: true });
      await expect(bar).toBeVisible();
      expect(await bar.evaluate(element => element.tagName)).toBe('NAV');
      await expect(bar.locator('a[href="/app"]')).toHaveCount(0);
      await expect(bar.getByRole('link', { name: locale === 'en' ? 'Back to course: AI basics' : 'Quay lại khoá học: AI basics', exact: true })).toHaveAttribute('href', '/app/courses/ai-basics');
      expect(await bar.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(56);
      await expect(page.locator('[cmdk-root], [data-command-menu]')).toHaveCount(0);
      // The actual translated trigger is the sole dialog trigger on this fixture, and it lives in the bar.
      await expect(page.locator('[aria-haspopup="dialog"]')).toHaveCount(1);
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

  test('mobile drawer reflects the theme selected before reopening', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, '/app', 'en');
    const trigger = page.locator('button[aria-controls="learner-mobile-navigation"]');
    await trigger.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Escape');
    await trigger.click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('desktop account menu reflects the theme selected before reopening', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app', 'en');
    const trigger = page.getByRole('button', { name });
    await trigger.click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Escape');
    await trigger.click();
    await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  });

  // Portals carry no token class: they inherit the learner tokens (radius, raised surface) from :root, before and after a theme switch.
  test('account menu portal reads the learner tokens in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app', 'en');
    const trigger = page.getByRole('button', { name });
    const menuStyle = () => page.getByRole('menu').evaluate(element => {
      const style = getComputedStyle(element);
      return { radius: style.borderTopLeftRadius, background: style.backgroundColor, inClass: Boolean(element.closest('.vf-workspace')) };
    });
    await trigger.click();
    expect(await menuStyle()).toEqual({ radius: '8px', background: 'rgb(255, 255, 255)', inClass: false });
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.keyboard.press('Escape');
    await trigger.click();
    expect(await menuStyle()).toEqual({ radius: '8px', background: 'rgb(23, 33, 37)', inClass: false });
  });
});

// The shell owns width (DESIGN D2): brand, breadcrumbs and h1 share one left edge on every column page.
const columnRoutes = [
  '/app/courses', '/app/explore', '/app/resources', '/app/opportunities', '/app/projects', '/app/profile', '/app/leaderboard',
  '/app/resources/fixture-resource', '/app/opportunities/fixture-opportunity', '/app/projects/fixture-project', '/app/projects/new',
];
test.describe('shared left edge', () => {
  test.use({ colorScheme: 'light', contextOptions: { reducedMotion: 'reduce' } });

  for (const width of [1440, 768]) test(`brand, crumbs and h1 align at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const rows: Array<Record<string, unknown>> = [];
    for (const path of columnRoutes) {
      await open(page, path, 'en');
      const geometry = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('#learner-main')!;
        const x = (element: Element | null | undefined) => element ? Math.round(element.getBoundingClientRect().x * 10) / 10 : null;
        const h1 = main.querySelector('h1');
        const width = (element: Element) => element.getBoundingClientRect().width;
        // A split frame (DetailPage with an action or aside) spans column + gap + aside (D2); its
        // column is the head and main areas, not the whole grid.
        const columnOf = (child: Element) => child.matches('.vf-l-split[data-aside]')
          ? Math.max(...Array.from(child.querySelectorAll(':scope > [data-area="head"], :scope > [data-area="main"]'), width))
          : width(child);
        const aside = main.querySelector(':scope > .vf-l-split[data-aside] > [data-area="aside"], :scope > .vf-l-split[data-aside] > [data-area="action"]');
        const split = aside?.parentElement?.querySelector(':scope > [data-area="main"]');
        return {
          h1: x(h1),
          crumbs: x(main.querySelector('nav ol.vf-crumbs')),
          brand: x(document.querySelector('.vf-bench .vf-brand')),
          column: Math.max(...Array.from(main.children, columnOf)),
          frame: Math.max(...Array.from(main.children, width)),
          asideWidth: aside && innerWidth >= 1100 ? Math.round(width(aside)) : null,
          asideGap: aside && split && innerWidth >= 1100 ? Math.round(aside.getBoundingClientRect().left - split.getBoundingClientRect().right) : null,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      rows.push({ path, ...geometry });
    }
    await info.attach(`left-edge-${width}`, { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    const edge = rows[0].h1 as number;
    expect(edge).toBe(width >= 760 ? 40 : 16);
    for (const row of rows) {
      expect.soft(Math.abs((row.h1 as number) - edge), `${row.path} h1`).toBeLessThanOrEqual(1);
      if (row.crumbs !== null) expect.soft(Math.abs((row.crumbs as number) - edge), `${row.path} crumbs`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs((row.brand as number) - edge), `${row.path} brand`).toBeLessThanOrEqual(1);
      expect.soft(row.column as number, `${row.path} column`).toBeLessThanOrEqual(1080);
      expect.soft(row.frame as number, `${row.path} frame`).toBeLessThanOrEqual(1080 + 24 + 280);
      if (row.asideWidth !== null) {
        expect.soft(row.asideWidth, `${row.path} aside width`).toBe(280);
        expect.soft(row.asideGap, `${row.path} aside gap`).toBe(24);
      }
      expect.soft(row.overflow, `${row.path} overflow`).toBe(false);
    }
    expect(rows.filter(row => row.crumbs !== null).length).toBeGreaterThan(0);
    if (width >= 1100) expect(rows.filter(row => row.asideWidth !== null).length).toBeGreaterThan(0);
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
    expect(values.rootSignal).toBe(theme === 'light' ? '#08666a' : '#45c6ca');
    expect(values.surfaceRadius).toBe('8px');
    expect(values.rootRadius).toBe('8px');
    expect(values.button).toBe('6px');
    expect(values.selectColor).toBe(values.ink);
  });

  // Home: full-width trace, the resume card on the shared edge, the readout beside the main column from 1100px and below it before.
  for (const width of [1440, 1024]) test(`dashboard frame and readout at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/app', 'en');
    const box = (selector: string) => page.locator(selector).first().evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) };
    });
    const [resume, trace, main, aside, brand] = await Promise.all([
      box('#learner-main .vf-l-resume'), box('#learner-main .vf-l-trace-slot'), box('#learner-main [data-area="main"]'), box('#learner-main aside[data-area="aside"]'), box('.vf-bench .vf-brand'),
    ]);
    expect(trace.width).toBe(width);
    expect(resume.x).toBe(40);
    expect(brand.x).toBe(40);
    expect(main.x).toBe(40);
    // Route loading and the fault panel replace the dashboard inside the same home main: they keep the edge too.
    expect(await page.evaluate(() => {
      const stand = document.createElement('div');
      stand.className = 'vf-l-fault';
      document.getElementById('learner-main')!.append(stand);
      const x = Math.round(stand.getBoundingClientRect().x);
      stand.remove();
      return x;
    })).toBe(40);
    if (width >= 1100) {
      expect(aside.width).toBe(280);
      expect(aside.x - main.right).toBe(24);
      expect(aside.top).toBe(main.top);
      expect(aside.right).toBe(width - 40);
    } else {
      expect(aside.x).toBe(40);
      expect(aside.top).toBeGreaterThanOrEqual(main.bottom);
      expect(aside.width).toBe(main.width);
    }
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
      return { name: select.name, scrollWidth: select.scrollWidth, clientWidth: select.clientWidth, text: Math.ceil(canvas.measureText(shown).width), room: Math.floor(room) };
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

    test(`${locale} ${path.split('?')[0]} at 1280: fields and actions share one row`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, path, locale);
      const { fields, actions, selects } = await filterGeometry(page);
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
      const rows = await page.locator('main table.vf-l-dir-table[data-stack] tbody tr').evaluateAll(trs => trs
        .filter(tr => tr.getBoundingClientRect().height > 0)
        .map(tr => {
          const lead = tr.querySelector('td[data-slot="lead"]')!.getBoundingClientRect();
          const body = tr.querySelector('td[data-slot="body"]')!.getBoundingClientRect();
          const beside = Array.from(tr.querySelectorAll('td'))
            .filter(cell => cell.dataset.slot !== 'lead' && getComputedStyle(cell).display !== 'none')
            .filter(cell => {
              const rect = cell.getBoundingClientRect();
              return rect.height > 0 && rect.top < lead.bottom - 1 && rect.bottom > lead.top + 1 && rect.left >= lead.right - 1;
            })
            .map(cell => cell.dataset.slot);
          return { beside, bodyBelow: body.top >= lead.bottom - 1 };
        }));
      expect(rows.length, `${path} rows`).toBeGreaterThan(0);
      for (const row of rows) {
        expect.soft(row.beside.length, `${path} lead shares its line`).toBeGreaterThan(0);
        expect.soft(row.bodyBelow, `${path} title below the lead line`).toBe(true);
      }
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
