import { expect, test } from '@playwright/test';

import { openRolePage, setEnglishLocale, unavailableRoleStorageStateMessage } from './support/auth';
import { withDisposableExamFixture } from './support/exam-fixture';

test.describe.configure({ timeout: 180_000 });

test.describe('@recovery-08 recoverable exam lifecycle', () => {
  test('restores an offline draft, retries the real save, then grades and releases through Studio', async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('Exam acceptance requires an explicit application origin.');
    const roleError = unavailableRoleStorageStateMessage(['instructor']);
    if (roleError) throw new Error(roleError);

    await withDisposableExamFixture(async (fixture) => {
      const learnerContext = await browser.newContext({ baseURL });
      await setEnglishLocale(learnerContext, baseURL);
      const learnerPage = await learnerContext.newPage();
      const { context: instructorContext, page: instructorPage } = await openRolePage(browser, 'instructor', new URL(baseURL).origin);
      try {
        await learnerPage.goto('/login');
        await learnerPage.getByLabel('Email').fill(fixture.learner.email);
        await learnerPage.getByLabel('Password').fill(fixture.learner.password);
        await learnerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
        await learnerPage.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/);
        const enrollment = await learnerPage.request.post(`/api/v1/courses/${fixture.courseId}/enroll`);
        expect(enrollment.ok(), `Fixture enrollment failed with HTTP ${enrollment.status()}`).toBeTruthy();

        const itemUrl = `/app/courses/${fixture.courseId}/items/${fixture.mainExamId}`;
        await learnerPage.goto(itemUrl);
        await expect(learnerPage.getByText('Restoring your exam…')).toBeHidden({ timeout: 20_000 });
        const startResponse = learnerPage.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/${fixture.mainExamId}/attempts`)
          && response.request().method() === 'POST');
        await learnerPage.getByRole('button', { name: 'Start exam', exact: true }).click();
        const started = await startResponse;
        expect(started.ok(), `Exam start failed with HTTP ${started.status()}`).toBeTruthy();
        const startBody = await started.json() as { data?: { attemptId?: string } };
        const attemptId = startBody.data?.attemptId;
        if (!attemptId) throw new Error('Exam start did not return an attempt ID.');

        let blockAnswerSaves = true;
        await learnerPage.route(`**/api/v1/exams/attempts/${attemptId}/answers`, async (route) => {
          if (route.request().method() === 'PUT' && blockAnswerSaves) await route.abort('internetdisconnected');
          else await route.continue();
        });
        await learnerPage.getByRole('radio', { name: fixture.correctOption }).check();
        await learnerPage.getByRole('textbox', { name: fixture.manualPrompt }).fill(fixture.manualAnswer);
        await expect(learnerPage.getByText('Changes are not saved.')).toBeVisible({ timeout: 15_000 });

        await learnerPage.reload();
        await expect(learnerPage.getByRole('radio', { name: fixture.correctOption })).toBeChecked();
        await expect(learnerPage.getByRole('textbox', { name: fixture.manualPrompt })).toHaveValue(fixture.manualAnswer);
        await expect(learnerPage.getByText('Changes are not saved.')).toBeVisible({ timeout: 15_000 });
        blockAnswerSaves = false;
        const retryResponse = learnerPage.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/attempts/${attemptId}/answers`)
          && response.request().method() === 'PUT');
        await learnerPage.getByRole('button', { name: 'Retry save', exact: true }).click();
        expect((await retryResponse).ok()).toBeTruthy();
        await expect(learnerPage.getByText('Saved', { exact: true })).toBeVisible();
        await fixture.expectStoredAnswer(attemptId, fixture.manualQuestionId, fixture.manualAnswer);

        await learnerPage.getByRole('button', { name: 'Submit exam', exact: true }).click();
        const submitResponse = learnerPage.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/attempts/${attemptId}/submit`)
          && response.request().method() === 'POST');
        await learnerPage.getByRole('button', { name: 'Submit now', exact: true }).click();
        expect((await submitResponse).ok()).toBeTruthy();
        await expect(learnerPage.getByText('Awaiting grading', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(learnerPage.locator('input[data-correct]')).toHaveCount(0);

        await instructorPage.goto('/admin/exams');
        await instructorPage.locator('#exam-branch-filter').selectOption(fixture.branchId);
        await instructorPage.locator('#exam-course-filter').selectOption({ label: fixture.courseTitle });
        await instructorPage.locator('#exam-item-filter').selectOption({ label: `${fixture.mainExamTitle} · version 1` });
        const learnerRow = instructorPage.getByRole('row').filter({ hasText: fixture.learner.displayName });
        await expect(learnerRow).toBeVisible({ timeout: 20_000 });
        await learnerRow.getByRole('button', { name: 'Manual grade', exact: true }).click();
        const drawer = instructorPage.getByRole('dialog', { name: new RegExp(fixture.learner.displayName) });
        await drawer.getByLabel('Points').fill('2');
        await drawer.getByLabel('Feedback').fill(fixture.manualFeedback);
        const gradeResponse = instructorPage.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/studio/exams/attempts/${attemptId}/manual-grade`)
          && response.request().method() === 'POST');
        await drawer.getByRole('button', { name: 'Save question grade', exact: true }).click();
        expect((await gradeResponse).ok()).toBeTruthy();
        await expect(drawer.getByText(/Grade saved/)).toBeVisible();
        await fixture.expectManualGrade(attemptId, fixture.manualQuestionId, 2, fixture.manualFeedback);
        await drawer.getByRole('button', { name: 'Close', exact: true }).click();

        await expect(learnerRow).toContainText(/Graded/i, { timeout: 20_000 });
        await learnerPage.reload();
        await expect(learnerPage.getByText('Grading complete. Results are awaiting release.', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(learnerPage.getByText(fixture.manualFeedback, { exact: true })).toHaveCount(0);
        await expect(learnerPage.locator('input[data-correct]')).toHaveCount(0);
        await instructorPage.getByRole('button', { name: 'Release results', exact: true }).click();
        const releaseResponse = instructorPage.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/studio/exams/${fixture.mainExamId}/release`)
          && response.request().method() === 'POST');
        await instructorPage.getByRole('button', { name: 'Confirm release', exact: true }).click();
        expect((await releaseResponse).ok()).toBeTruthy();
        await expect(instructorPage.getByRole('dialog', { name: 'Release exam results?' }).getByText('Released 1 result.', { exact: true })).toBeVisible();

        await learnerPage.reload();
        await expect(learnerPage.getByText('Results released', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(learnerPage.locator('input[data-correct="true"]')).toHaveCount(1);
        await expect(learnerPage.getByText(fixture.manualFeedback, { exact: true })).toBeVisible();
        await learnerPage.screenshot({ path: testInfo.outputPath('released-exam-review.png'), fullPage: true });
      } finally {
        await Promise.allSettled([learnerContext.close(), instructorContext.close()]);
      }
    });
  });

  test('expires only its verified owned attempt through the protected sweep route', async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('Exam expiration acceptance requires an explicit application origin.');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error('Exam expiration acceptance requires CRON_SECRET.');

    await withDisposableExamFixture(async (fixture) => {
      const context = await browser.newContext({ baseURL });
      await setEnglishLocale(context, baseURL);
      const page = await context.newPage();
      try {
        await page.goto('/login');
        await page.getByLabel('Email').fill(fixture.learner.email);
        await page.getByLabel('Password').fill(fixture.learner.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/);
        const enrollment = await page.request.post(`/api/v1/courses/${fixture.courseId}/enroll`);
        expect(enrollment.ok()).toBeTruthy();
        await page.goto(`/app/courses/${fixture.courseId}/items/${fixture.expiryExamId}`);
        const startResponse = page.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/${fixture.expiryExamId}/attempts`)
          && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Start exam', exact: true }).click();
        const started = await startResponse;
        expect(started.ok()).toBeTruthy();
        const startBody = await started.json() as { data?: { attemptId?: string } };
        const attemptId = startBody.data?.attemptId;
        if (!attemptId) throw new Error('Expiration exam start did not return an attempt ID.');

        await fixture.expireOwnedAttempt(attemptId);
        const sweep = await page.request.post('/api/v1/internal/exams/sweep', {
          headers: { authorization: `Bearer ${cronSecret}` },
        });
        expect(sweep.ok(), `Protected sweep failed with HTTP ${sweep.status()}`).toBeTruthy();
        const sweepBody = await sweep.json() as { data?: Array<{ attemptId?: string; status?: string }> };
        expect(sweepBody.data).toContainEqual(expect.objectContaining({ attemptId, status: 'expired' }));
        await fixture.expectAttemptStatus(attemptId, 'expired');

        await page.reload();
        await expect(page.getByText('Attempt expired', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'Start exam', exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('expired-exam.png'), fullPage: true });
      } finally {
        await context.close();
      }
    });
  });
});
