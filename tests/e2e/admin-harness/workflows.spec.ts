import { expect, test, type Page } from '@playwright/test';

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
  await page.goto('/admin/users');
  await page.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Học tập', exact: true }).click();
  await expect(page.getByText('Python cơ bản', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('member-learning.png'), fullPage: true });
});
