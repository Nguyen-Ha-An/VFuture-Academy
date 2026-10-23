import { expect, test } from './support/fixtures';

test.describe('@recovery-07 bench learner dashboard and catalog', () => {
  test.use({ role: 'precompletionLearner' });
  test.skip(process.env.HIDE_INTERNAL_CONTENT === '1', 'internal fixtures hidden');

  test('leads with the resumable lesson and keeps Learning and Discover course views separate', async ({ rolePage: page }, testInfo) => {
    await page.goto('/app');
    const continuation = page.getByRole('region', { name: 'Continue learning' });
    // Spec 4.3: the h1 is the current lesson; the learner's name moves into the meta line.
    await expect(continuation.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(continuation).toContainText('E2E Pre-completion Learner');
    await expect(continuation).toContainText('AI Foundations');
    await expect(page.getByRole('link', { name: /^(Resume|Continue) / }).first()).toHaveAttribute('href', /^\/app\/courses\/ai-foundations\/items\//);
    await expect(page.getByRole('region', { name: 'Active courses' })).toContainText('AI Foundations');
    await expect(page.getByRole('group', { name: /Trace|Activity/ })).toBeVisible();

    await page.goto('/app/courses');
    await expect(page.getByRole('link', { name: 'Learning' }).first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Your courses' })).toContainText('AI Foundations');
    await expect(page.getByText('[RECOVERY] Collaboration Foundations')).toHaveCount(0);

    await page.getByRole('link', { name: 'Discover' }).first().click();
    await expect(page).toHaveURL('/app/courses?tab=discover');
    await expect(page.getByRole('region', { name: 'Available courses' })).toContainText('[RECOVERY] Collaboration Foundations');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Available courses' })).toContainText('[RECOVERY] Collaboration Foundations');
    await page.screenshot({ path: testInfo.outputPath('bench-dashboard-course-groups.png'), fullPage: true });
  });
});
