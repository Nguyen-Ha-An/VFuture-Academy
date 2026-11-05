import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
test.afterEach(async ({ page }, info) => {
  const errors = browserErrors.get(page) ?? [];
  await info.attach('browser-runtime-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
  expect(errors, 'console/page/hydration errors').toEqual([]);
});


test('Next 15 SSR hydrates actual InstUI controls with teal themes and Radix DOM refs', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('Academy InstUI Next 15 proof');
  expect(html).toContain('data-emotion="academy-instui');
  expect(html).toContain('Course title');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  const mixedAction = page.getByRole('button', { name: 'Icon action', exact: true });
  const iconLayout = await mixedAction.locator('svg').evaluate(icon => {
    const parent = icon.parentElement!;
    const range = document.createRange();
    range.selectNodeContents(parent.childNodes[parent.childNodes.length - 1]!);
    const text = range.getBoundingClientRect();
    const image = icon.getBoundingClientRect();
    return { gap: text.left - image.right, alignment: Math.abs((text.top + text.bottom) / 2 - (image.top + image.bottom) / 2) };
  });
  expect(iconLayout.gap).toBeGreaterThan(0);
  expect(iconLayout.alignment).toBeLessThan(4);
  await page.getByRole('button', { name: 'Count 0', exact: true }).click();
  const counter = page.getByRole('button', { name: 'Count 1', exact: true });
  await expect(counter).toBeVisible();
  const backgrounds = () => counter.evaluate(element => [element, ...element.querySelectorAll('*')].map(node => getComputedStyle(node).backgroundColor));
  await counter.hover();
  await expect.poll(backgrounds).toContain('rgb(7, 90, 94)');
  const hoverAccessibility = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
  expect(hoverAccessibility.violations).toEqual([]);
  await page.getByRole('heading').hover();
  await expect.poll(backgrounds).toContain('rgb(8, 102, 106)');
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
  await page.getByRole('heading').hover();
  await expect.poll(backgrounds).toContain('rgb(114, 213, 215)');
  await page.getByRole('textbox', { name: 'Course title', exact: true }).fill('Bilingual lesson');
  await page.getByRole('combobox', { name: 'Content language', exact: true }).click();
  await page.getByRole('option', { name: 'Tiếng Việt', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Required', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#destination')).toHaveText('Bilingual lesson · Draft · vi · Required');
  const trigger = page.getByRole('button', { name: 'Actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Export draft' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

for (const scenario of [{ route: '/studio/courses', width: 1440, locale: 'en', theme: 'light' }, { route: '/app/courses/proof-course', width: 1440, locale: 'en', theme: 'light' }, { route: '/app/courses/proof-course', width: 390, locale: 'vi', theme: 'dark' }] as const) {
  test(`actual source ${scenario.route} hydrates native framework at ${scenario.width}px in ${scenario.locale}`, async ({ page }) => {
    const url = `${scenario.route}?lang=${scenario.locale}&theme=${scenario.theme}`;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (scenario.width < 640) await page.addInitScript(() => {
      const diagnostics: unknown[] = [];
      (window as unknown as { __courseEscapeDiagnostics: unknown[] }).__courseEscapeDiagnostics = diagnostics;
      window.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const active = document.activeElement;
        const target = event.target instanceof Element ? event.target : null;
        const root = document.querySelector('.canvas-course-layout');
        diagnostics.push({ phase: event.eventPhase, targetTag: target?.tagName, targetId: target?.id, activeTag: active?.tagName, activeId: active?.id, activeInsideCourseRoot: !!active && !!root?.contains(active), targetInsideCourseRoot: !!target && !!root?.contains(target), defaultPrevented: event.defaultPrevented, expanded: document.querySelector('.canvas-course-navigation-toggle button')?.getAttribute('aria-expanded') });
      }, true);
    });
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const htmlResponse = await page.goto(url);
    if (!htmlResponse) throw new Error('Expected an actual framework document response.');
    expect(htmlResponse.ok()).toBe(true);
    const html = await htmlResponse.text();
    await test.info().attach('server-markup', { body: html, contentType: 'text/html' });
    expect(/<p[^>]*data-testid="server-content"[^>]*>Server-rendered course content\.<\/p>/.test(html), 'actual server child DOM').toBe(true);
    expect(html.includes('data-emotion="academy-instui'), 'server Emotion CSS').toBe(true);
    expect(html.includes('data-cid="SideNavBar"'), 'server data-cid="SideNavBar"').toBe(true);
    expect(html.includes('data-cid="DrawerLayout"'), 'server data-cid="DrawerLayout"').toBe(true);
    expect(html.includes('role="tree"'), 'server role="tree"').toBe(true);
    expect(/<progress\b[^>]*aria-label="Course progress"/.test(html), 'native progress SSR DOM').toBe(true);
    // InstUI Responsive intentionally defers its render prop until element measurement.
    // Current source table rows are client-rendered; this is recorded, not called SSR data.
    test.info().annotations.push({ type: 'element-responsive-ssr', description: html.includes('Course records') ? 'Table present in server markup.' : 'Known source boundary: table waits for client measurement; no non-JS data fallback.' });
    await expect(page.getByTestId('server-content')).toHaveText('Server-rendered course content.');
    await expect(page.getByTestId('native-composition')).toHaveAttribute('data-framework-hydrated', 'true');
    const serverFrameworkId = html.match(/data-framework-root-id="([^"]+)"/)?.[1];
    const serverNativeId = html.match(/data-native-root-id="([^"]+)"/)?.[1];
    if (!serverFrameworkId || !serverNativeId) throw new Error('Expected server-rendered React ID probes.');
    await expect(page.locator('[data-framework-root-id]')).toHaveAttribute('data-client-framework-id', serverFrameworkId);
    await expect(page.getByTestId('native-composition')).toHaveAttribute('data-client-native-id', serverNativeId);

    if (scenario.width < 640) {
      const menu = page.getByRole('button', { name: scenario.locale === 'vi' ? 'Mở menu' : 'Open menu', exact: true });
      await menu.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation', { name: scenario.locale === 'vi' ? 'Điều hướng toàn cục' : 'Global navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
    } else await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
    expect(await page.locator('[data-cid~="SideNavBar"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-cid~="DrawerLayout"]').count()).toBeGreaterThan(0);
    if (!scenario.route.startsWith('/studio') && scenario.width === 1440) {
      await page.waitForTimeout(1250);
      await expect(page.getByRole('navigation', { name: 'Course destinations' }).getByRole('link', { name: 'Overview', exact: true })).not.toBeFocused();
    }
    const tabs = page.getByRole('tablist', { name: 'Course sections' });
    await tabs.getByRole('tab', { name: 'Modules', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Recorded results' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Modules', exact: true }).click();
    const introduction = page.getByRole('treeitem', { name: 'Introduction', exact: true }).getByRole('button');
    await introduction.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Selected module item')).toHaveText('introduction');
    await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('value', '2');
    await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('max', '5');
    const table = page.getByRole('table', { name: 'Course records' });
    const tableParent = table.locator('..');
    await expect(table).toHaveJSProperty('tagName', scenario.width < 640 ? 'DIV' : 'TABLE');
    await expect(table).toBeAttached();
    await expect(table).toBeVisible();
    await expect(tableParent).toBeAttached();
    await expect(tableParent).toBeVisible();
    const initialTableWidth = await tableParent.evaluate(element => element.getBoundingClientRect().width);
    expect(initialTableWidth).toBeGreaterThan(0);
    await expect(table).toContainText('8 / 10');
    await expect(table).toContainText('Pending');
    if (scenario.route.startsWith('/studio')) {
      const navigationToggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
      await navigationToggle.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.vf-staff')).toHaveAttribute('data-state', 'collapsed');
      await page.keyboard.press('Enter');
      await expect(page.locator('.vf-staff')).toHaveAttribute('data-state', 'expanded');
    }
    if (scenario.width < 640) {
      await expect(table.locator('th')).toHaveCount(0);
      await expect(table).toContainText('Status');
      const courseNavigation = page.getByRole('button', { name: 'Course navigation', exact: true });
      await courseNavigation.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation', { name: 'Course destinations' })).toBeVisible();
      await page.keyboard.press('Escape');
      const escapeDiagnostics = await page.evaluate(() => ({ events: (window as unknown as { __courseEscapeDiagnostics?: unknown[] }).__courseEscapeDiagnostics, expanded: document.querySelector('.canvas-course-navigation-toggle button')?.getAttribute('aria-expanded') }));
      console.log('EARLY_COURSE_ESCAPE', JSON.stringify(escapeDiagnostics));
      await test.info().attach('early-course-escape', { body: JSON.stringify(escapeDiagnostics), contentType: 'application/json' });
      await expect(page.getByRole('navigation', { name: 'Course destinations' })).toBeHidden();
      await expect(courseNavigation).toHaveAttribute('aria-expanded', 'false');
      await expect(courseNavigation).toBeFocused();
      // A separate cycle covers settled automatic focus without weakening the immediate Escape contract above.
      await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation', { name: 'Course destinations' })).toBeVisible();
      await expect(page.getByRole('button', { name: scenario.locale === 'vi' ? 'Đóng' : 'Close', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('navigation', { name: 'Course destinations' })).toBeHidden();
      await expect(courseNavigation).toHaveAttribute('aria-expanded', 'false');
      await expect(courseNavigation).toBeFocused();
    } else await expect(table.locator('th')).toHaveCount(3);
    if (!scenario.route.startsWith('/studio') && scenario.width === 1440) {
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(page.getByLabel('Selected module item')).toHaveText('introduction');
      await expect(table).toHaveJSProperty('tagName', 'DIV');
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByLabel('Selected module item')).toHaveText('introduction');
      await expect(page.locator('.canvas-course-layout')).toHaveAttribute('data-wide', 'true');
      await expect(table).toHaveJSProperty('tagName', 'TABLE');
      await expect(table).toBeAttached();
      await expect(table).toBeVisible();
      await expect(tableParent).toBeAttached();
      await expect(tableParent).toBeVisible();
      let returnedTableWidth = 0;
      await expect.poll(async () => {
        returnedTableWidth = await tableParent.evaluate(element => element.getBoundingClientRect().width);
        return returnedTableWidth;
      }).toBeCloseTo(initialTableWidth, 1);
      const layoutState = await page.locator('.canvas-course-layout').getAttribute('data-wide');
      console.log('RESPONSIVE_RESIZE', JSON.stringify({ initialTableWidth, returnedTableWidth, viewport: page.viewportSize(), layoutState }));
      await test.info().attach('responsive-resize-measurements', { body: JSON.stringify({ initialTableWidth, returnedTableWidth, layoutState }), contentType: 'application/json' });
    }
    const openSettings = page.getByRole('button', { name: 'Open course settings', exact: true });
    await openSettings.click();
    const dialog = page.getByRole('dialog', { name: 'Course settings', exact: true });
    const policy = dialog.getByRole('combobox', { name: 'Deadline policy', exact: true });
    await policy.scrollIntoViewIfNeeded();
    await expect.poll(() => dialog.getByTestId('settings-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await policy.click();
    const extended = dialog.getByRole('option', { name: 'Extended', exact: true });
    await expect(extended).toBeVisible();
    // Native Position first measures at -9999em. Visibility alone does not mean
    // placement has finished; all containment bounds must settle before clicking.
    await expect(async () => {
      const popupBounds = await extended.boundingBox();
      const dialogBounds = await dialog.boundingBox();
      expect(popupBounds).not.toBeNull();
      expect(dialogBounds).not.toBeNull();
      expect(popupBounds!.y).toBeGreaterThanOrEqual(dialogBounds!.y - 1);
      expect(popupBounds!.y + popupBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height + 1);
      expect(popupBounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x - 1);
      expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width + 1);
    }).toPass({ timeout: 5000 });
    await extended.click();
    await expect(dialog).toBeVisible();
    await expect(policy).toHaveValue('Extended');
    await policy.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('option', { name: 'Extended', exact: true })).toBeHidden();
    await expect(policy).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(openSettings).toBeFocused();
    expect(errors).toEqual([]);
  });
}
