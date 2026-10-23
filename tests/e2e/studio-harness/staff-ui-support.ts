import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';
import shellCommand from '../../../src/messages/staff-ui/shell-command.json';
import shellCore from '../../../src/messages/staff-ui/shell-core.json';

/**
 * Shared checks for the Catmin staff shell (StaffWorkspaceShell) in the Vite harnesses, which
 * render it with `?uiv2=1` (tests/e2e/studio-harness/src/staff-chrome.ts supplies the chrome).
 * Screenshots go to `STAFF_UI_SHOTS_DIR` when set, else the test's output folder, named
 * `<harness>-<route>-<width>-<theme>[-state].png`.
 */
export type StaffRoute = {
  harness: 'studio' | 'admin';
  /** Short route name used in test titles and screenshot names. */
  key: string;
  path: string;
  locale: 'vi' | 'en';
  /** Accessible name of the sidebar's navigation landmark. */
  navigation: string;
  /** A nav link that must keep its accessible name in the collapsed rail. */
  link: string;
  /** The course editor forces the icon rail and fits the viewport. */
  editor?: boolean;
  /** Record title the page registers for the last crumb (Courses › course title). */
  crumbTitle?: string;
  /** Axe findings (`id target`) known to predate the shell on this route's page content. */
  knownFindings?: string[];
};

/**
 * CodeMirror's scroller (course JSON editor) has no focusable wrapper; axe reports it under the
 * legacy shells too, and the editor itself is out of scope until the course workspace PR.
 */
export const KNOWN_CODEMIRROR_FINDING = 'scrollable-region-focusable .cm-scroller';

export const messages = { vi, en } as const;
export const shellStrings = {
  vi: { toggle: shellCore.vi.core.toggleSidebar, search: shellCommand.vi.command.trigger, palette: shellCommand.vi.command.title, menu: vi.common.menu },
  en: { toggle: shellCore.en.core.toggleSidebar, search: shellCommand.en.command.trigger, palette: shellCommand.en.command.title, menu: en.common.menu },
} as const;

export const IDENTITY_NAME = 'Nguyễn Thị Thanh Hương';
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export function withQuery(path: string, query: Record<string, string> = {}) {
  const params = new URLSearchParams({ uiv2: '1', ...query });
  return `${path}${path.includes('?') ? '&' : '?'}${params}`;
}

export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.STAFF_UI_SHOTS_DIR || info.outputDir;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

export const shell = (page: Page) => page.locator('.vf-staff');
export const trigger = (page: Page) => page.locator('[data-sidebar="trigger"]');
export const userMenuButton = (page: Page) => page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]');

/** WCAG relative luminance of an element's computed colour, resolved through a canvas so oklch/hsl/rgb all compare. */
export async function luminance(target: Locator, property: 'backgroundColor' | 'color' = 'backgroundColor'): Promise<number> {
  const [r, g, b] = await target.evaluate((element, prop) => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.fillStyle = '#808080';
    context.fillStyle = getComputedStyle(element)[prop];
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, property);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** Serious and critical axe findings (WCAG 2.2 A/AA) on the whole page, open menus included, minus exact known ones. */
export async function seriousAxeFindings(page: Page, known: string[] = []) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) => violation.nodes
      .filter((node) => !known.includes(`${violation.id} ${node.target.join(' ')}`))
      .map((node) => `${violation.id} (${violation.impact}): ${node.target.join(' ')}`));
}

/** Waits for enter animations (fade/zoom/slide) to finish, so colour and layout checks read the settled state. */
export async function settle(target: Locator) {
  await target.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

async function openCommandPalette(page: Page, route: StaffRoute) {
  // The shortcut listener lives in the top bar; wait for it before pressing.
  await expect(page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: shellStrings[route.locale].search, exact: true })).toBeVisible();
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: shellStrings[route.locale].palette });
  await expect(palette).toBeVisible();
  await settle(palette);
  return palette;
}

async function openUserMenu(page: Page) {
  await userMenuButton(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await settle(menu);
  return menu;
}

/** Text elements must keep a line-height of at least 1.4 and show their full height (no clipped diacritics). */
export async function expectUnclipped(target: Locator) {
  const metrics = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  });
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.4 - 0.01);
  return metrics;
}

/**
 * Declares the shared shell suite for a harness. `prepare` installs per-page stubs (e.g. the
 * course preview endpoint) before navigation.
 */
