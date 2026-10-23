import { expect, test } from '@playwright/test';
import { describeStaffShell, expectUnclipped, messages, shellStrings, withQuery, type StaffRoute } from '../studio-harness/staff-ui-support';

/** Catmin staff shell (`?uiv2=1`) over the admin harness. */
const { vi } = messages;
const ROUTES: StaffRoute[] = [
  { harness: 'admin', key: 'users', path: '/admin/users', locale: 'vi', navigation: vi.adminNav.navigation, link: vi.adminNav.users },
];

describeStaffShell(ROUTES);

test('12px Vietnamese sidebar group labels and the identity row render unclipped at line-height 1.4+', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withQuery('/admin/users'));
  const labels = page.locator('[data-sidebar="group-label"]');
  await expect(labels.filter({ hasText: vi.adminNav.system })).toBeVisible();
  for (const label of await labels.all()) {
    expect((await expectUnclipped(label)).fontSize).toBe(12);
  }
  await expectUnclipped(page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"] .truncate').first());
});

test('the member profile breadcrumb ends with the person, not the raw id; a focused h1 draws no ring', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withQuery('/admin/users'));
  await page.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: vi.common.breadcrumbs, exact: true });
  await expect(breadcrumbs).toContainText('Nguyễn Minh Anh');
  await expect(breadcrumbs).not.toContainText('00000000');
  // The profile loads after the route change, so focus it the way the shell does (tabIndex -1, programmatic).
  const heading = page.locator('#admin-main h1');
  await heading.evaluate((element) => { element.tabIndex = -1; element.focus(); });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
});

test('while a scope switch is in flight the overlay covers the whole page, top bar included', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withQuery('/admin/users', { holdScope: '1' }));
  await page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]').click();
  await page.getByRole('menuitemradio', { name: 'ANS · Hà Nội' }).click();
  const overlay = page.getByRole('status').filter({ hasText: vi.centralAdmin.switchingScope });
  await expect(overlay).toBeVisible();
  // Whatever sits under the banner's controls and the page body is the overlay, so nothing there takes a click.
  const header = page.locator('[data-slot="sidebar-inset"] > header');
  const search = header.getByRole('button', { name: shellStrings.vi.search, exact: true });
  for (const target of [search, page.locator('[data-sidebar="trigger"]'), page.locator('#admin-main h1')]) {
    const box = (await target.boundingBox())!;
    const covered = await overlay.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(covered).toBe(true);
  }
});
