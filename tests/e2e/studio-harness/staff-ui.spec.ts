import { expect, test, type Page } from '@playwright/test';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';
import { describeStaffShell, expectUnclipped, KNOWN_CODEMIRROR_FINDING, messages, shellStrings, shot, withQuery, type StaffRoute } from './staff-ui-support';

/** Catmin staff shell (`?uiv2=1`) over the studio harness: authoring, the course editor and grading. */
const { vi, en } = messages;
const ROUTES: StaffRoute[] = [
  { harness: 'studio', key: 'courses', path: '/studio/courses', locale: 'vi', navigation: vi.common.studioNavigation, link: vi.studioNav.courses },
  { harness: 'studio', key: 'editor', path: '/studio/courses/minimal', locale: 'vi', navigation: vi.common.studioNavigation, link: vi.studioNav.courses, editor: true, crumbTitle: 'Khóa học tối giản', knownFindings: [KNOWN_CODEMIRROR_FINDING] },
  { harness: 'studio', key: 'queue', path: '/grading/queue', locale: 'en', navigation: en.common.gradingNavigation, link: en.gradingNav.queue },
];

/** The course workspace's server endpoints, answered locally (same stubs as staff-presentation.spec.ts). */
async function stubStudioApi(page: Page) {
  await page.route('**/api/v1/studio/content/course/minimal/workflow', route => route.fulfill({ json: { data: { content: { contentType: 'course', contentId: 'minimal', revisionKey: '2026-09-06T00:00:00.000Z', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } } }));
  await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
    const body = route.request().postDataJSON();
    const result = await compileCourse({ manifest: body.manifest, items: body.items }, fixtureResolver, { locales: [body.locale] });
    await route.fulfill({ json: { data: { course: result.compiled, item: null, report: result.report } } });
  });
}

describeStaffShell(ROUTES, stubStudioApi);

test('a 12px Vietnamese string with stacked diacritics renders unclipped at line-height 1.4+', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // `fixture=diacritics` renders the plain list page carrying this eyebrow; /studio/courses itself is CoursesView.
  await page.goto(withQuery('/studio/courses', { fixture: 'diacritics' }));
  const eyebrow = page.getByText('Studio — Nguyễn Thị Thanh Hương', { exact: true });
  await expect(eyebrow).toBeVisible();
  expect((await expectUnclipped(eyebrow)).fontSize).toBe(12);
  // The shell's own small Vietnamese text: the identity row and the page title.
  await expectUnclipped(page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"] .truncate').first());
  await expectUnclipped(page.getByRole('heading', { level: 1, name: vi.studio.courses.title }));
});

test.describe('on macOS', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });

  test('the search trigger shows ⌘K', async ({ page }, info) => {
    // The Desktop Chrome device reports Windows; pin every platform signal the trigger reads to macOS.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'macOS', mobile: false, brands: [] }) });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(withQuery('/studio/courses', { theme: 'light' }));
    const search = page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: shellStrings.vi.search, exact: true });
    await expect(search).toContainText('⌘');
    await expect(search).not.toContainText('Ctrl');
    await shot(page, info, 'studio-courses-1440-light-mac');
  });
});