export function describeStaffShell(routes: StaffRoute[], prepare: (page: Page) => Promise<void> = async () => {}) {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  for (const route of routes) {
    const strings = shellStrings[route.locale];
    const name = (width: number, theme: string, state?: string) => [route.harness, route.key, width, theme, state].filter(Boolean).join('-');

    test.describe(`${route.harness} ${route.key} (${route.path})`, () => {
      if (route.editor) {
        test('the course editor forces the icon rail and fits the viewport without page scroll', async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(withQuery(route.path));
          await expect(shell(page)).toHaveAttribute('data-state', 'collapsed');
          await expect(page.getByRole('navigation', { name: route.navigation }).getByRole('link', { name: route.link, exact: true })).toBeVisible();
          await expect(page.locator('#studio-preview h3')).toBeVisible();
          if (route.crumbTitle) {
            const crumbs = page.getByRole('navigation', { name: messages[route.locale].common.breadcrumbs, exact: true });
            await expect(crumbs.getByRole('link', { name: route.link, exact: true })).toBeVisible();
            await expect(crumbs.locator('[aria-current="page"]')).toHaveText(route.crumbTitle);
          }
          const layout = await page.evaluate(() => ({
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight,
            mainBottom: document.getElementById('studio-main')!.getBoundingClientRect().bottom,
          }));
          expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight);
          expect(layout.mainBottom).toBeLessThanOrEqual(layout.innerHeight + 1);
          await expectNoHorizontalScroll(page);
          // Toggling inside the editor is temporary: no cookie is written.
          await trigger(page).click();
          await expect(shell(page)).toHaveAttribute('data-state', 'expanded');
          expect((await page.context().cookies()).some((cookie) => cookie.name === 'sidebar_state')).toBe(false);
        });

        test('dark: the preview pane stays a light learner island, the JSON editor takes the staff dark theme', async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(withQuery(route.path, { theme: 'dark' }));
          await expect(page.locator('#studio-preview h3')).toBeVisible();
          const island = page.locator('#studio-preview .vf-staff-preview-island');
          expect(await luminance(page.locator('body'))).toBeLessThan(0.05);
          expect(await luminance(island)).toBeGreaterThan(0.85);
          expect(await luminance(page.locator('#studio-preview h3'), 'color')).toBeLessThan(0.1);
          expect(await island.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/^"?Be Vietnam Pro"?/);
          expect(await island.evaluate((element) => getComputedStyle(element).colorScheme)).toBe('light');
          expect(await page.locator('main').evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/^"?Inter"?/);
          // The JSON editor (CodeMirror) follows the staff theme: dark surface, light monochrome text, Plex Mono.
          expect(await luminance(page.locator('.cm-editor'))).toBeLessThan(0.05);
          expect(await luminance(page.locator('.cm-content'), 'color')).toBeGreaterThan(0.7);
          expect(await luminance(page.locator('.cm-line span').first(), 'color')).toBeGreaterThan(0.7);
          expect(await page.locator('.cm-scroller').evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/^"?IBM Plex Mono"?/);
        });
      } else {
        test('1440: the rail starts expanded, collapses on toggle, survives a reload and keeps link names', async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(withQuery(route.path));
          await expect(shell(page)).toHaveAttribute('data-state', 'expanded');
          await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCSS('width', '256px');
          // A fresh load moves no focus (no ring around the h1; the skip link stays first in the tab order).
          expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
          // 56px banner plus a 1px hairline, level with the sidebar header's.
          const banner = await page.locator('[data-slot="sidebar-inset"] > header').boundingBox();
          const sidebarHeader = await page.locator('[data-slot="sidebar-header"]').boundingBox();
          expect(banner?.height).toBe(57);
          expect(sidebarHeader?.height).toBe(57);
          await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
          await expect(trigger(page)).toHaveAccessibleName(strings.toggle);

          await trigger(page).click();
          await expect(shell(page)).toHaveAttribute('data-state', 'collapsed');
          await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
          expect((await page.context().cookies()).find((cookie) => cookie.name === 'sidebar_state')?.value).toBe('false');

          await page.reload();
          await expect(shell(page)).toHaveAttribute('data-state', 'collapsed');
          await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCSS('width', '48px');
          const link = page.getByRole('navigation', { name: route.navigation }).getByRole('link', { name: route.link, exact: true });
          await expect(link).toBeVisible();
          await expect(link).toHaveAccessibleName(route.link);
          await expectNoHorizontalScroll(page);
        });
      }

      test('390: "Open menu" opens the drawer, Escape closes it and focus returns to the trigger', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(withQuery(route.path));
        const menuButton = page.getByRole('button', { name: strings.menu, exact: true });
        await expect(menuButton).toBeVisible();
        await menuButton.click();
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole('navigation', { name: route.navigation }).getByRole('link', { name: route.link, exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(menuButton).toBeFocused();
        await expectNoHorizontalScroll(page);
      });

      test('dark: follows the OS with theme=system and pins with theme=dark, portalled menus included', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(withQuery(route.path));
        await expect(shell(page)).not.toHaveAttribute('data-theme', /.+/);
        expect(await luminance(page.locator('body'))).toBeLessThan(0.05);
        expect(await luminance(page.locator('[data-slot="sidebar-inner"]'))).toBeLessThan(0.05);
        expect(await luminance(await openUserMenu(page))).toBeLessThan(0.05);
        await page.keyboard.press('Escape');

        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(withQuery(route.path, { theme: 'dark' }));
        await expect(shell(page)).toHaveAttribute('data-theme', 'dark');
        expect(await luminance(page.locator('body'))).toBeLessThan(0.05);
        const menu = await openUserMenu(page);
        expect(await luminance(menu)).toBeLessThan(0.05);
        expect(await luminance(menu.getByRole('menuitem').first(), 'color')).toBeGreaterThan(0.7);
        await page.keyboard.press('Escape');

        // An explicit light pin beats a dark OS.
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(withQuery(route.path, { theme: 'light' }));
        expect(await luminance(page.locator('body'))).toBeGreaterThan(0.9);
      });

      test('reflow: no horizontal scroll at 320px or at 200% zoom', async ({ page, browser }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto(withQuery(route.path));
        await expect(shell(page)).toBeVisible();
        await expectNoHorizontalScroll(page);

        // Browser zoom at 200% on a 1440×900 window lays out a 720×450 CSS-pixel viewport at
        // device scale factor 2; that is the context below (media queries see 720px too).
        const zoomed = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
        try {
          const zoomedPage = await zoomed.newPage();
          await prepare(zoomedPage);
          await zoomedPage.goto(withQuery(route.path));
          await expect(shell(zoomedPage)).toBeVisible();
          expect(await zoomedPage.evaluate(() => devicePixelRatio)).toBe(2);
          await expectNoHorizontalScroll(zoomedPage);
        } finally {
          await zoomed.close();
        }
      });

      for (const theme of ['light', 'dark'] as const) {
        test(`axe (${theme}): no serious or critical findings with the user menu and ⌘K open`, async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(withQuery(route.path, { theme }));
          await expect(shell(page)).toBeVisible();
          expect(await seriousAxeFindings(page, route.knownFindings)).toEqual([]);
          await openUserMenu(page);
          expect(await seriousAxeFindings(page, route.knownFindings)).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(page.getByRole('menu')).toBeHidden();
          await openCommandPalette(page, route);
          expect(await seriousAxeFindings(page, route.knownFindings)).toEqual([]);
        });
      }

      test('screenshots', async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(withQuery(route.path, { theme: 'light', sidebar: 'expanded' }));
        await expect(shell(page)).toBeVisible();
        await shot(page, info, name(1440, 'light', route.editor ? 'editor' : 'expanded'));
        await page.goto(withQuery(route.path, { theme: 'light', sidebar: 'collapsed' }));
        await expect(shell(page)).toHaveAttribute('data-state', 'collapsed');
        await shot(page, info, name(1440, 'light', 'collapsed'));
        await page.goto(withQuery(route.path, { theme: 'dark', sidebar: 'expanded' }));
        await expect(shell(page)).toHaveAttribute('data-theme', 'dark');
        await shot(page, info, name(1440, 'dark', route.editor ? 'editor' : 'expanded'));
        await page.goto(withQuery(route.path, { theme: 'light', sidebar: 'expanded' }));
        await openCommandPalette(page, route);
        await shot(page, info, name(1440, 'light', 'cmdk'));
        await page.keyboard.press('Escape');
        await openUserMenu(page);
        await shot(page, info, name(1440, 'light', 'user-menu'));
        await page.keyboard.press('Escape');

        // Attention popover open (Catmin's notifications).
        const attention = page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: new RegExp(`^${shellCommand[route.locale].command.attention.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
        if (await attention.count()) {
          await attention.first().click();
          await settle(page.locator('[data-slot="popover-content"]'));
          await shot(page, info, name(1440, 'light', 'attention'));
          await page.keyboard.press('Escape');
        }

        // Collapsed rail: a nav tooltip on hover.
        await page.goto(withQuery(route.path, { theme: 'light', sidebar: 'collapsed' }));
        await expect(shell(page)).toHaveAttribute('data-state', 'collapsed');
        await page.getByRole('navigation', { name: route.navigation }).getByRole('link', { name: route.link, exact: true }).hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toBeVisible();
        await settle(tooltip);
        await shot(page, info, name(1440, 'light', 'rail-tooltip'));

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(withQuery(route.path, { theme: 'light' }));
        await expect(page.getByRole('button', { name: strings.menu, exact: true })).toBeVisible();
        await shot(page, info, name(390, 'light', 'drawer-closed'));
        await page.getByRole('button', { name: strings.menu, exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page.getByRole('dialog'));
        // The pointer that tapped "Open menu" would otherwise rest on the switcher and paint its hover.
        await page.mouse.move(380, 830);
        await shot(page, info, name(390, 'light', 'drawer-open'));
        await page.goto(withQuery(route.path, { theme: 'dark' }));
        await page.getByRole('button', { name: strings.menu, exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page.getByRole('dialog'));
        await page.mouse.move(380, 830);
        await shot(page, info, name(390, 'dark', 'drawer-open'));
      });
    });
  }
}
