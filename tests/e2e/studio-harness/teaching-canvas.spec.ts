import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, seriousAxeFindings, shellStrings } from './staff-ui-support';

for (const scenario of [
  { locale: 'en', theme: 'light', width: 1440 },
  { locale: 'en', theme: 'dark', width: 390 },
  { locale: 'vi', theme: 'light', width: 390 },
  { locale: 'vi', theme: 'dark', width: 1440 },
] as const) {
  test(`teaching and grading workspaces: ${scenario.locale}, ${scenario.theme}, ${scenario.width}px`, async ({ page }) => {
    const vi = scenario.locale === 'vi';
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const query = `uiv2=1&lang=${scenario.locale}&theme=${scenario.theme}`;
    await page.goto(`/grading/announcements?${query}`);
    await expect(page.locator('.vf-staff')).toBeVisible();
    if (scenario.width < 768) {
      const menu = page.getByRole('button', { name: shellStrings[scenario.locale].menu, exact: true });
      await menu.click();
      await expect(page.getByRole('link', { name: vi ? 'Lịch học' : 'Schedule', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
    }
    await expect(page.getByRole('heading', { name: vi ? 'Thông báo' : 'Announcements', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: vi ? 'Khóa học' : 'Course', exact: true }).click();
    await page.getByRole('option', { name: vi ? 'Vật lý' : 'Physics' }).click();
    await page.getByLabel(vi ? 'Tiêu đề' : 'Title').fill('Welcome');
    await page.getByLabel(vi ? 'Nội dung' : 'Message').fill('Read chapter one');
    await page.getByRole('button', { name: vi ? 'Lưu bản nháp' : 'Save draft' }).click();
    await expect(page.getByText(vi ? 'Bản nháp' : 'Draft', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: vi ? 'Công bố' : 'Publish', exact: true }).click();
    await expect(page.getByText(vi ? 'Đã công bố' : 'Published', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await seriousAxeFindings(page)).toEqual([]);

    await page.goto(`/grading/schedule?${query}`);
    await page.getByRole('combobox', { name: vi ? 'Phiên bản khóa học' : 'Course version' }).click();
    await page.getByRole('option', { name: vi ? 'Vật lý · Phiên bản 2' : 'Physics · Version 2' }).click();
    await page.getByRole('combobox', { name: vi ? 'Bài tập' : 'Assignment', exact: true }).click();
    await page.getByRole('option', { name: vi ? 'Bài tập' : 'Exercise', exact: true }).click();
    await page.getByLabel(vi ? 'Hạn nộp (không bắt buộc)' : 'Deadline (optional)').fill('2026-11-05T00:30');
    await page.getByRole('button', { name: vi ? 'Lưu lịch' : 'Save schedule' }).click();
    await expect(page.getByRole('status')).toContainText(vi ? 'Đã lưu lịch.' : 'Schedule saved.');
    await expect(page.getByText('2026-11-05 00:30 (UTC+07:00)')).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await seriousAxeFindings(page)).toEqual([]);

    await page.goto(`/grading/assignments/fixture-submission?${query}`);
    await expect(page.getByText(vi ? 'Nộp muộn' : 'Submitted late', { exact: true })).toBeVisible();
    await expect(page.getByLabel(vi ? 'Thông tin hạn nộp tại thời điểm nộp bài' : 'Deadline recorded at submission')).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await seriousAxeFindings(page)).toEqual([]);
  });
}
