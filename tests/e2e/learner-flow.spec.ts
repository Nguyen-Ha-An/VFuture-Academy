import { expect, test } from '@playwright/test';

import { openRolePage, setEnglishLocale, unavailableRoleStorageStateMessage } from './support/auth';
import { withDisposableLearnerFlowFixture } from './support/learner-flow-fixture';

test.describe.configure({ timeout: 180_000 });

test.describe('@main-unique learner cross-feature chain', () => {
  test('passes a quiz, protects exam answers, submits work, and receives released grading', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Learner-chain acceptance requires an explicit application origin.');
    const roleError = unavailableRoleStorageStateMessage(['instructor']);
    if (roleError) throw new Error(roleError);

    await withDisposableLearnerFlowFixture(async (fixture) => {
      const learnerContext = await browser.newContext({ baseURL });
      await setEnglishLocale(learnerContext, baseURL);
      const learner = await learnerContext.newPage();
      const instructor = await openRolePage(browser, 'instructor', new URL(baseURL).origin);
      try {
        await learner.goto('/login');
        await learner.getByLabel('Email').fill(fixture.learner.email);
        await learner.getByLabel('Password').fill(fixture.learner.password);
        await learner.getByRole('button', { name: 'Sign in', exact: true }).click();
        await learner.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/, { timeout: 20_000 });
        const enrollment = await learner.request.post(`/api/v1/courses/${fixture.courseId}/enroll`);
        expect(enrollment.ok(), `Fixture enrollment failed with HTTP ${enrollment.status()}`).toBeTruthy();

        await learner.goto(`/app/courses/${fixture.courseId}/items/${fixture.lessonId}`);
        const quiz = learner.getByRole('region', { name: 'Chain knowledge check' });
        await quiz.getByRole('radio', { name: fixture.quizAnswer }).check();
        const quizResponse = learner.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/v1/quizzes/submit'
          && response.request().method() === 'POST', { timeout: 20_000 });
        await quiz.getByRole('button', { name: 'Submit', exact: true }).click();
        expect((await quizResponse).ok()).toBeTruthy();
        await expect(quiz.getByText(/passed/i)).toBeVisible();

        await learner.goto(`/app/courses/${fixture.courseId}/items/${fixture.examId}`);
        const startedResponse = learner.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/${fixture.examId}/attempts`)
          && response.request().method() === 'POST', { timeout: 20_000 });
        await learner.getByRole('button', { name: 'Start exam', exact: true }).click();
        const started = await startedResponse;
        expect(started.ok(), `Exam start failed with HTTP ${started.status()}`).toBeTruthy();
        const attemptId = (await started.json() as { data?: { attemptId?: string } }).data?.attemptId;
        if (!attemptId) throw new Error('Exam start did not return an attempt ID.');
        const savedResponse = learner.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/attempts/${attemptId}/answers`)
          && response.request().method() === 'PUT', { timeout: 20_000 });
        await learner.getByRole('radio', { name: fixture.examAnswer }).check();
        expect((await savedResponse).ok()).toBeTruthy();
        await learner.getByRole('button', { name: 'Submit exam', exact: true }).click();
        const submittedResponse = learner.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/exams/attempts/${attemptId}/submit`)
          && response.request().method() === 'POST', { timeout: 20_000 });
        await learner.getByRole('button', { name: 'Submit now', exact: true }).click();
        expect((await submittedResponse).ok()).toBeTruthy();
        await expect(learner.getByText('Grading complete. Results are awaiting release.', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(learner.locator('input[data-correct]')).toHaveCount(0);
        await expect(learner.getByText('The answer key appears only after release.', { exact: true })).toHaveCount(0);

        await learner.goto(`/app/courses/${fixture.courseId}/items/${fixture.assignmentId}`);
        const assignment = learner.getByRole('region', { name: new RegExp('Chain assignment') });
        await assignment.getByLabel('Link URL').fill('https://example.com/owned-learner-chain');
        await assignment.getByRole('button', { name: 'Add link', exact: true }).click();
        const assignmentResponse = learner.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/v1/assignments/submit'
          && response.request().method() === 'POST', { timeout: 20_000 });
        await assignment.getByRole('button', { name: 'Submit assignment', exact: true }).click();
        const submittedAssignment = await assignmentResponse;
        expect(submittedAssignment.ok(), `Assignment submit failed with HTTP ${submittedAssignment.status()}`).toBeTruthy();
        const submissionId = (await submittedAssignment.json() as {
          data?: { session?: { submissions?: Array<{ submissionId?: string }> } };
        }).data?.session?.submissions?.[0]?.submissionId;
        if (!submissionId) throw new Error('Assignment submission did not return an owned submission ID.');
        await expect(assignment.getByRole('region', { name: 'Submission history' }).getByText('Submitted', { exact: true })).toBeVisible();

        const grade = await instructor.page.request.post(
          `/api/v1/studio/submissions/${submissionId}/grade?branchId=${fixture.branchId}`,
          { data: {
            rubricScores: { evidence: 4 }, feedback: { en: fixture.feedback }, decision: 'approved', release: true,
          } },
        );
        expect(grade.ok(), `Assignment grade failed with HTTP ${grade.status()}`).toBeTruthy();
        const release = await instructor.page.request.post(`/api/v1/studio/exams/${fixture.examId}/release`, {
          data: { branchId: fixture.branchId, courseVersionId: fixture.versionId },
        });
        expect(release.ok(), `Exam release failed with HTTP ${release.status()}`).toBeTruthy();
        await expect(release.json()).resolves.toMatchObject({
          data: { released: [expect.objectContaining({ attemptId })] },
        });

        await learner.reload();
        await expect(learner.getByText('Approved', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
        await expect(learner.getByText(`Feedback: ${fixture.feedback}`, { exact: true })).toBeVisible();
        await learner.goto(`/app/courses/${fixture.courseId}/items/${fixture.examId}`);
        await expect(learner.getByText('Results released', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(learner.locator('input[data-correct="true"]')).toHaveCount(1);
        await expect(learner.getByText('The answer key appears only after release.', { exact: true })).toBeVisible();
      } finally {
        await Promise.allSettled([learnerContext.close(), instructor.context.close()]);
      }
    });
  });
});
