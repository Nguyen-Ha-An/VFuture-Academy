import { expect, test } from '@playwright/test';
import { describeStaffPages, openView, pageShot, type StaffPage } from '../studio-harness/staff-pages-support';
import { expectNoHorizontalScroll, messages, withQuery } from '../studio-harness/staff-ui-support';
import adminMembers from '../../../src/messages/staff-ui/admin-members.json';
import adminOrg from '../../../src/messages/staff-ui/admin-org.json';
import adminMcp from '../../../src/messages/staff-ui/admin-mcp.json';
import studioHome from '../../../src/messages/staff-ui/studio-home.json';

/** Catmin page views in the admin harness (overview, members, schools, roles, audit, library, reviews), inside the staff shell. */
const { vi } = messages;
const members = adminMembers.vi.members;
const org = adminOrg.vi.org;
const mcp = adminMcp.vi.mcp;
const library = studioHome.vi.library;

const PAGES: StaffPage[] = [
  {
    harness: 'admin', key: 'overview', path: '/admin', heading: vi.centralAdmin.overview,
    actions: (page) => [page.getByRole('link', { name: vi.centralAdmin.invite, exact: true })],
  },
  {
    harness: 'admin', key: 'users', path: '/admin/users', heading: vi.adminNav.users, kpis: true,
    actions: (page) => [page.getByRole('button', { name: vi.memberAdmin.inviteMember, exact: true })],
  },
  {
    harness: 'admin', key: 'branches', path: '/admin/branches', heading: vi.centralAdmin.schools, kpis: true,
    actions: (page) => [page.getByRole('button', { name: org.schools.newSchool, exact: true })],
  },
  {
    harness: 'admin', key: 'school', path: '/admin/branches/ans', heading: 'ANS · Hà Nội', kpis: true,
    actions: (page) => [page.getByRole('button', { name: vi.centralAdmin.enterSchool, exact: true })],
  },
  {
    harness: 'admin', key: 'roles', path: '/admin/roles', heading: vi.memberAdmin.rolesPermissions,
    actions: (page) => [page.getByRole('button', { name: org.roles.newRole, exact: true })],
  },
  {
    harness: 'admin', key: 'audit', path: '/admin/audit', heading: vi.centralAdmin.history,
    actions: (page) => [page.getByRole('button', { name: org.audit.apply, exact: true })],
  },
  {
    harness: 'admin', key: 'library', path: '/studio/library', heading: 'Thư viện nội dung',
    actions: (page) => [page.getByRole('button', { name: library.rowActions.replace('{title}', 'Hướng dẫn học tập') })],
  },
  {
    harness: 'admin', key: 'reviews', path: '/studio/reviews', query: { reviews: 'many' }, heading: 'Duyệt nội dung',
    actions: (page) => [page.getByRole('link', { name: 'Xem bản gửi duyệt', exact: true }).first()],
  },
];

describeStaffPages(PAGES);

test.describe('admin page interactions', () => {
  test('school reports retain every metric and the edit action on a phone', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(withQuery('/admin/branches', { lang: 'en', theme: 'light' }));
    const table = page.getByRole('table', { name: 'All schools' });
    const row = table.getByRole('row').filter({ has: page.getByRole('link', { name: 'ANS · Hà Nội', exact: true }) });
    await expect(row).toContainText('Active learners');
    await expect(row).toContainText('Enrollments');
    await expect(row).toContainText('Completion');
    await expect(row).toContainText('Waiting to grade');
    await expect(row).toContainText('Average score');
    await row.getByRole('button', { name: 'Actions for ANS · Hà Nội', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit school' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit school' });
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('ANS · Hà Nội');
    await expectNoHorizontalScroll(page);
    await pageShot(page, info, 'admin-school-edit-320-light', { fullPage: false });
  });

  test('MCP access: block confirmation and status fit at 320px', async ({ page }, info) => {
    const userId = '00000000-0000-4000-8000-000000000101';
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(withQuery('/admin/mcp', { theme: 'light', userId }));
    await expect(page.getByRole('heading', { level: 1, name: mcp.title })).toBeVisible();
    await expect(page.getByText(mcp.available, { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: mcp.block, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: mcp.confirmBlockTitle });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await pageShot(page, info, 'admin-mcp-320-light-confirm', { fullPage: false });
    await dialog.getByRole('button', { name: mcp.block, exact: true }).click();
    await expect(page.getByText(mcp.blocked, { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('members: ?invite=1 opens the invite sheet, closing it drops the parameter; the directory pages with hasMore', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The open sheet is modal, so the page (h1 included) is hidden from the accessibility tree until it closes.
    await page.goto(withQuery('/admin/users', { theme: 'light', invite: '1' }));
    const sheet = page.getByRole('dialog', { name: vi.memberAdmin.inviteMember });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(members.inviteDescription)).toBeVisible();
    await pageShot(page, info, 'admin-users-1440-light-invite-sheet', { fullPage: false });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/invite=1/);
    await expect(page.getByRole('heading', { level: 1, name: vi.adminNav.users })).toBeVisible();

    // 26 members at 20 per page: "Page 1" with a next link, no total.
    const directory = page.getByRole('table').first();
    await expect(directory.getByRole('row')).toHaveCount(21);
    await page.getByRole('button', { name: /Tiếp/ }).first().click();
    await expect(directory.getByRole('row')).toHaveCount(7);
    await expectNoHorizontalScroll(page);
  });

  test('schools: "New school" opens the sheet and Escape closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[2]!, { theme: 'light' });
    await page.getByRole('button', { name: org.schools.newSchool, exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('#new-branch-id')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('library: "…" → review workflow opens its sheet with the workflow panel, and closes', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[6]!, { theme: 'light' });
    await expect(page.getByText(/1–25/)).toContainText('30');
    await page.getByRole('button', { name: library.rowActions.replace('{title}', 'Hướng dẫn học tập') }).click();
    await page.getByRole('menuitem', { name: library.reviewWorkflow }).click();
    const sheet = page.getByRole('dialog', { name: library.reviewWorkflow });
    await expect(sheet).toBeVisible();
    await pageShot(page, info, 'admin-library-1440-light-workflow-sheet', { fullPage: false });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('reviews: selecting a request opens its full-screen authorized route', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[7]!, { theme: 'light' });
    const decisions = page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true });
    await expect(decisions).toHaveCount(4);
    await page.getByRole('link', { name: 'Xem bản gửi duyệt', exact: true }).nth(1).click();
    await expect(page).toHaveURL(/\/studio\/reviews\/00000000-0000-4000-8000-000000000110\?/);
    const detail = page.getByRole('region', { name: 'Xem bản gửi duyệt: Python cơ bản' });
    await expect(detail).toBeVisible();
    await expect(decisions).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: studioHome.vi.reviews.listTitle })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Trở lại danh sách duyệt' })).toBeInViewport();
    await expect(page.locator('.canvas-global-nav')).toHaveCount(0);
    await pageShot(page, info, 'admin-reviews-1440-light-detail');
  });
});
