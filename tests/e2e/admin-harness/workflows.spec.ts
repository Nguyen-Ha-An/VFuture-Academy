import { expect, test, type Page } from '@playwright/test';
import { withQuery } from '../studio-harness/staff-ui-support';

async function openPublication(page: Page) {
  await page.getByRole('button', { name: 'Xem bản gửi duyệt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xem bản gửi duyệt: huong-dan-hoc-tap' })).toBeVisible();
  await page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ghi chú duyệt (bắt buộc)').fill('Đã kiểm tra bản nội dung và đối tượng truy cập.');
  return dialog;
}

test('reviewed resource approves and publishes atomically and follows confirmed state', async ({ page }, info) => {
  await page.goto('/studio/reviews');
  const dialog = await openPublication(page);
  await dialog.getByRole('button', { name: 'Duyệt và xuất bản', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByText('Đã xuất bản', { exact: false }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('review-published.png'), fullPage: true });
});

test('failed atomic publication preserves the decision and can be retried on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/studio/reviews?failPublishOnce=1');
  const dialog = await openPublication(page);
  await dialog.getByRole('button', { name: 'Duyệt và xuất bản', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Không lưu được');
  await expect(page.getByRole('heading', { name: 'Xem bản gửi duyệt: huong-dan-hoc-tap' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('review-retry-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true }).click();
  await dialog.getByLabel('Ghi chú duyệt (bắt buộc)').fill('Đã kiểm tra và thử lại xuất bản.');
  await dialog.getByRole('button', { name: 'Duyệt và xuất bản', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Duyệt và xuất bản', exact: true })).toHaveCount(0);
});

test('member directory opens the matching profile and retains the scoped learning data', async ({ page }, info) => {
  const memberId = '00000000-0000-4000-8000-000000000101';
  const memberPath = `/admin/users/${memberId}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withQuery('/admin/users', { lang: 'vi', theme: 'light', scope: 'branch:ans', scenario: 'dense' }));
  await expect(page.locator('.vf-staff.vf-canvas')).toBeVisible();
  const person = page.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true });
  await expect(person).toHaveAttribute('href', new RegExp(`^${memberPath}(?:\\?|$)`));
  await person.click();
  await expect(page).toHaveURL(new RegExp(`${memberPath}(?:\\?|$)`));
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh', exact: true })).toBeVisible();
  await expect(page.getByText('Hoạt động', { exact: true })).toBeVisible();
  // Inspect the component's requests before making any additional contract read.
  const requestedScopes = await page.evaluate((id) => window.__adminFixture.requests
    .filter((request) => request.method === 'GET' && request.path === `/api/v1/admin/users/${id}`)
    .map((request) => request.scope), memberId);
  expect(requestedScopes.length).toBeGreaterThan(0);
  expect(requestedScopes.every((scope) => scope === 'branch:ans')).toBe(true);
  await page.getByRole('tab', { name: 'Học tập', exact: true }).click();
  const course = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Python cơ bản / Python foundations', exact: true }) });
  await expect(course.getByRole('rowheader', { name: 'Python cơ bản / Python foundations', exact: true })).toBeVisible();
  await expect(course.getByRole('cell', { name: '3/8', exact: true })).toBeVisible();
  await expect(course.getByText('Đang học', { exact: true })).toBeVisible();
  // These independently expected fixture values check the historical record and rights;
  // they do not infer the expected course from whatever response happens to arrive.
  const record = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/admin/users/${id}?scope=branch%3Aans`);
    if (!response.ok) throw new Error(`Fixture member read failed: ${response.status}`);
    return (await response.json()).data;
  }, memberId);
  expect(record).toMatchObject({ id: memberId, actions: { readLearning: true, readSubmissions: false } });
  expect(record.accountStatus).toBe('active');
  expect(record.memberships).toEqual([expect.objectContaining({ branchId: 'ans', status: 'active', isPrimary: true })]);
  expect(record.learning).toEqual([expect.objectContaining({ courseId: 'python-foundations', courseVersionId: 'version-2026-09', branchId: 'ans', displayTitle: 'Python cơ bản / Python foundations', completedLessons: 3, totalLessons: 8, status: 'active' })]);
  expect(record).not.toHaveProperty('submissions');
  await page.screenshot({ path: info.outputPath('member-learning.png'), fullPage: true });
});
