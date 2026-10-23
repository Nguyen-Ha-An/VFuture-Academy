import { expect, test, type Page } from '@playwright/test';
import { describeStaffPages, openView, pageShot, type StaffPage } from './staff-pages-support';
import { expectNoHorizontalScroll, messages, withQuery } from './staff-ui-support';
import studioContent from '../../../src/messages/staff-ui/studio-content.json';
import gradingHome from '../../../src/messages/staff-ui/grading-home.json';
import gradingWorkbench from '../../../src/messages/staff-ui/grading-workbench.json';

/** Catmin page views in the studio harness (studio home, courses, media, grading home and queue), inside the staff shell. */
const { vi, en } = messages;
const content = studioContent.vi.content;

/** Media tiles and the details preview load `/api/v1/media/<id>`; answer with a small grey image. */
async function stubMedia(page: Page) {
  await page.route('**/api/v1/media/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#d4d4d8"/><circle cx="52" cy="45" r="18" fill="#a1a1aa"/></svg>',
  }));
}

const PAGES: StaffPage[] = [
  {
    harness: 'studio', key: 'home', path: '/studio', heading: 'Không gian nội dung', kpis: true,
    actions: (page) => [page.locator('main header').getByRole('link', { name: 'Mở hàng đợi duyệt', exact: true })],
  },
  {
    harness: 'studio', key: 'courses', path: '/studio/courses', heading: vi.studio.courses.title, kpis: true,
    actions: (page) => [page.getByRole('button', { name: vi.studio.courses.newCourse, exact: true })],
  },
  {
    harness: 'studio', key: 'media', path: '/studio/media', heading: 'Tệp phương tiện', prepare: stubMedia,
    actions: (page) => [page.getByRole('button', { name: content.media.openDetails.replace('{name}', 'so-do-mang-no-ron.png') })],
  },
  {
    harness: 'studio', key: 'grading-home', path: '/grading', heading: vi.gradingNav.overview, kpis: true,
    actions: (page) => [page.getByRole('link', { name: gradingHome.vi.home.gradeNext })],
  },
  {
    harness: 'studio', key: 'queue', path: '/grading/queue', heading: 'Grading queues',
    actions: (page) => [page.getByRole('table').getByRole('link', { name: /Grade/ }).first()],
  },
  {
    // The Vietnamese queue: diacritics in filters, statuses and the one page header.
    harness: 'studio', key: 'queue-vi', path: '/grading/queue', query: { lang: 'vi' }, heading: 'Hàng chờ chấm bài',
    actions: (page) => [page.getByRole('table').getByRole('link', { name: vi.studio.grading.gradeAction }).first()],
  },
];

describeStaffPages(PAGES);

test.describe('studio page interactions', () => {
  test('grading workbench: review and grading panels remain reachable at 320px', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(withQuery('/grading/assignments/sub-001', { theme: 'light' }));
    await expect(page.getByRole('heading', { level: 1, name: /Nguyễn Minh Anh/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const reviewTab = page.getByRole('tab', { name: 'Review' });
    const gradingTab = page.getByRole('tab', { name: 'Rubric and points' });
    await expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    await gradingTab.click();
    await expect(gradingTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: gradingWorkbench.en.workbench.panels.save })).toBeVisible();
    await expect(page.getByRole('button', { name: gradingWorkbench.en.workbench.panels.complete })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await pageShot(page, info, 'studio-workbench-320-light-grading');
  });

  test('exam workbench: question navigation and manual scoring fit at 320px', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(withQuery('/grading/exams/fixture-attempt', { theme: 'light' }));
    await expect(page.getByRole('heading', { level: 1, name: /Fixture learner/ })).toBeVisible();
    await page.getByRole('navigation', { name: 'Questions' }).getByRole('button', { name: /2\. Essay/ }).click();
    await page.getByRole('tab', { name: 'Grading' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Points' })).toBeVisible();
    await expect(page.getByRole('button', { name: gradingWorkbench.en.workbench.panels.complete })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await pageShot(page, info, 'studio-exam-workbench-320-light-grading');
  });

  test('courses: the table pages with an honest total and "New course" opens and closes its sheet', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[1]!, { theme: 'light' });
    const courses = page.getByRole('table');
    await expect(courses.getByRole('row')).toHaveCount(21);
    await expect(page.getByText(/1–20/)).toContainText('34');
    await page.getByRole('button', { name: vi.studio.courses.newCourse, exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox').first()).toBeVisible();
    await pageShot(page, info, 'studio-courses-1440-light-new-course-sheet', { fullPage: false });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('media: a file opens one details sheet with alt text and workflow, and closes again', async ({ page }, info) => {
    await stubMedia(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[2]!, { theme: 'light' });
    await page.getByRole('button', { name: content.media.openDetails.replace('{name}', 'bieu-do-thong-ke.png') }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox').first()).toBeEnabled();
    await pageShot(page, info, 'studio-media-1440-light-details-sheet', { fullPage: false });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expectNoHorizontalScroll(page);
  });

  test('grading home: "Grade next" opens the oldest waiting submission in the workbench', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[3]!, { theme: 'light' });
    await page.getByRole('link', { name: gradingHome.vi.home.gradeNext }).click();
    await expect(page).toHaveURL(/\/grading\/assignments\/sub-001/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguyễn Minh Anh');
  });

  test('queue: a row previews beside the list on xl, and the workbench walks to "Next in queue"', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, PAGES[4]!, { theme: 'light' });
    const home = gradingHome.en.home.queue;
    await page.getByRole('button', { name: home.preview.replace('{learner}', 'Trần Gia Bảo') }).first().click();
    // The preview aside is labelled by the learner's name; its eyebrow reads "Submission preview".
    const preview = page.getByRole('complementary', { name: 'Trần Gia Bảo' });
    await expect(preview).toContainText(home.previewTitle);
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('link', { name: /Open grading workbench/ })).toBeVisible();
    await pageShot(page, info, 'studio-queue-1440-light-preview');
    await preview.getByRole('button', { name: home.closePreview }).click();
    await expect(preview).toBeHidden();

    // Paging: 50 rows, then "Load more" brings the rest (62 waiting).
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(51);
    await page.getByRole('button', { name: en.studio.grading.loadMore }).click();
    await expect(rows).toHaveCount(63);

    await page.getByRole('table').getByRole('link', { name: /Grade/ }).first().click();
    await expect(page).toHaveURL(/\/grading\/assignments\/sub-001\?/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguyễn Minh Anh');
    await expect(page.getByText('Python cơ bản · Bài tập vòng lặp')).toBeVisible();
    const next = page.getByRole('link', { name: gradingWorkbench.en.workbench.next });
    await expect(next).toHaveAttribute('href', /\/grading\/assignments\/sub-002/);
    await pageShot(page, info, 'studio-workbench-1440-light-next-in-queue');
    await next.click();
    await expect(page).toHaveURL(/\/grading\/assignments\/sub-002/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trần Gia Bảo');
    await expect(page.getByRole('link', { name: gradingWorkbench.en.workbench.next })).toHaveAttribute('href', /sub-003/);
  });
});
