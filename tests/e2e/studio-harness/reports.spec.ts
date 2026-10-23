import {expect, test} from '@playwright/test';

test('reports render in the grading workspace and link back into the grading queue', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/reports?canGrade=1');
  await expect(page.getByRole('heading', {name: 'Báo cáo học tập', exact: true})).toBeVisible();

  await page.getByRole('tab', {name: 'Khối lượng chấm'}).click();
  await expect(page.getByRole('heading', {name: /Tồn đọng hiện tại/})).toBeVisible();
  // The workload panel returns to the canonical grading queue, carrying the report's own scope
  // and a back link to the report.
  await expect(page.getByRole('link', {name: 'Mở chấm bài'}))
    .toHaveAttribute('href', '/grading/queue?branchId=school&back=%2Fgrading%2Freports');
});

test('a question row links only to an allowlisted grading destination, with the branch filter', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/reports?canGrade=1');
  await page.getByRole('tab', {name: 'Bài thi & câu hỏi'}).click();
  await expect(page.getByRole('link', {name: 'Xem câu hỏi'}))
    .toHaveAttribute('href', '/studio/grading?courseId=ai&branchId=school');
});

test('reports read in English and stay within the viewport on mobile', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/grading/reports?lang=en&canGrade=1');
  await expect(page.getByRole('heading', {name: 'Learning reports', exact: true})).toBeVisible();
  await page.getByRole('tab', {name: 'Grading workload'}).click();
  await expect(page.getByRole('heading', {name: /Current backlog/})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Open grading'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({path: info.outputPath('reports-mobile-en.png')});
});
