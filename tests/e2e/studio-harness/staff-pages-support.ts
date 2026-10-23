import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalScroll, seriousAxeFindings, settle, shell, withQuery } from './staff-ui-support';

/**
 * Shared checks for the Catmin page views (PR 3-10) rendered by the Vite harnesses inside the
 * staff shell (`?uiv2=1`). Screenshots go to `STAFF_PAGES_SHOTS_DIR` when set, else the test's
 * output folder, named `<harness>-<route>-<width>-<theme>[-state].png`.
 */
export type StaffPage = {
  harness: 'studio' | 'admin';
  /** Short route name used in test titles and screenshot names. */
  key: string;
  path: string;
  /** Extra query (besides `uiv2=1`). */
  query?: Record<string, string>;
  /** The page's h1. */
  heading: string | RegExp;
  /** The page shows a KPI row (StatGrid renders a <dl> of <dt>/<dd> pairs). */
  kpis?: boolean;
  /** Key actions that must be visible at every width. */
  actions?: (page: Page) => Locator[];
  /** Per-page network stubs installed before navigation. */
  prepare?: (page: Page) => Promise<void>;
  /** Axe findings (`id target`) known to predate this page view. */
  knownFindings?: string[];
};

/** Full-page by default; pass `fullPage: false` while a modal sheet is open (the page behind it is scroll-locked). */
export async function pageShot(page: Page, info: TestInfo, name: string, { fullPage = true } = {}) {
  const dir = process.env.STAFF_PAGES_SHOTS_DIR || info.outputDir;
  mkdirSync(dir, { recursive: true });
  // Sheets and menus slide in; shoot only once every animation has settled.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}

/** Every KPI row is a description list whose terms each carry a value. */
export async function expectKpiList(page: Page) {
  const list = page.locator('#' + (await mainId(page)) + ' dl').first();
  await expect(list).toBeVisible();
  const terms = list.locator('dt');
  expect(await terms.count()).toBeGreaterThanOrEqual(3);
  expect(await list.locator('dd').count()).toBeGreaterThanOrEqual(await terms.count());
}

async function mainId(page: Page) {
  return (await page.locator('main[id]').first().getAttribute('id'))!;
}

/** Waits for the view to settle: h1 visible and no chart skeleton left. */
export async function openView(page: Page, route: StaffPage, query: Record<string, string> = {}) {
  await page.goto(withQuery(route.path, { ...route.query, ...query }));
  await expect(shell(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
  await expect(page.locator('[data-slot="chart-skeleton"]')).toHaveCount(0);
  await settle(page.locator('main'));
}

export function describeStaffPages(routes: StaffPage[]) {
  for (const route of routes) {
    test.describe(`${route.harness} page ${route.key} (${route.path})`, () => {
      test.beforeEach(async ({ page }) => {
        await route.prepare?.(page);
      });

      for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light']] as const) {
        test(`${width} ${theme}: fits without horizontal scroll, KPI semantics and key actions${width === 1440 ? ', no serious axe findings' : ''}`, async ({ page }, info) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await openView(page, route, { theme });
          await expectNoHorizontalScroll(page);
          if (route.kpis) await expectKpiList(page);
          for (const action of route.actions?.(page) ?? []) await expect(action).toBeVisible();
          if (width === 1440) expect(await seriousAxeFindings(page, route.knownFindings)).toEqual([]);
          await pageShot(page, info, [route.harness, route.key, width, theme].join('-'));
        });
      }
    });
  }
}
