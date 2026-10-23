import { expect, test } from '@playwright/test';

test('redesigned member profile uses the person name in breadcrumbs', async ({ page }, info) => {
  await page.goto('/admin/users?redesigned=1');
  await page.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Đường dẫn trang', exact: true });
  await expect(breadcrumbs).toContainText('Nguyễn Minh Anh');
  await expect(breadcrumbs).not.toContainText('00000000');
  await page.screenshot({ path: info.outputPath('staff-member-profile.png'), fullPage: true });
});
