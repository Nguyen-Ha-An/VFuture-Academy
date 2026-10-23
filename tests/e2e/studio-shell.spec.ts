import { expect, test } from './support/fixtures';

test.describe('@main-unique Studio and Admin shell smoke', () => {
  test.use({ role: 'admin' });
  test.setTimeout(90_000);

  test('keeps authoring in Studio and routes legacy administration paths into Studio', async ({ rolePage: page }) => {
    await page.goto('/studio/courses', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const navigation = page.getByRole('navigation', { name: 'Studio navigation' });
    await expect(navigation.getByRole('link', { name: 'Courses', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Courses', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New course', exact: true })).toBeVisible();

    // Media is a section of the content library (studio-navigation.ts children), not its own sidebar entry.
    await navigation.getByRole('link', { name: 'Content library', exact: true }).click();
    await expect(page).toHaveURL(/\/studio\/library$/, { timeout: 20_000 });
    await page.goto('/studio/media', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Media', exact: true })).toBeVisible();
    await expect(page.getByLabel('Choose files', { exact: true })).toBeAttached();

    // The question bank lives in Studio; the old Admin path redirects there.
    await page.goto('/admin/bank', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page).toHaveURL(/\/studio\/bank$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Question Bank', exact: true })).toBeVisible();
  });
});
