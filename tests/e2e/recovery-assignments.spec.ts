import { expect, test, type Page } from '@playwright/test';

import type { DisposableAssignmentFixture } from './support/assignment-fixture';
import { withDisposableAssignmentFixture } from './support/assignment-fixture';
import { openRolePage, setEnglishLocale, unavailableRoleStorageStateMessage } from './support/auth';

test.describe.configure({ timeout: 240_000 });

type SubmitBody = {
  courseId: string;
  itemId: string;
  blockId: string | null;
  expectedLatestSubmissionId: string | null;
  payload: unknown;
};

async function signInAndEnroll(page: Page, fixture: DisposableAssignmentFixture) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(fixture.learner.email);
  await page.getByLabel('Password').fill(fixture.learner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/);
  const enrollment = await page.request.post(`/api/v1/courses/${fixture.courseId}/enroll`);
  expect(enrollment.ok(), `Fixture enrollment failed with HTTP ${enrollment.status()}`).toBeTruthy();
}

async function submitFromUi(page: Page, buttonName: 'Submit assignment' | 'Submit revision') {
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/assignments/submit'
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), `Assignment submit failed with HTTP ${response.status()}`).toBeTruthy();
  const body = await response.json() as { data?: { created?: boolean; session?: { submissions?: Array<{ submissionId?: string }> } } };
  const submissionId = body.data?.session?.submissions?.[0]?.submissionId;
  if (!submissionId) throw new Error('Assignment submit did not return a durable submission ID.');
  return { response, body, submissionId, requestBody: response.request().postDataJSON() as SubmitBody };
}

async function openSubmissionDrawer(page: Page, fixture: DisposableAssignmentFixture, attempt: number) {
  await page.goto('/admin/submissions');
  await page.locator('#submission-branch-filter').selectOption(fixture.branchId);
  await page.locator('#submission-course-filter').selectOption({ label: fixture.courseTitle });
  await page.locator('#submission-assignment-filter').selectOption(fixture.assignmentId);
  const row = page.getByRole('row')
    .filter({ hasText: fixture.learner.displayName })
    .filter({ has: page.getByRole('cell', { name: String(attempt), exact: true }) });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.getByRole('button', { name: 'Grade', exact: true }).click();
  return page.getByRole('dialog', { name: new RegExp(fixture.learner.displayName) });
}

async function saveStudioGrade(
  page: Page,
  fixture: DisposableAssignmentFixture,
  attempt: number,
  options: { decision: 'Approve' | 'Request changes'; feedback: string; release: boolean },
) {
  const drawer = await openSubmissionDrawer(page, fixture, attempt);
  await drawer.getByLabel(fixture.rubricCriterion).fill(options.decision === 'Approve' ? '4' : '2');
  await drawer.getByLabel('Feedback', { exact: true }).fill(options.feedback);
  await drawer.getByLabel(options.decision, { exact: true }).check();
  const release = drawer.getByLabel('Release this grade to the learner', { exact: true });
  if (options.release) await release.check();
  else await release.uncheck();
  const saved = page.waitForResponse((response) => response.url().includes('/api/v1/studio/submissions/')
    && response.url().includes('/grade') && response.request().method() === 'POST');
  await drawer.getByRole('button', { name: 'Save grade', exact: true }).click();
  const response = await saved;
  expect(response.ok(), `Studio grade failed with HTTP ${response.status()}`).toBeTruthy();
  await expect(drawer.getByText(options.release
    ? 'This grade has been released to the learner.'
    : 'This grade is a private draft. Learners cannot see its decision, score, or feedback until release.', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
}

async function expectRequirement(page: Page, fixture: DisposableAssignmentFixture, met: boolean) {
  await page.goto(`/app/courses/${fixture.courseId}`);
  await expect(page.getByText('Receive approval for the assignment', { exact: true })).toBeVisible();
  const requirements = page.getByRole('region', { name: 'Completion requirements' });
  await expect(requirements.getByText(met ? 'Met' : 'Not yet met', { exact: true })).toBeVisible();
}

test.describe('@recovery-09 guarded assignment lifecycle', () => {
  test('recovers permitted inputs and only completes after a released approval', async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('Assignment acceptance requires an explicit application origin.');
    const roleError = unavailableRoleStorageStateMessage(['instructor']);
    if (roleError) throw new Error(roleError);

    await withDisposableAssignmentFixture('standalone', async (fixture) => {
      const learnerContext = await browser.newContext({ baseURL });
      await setEnglishLocale(learnerContext, baseURL);
      const learnerPage = await learnerContext.newPage();
      const { context: instructorContext, page: instructorPage } = await openRolePage(browser, 'instructor', new URL(baseURL).origin);
      try {
        await signInAndEnroll(learnerPage, fixture);
        const itemUrl = `/app/courses/${fixture.courseId}/items/${fixture.itemId}`;
        await learnerPage.goto(itemUrl);
        const assignment = learnerPage.getByRole('region', { name: fixture.assignmentTitle });
        await expect(assignment).toBeVisible();

        let failUpload = true;
        await learnerPage.route('**/api/v1/uploads', async (route) => {
          if (failUpload && route.request().method() === 'POST') await route.abort('internetdisconnected');
          else await route.continue();
        });
        await assignment.getByLabel('Upload files').setInputFiles({
          name: fixture.fileName,
          mimeType: 'text/plain',
          buffer: Buffer.from('owned recovery assignment upload'),
        });
        await expect(assignment.getByText(`Upload failed for ${fixture.fileName}`, { exact: true })).toBeVisible();
        failUpload = false;
        const uploaded = learnerPage.waitForResponse((response) => response.url().endsWith('/api/v1/uploads')
          && response.request().method() === 'POST');
        await assignment.getByRole('button', { name: `Retry ${fixture.fileName}`, exact: true }).click();
        const uploadResponse = await uploaded;
        expect(uploadResponse.ok(), `Assignment upload retry failed with HTTP ${uploadResponse.status()}`).toBeTruthy();
        const uploadBody = await uploadResponse.json() as { data?: { assetId?: string } };
        if (!uploadBody.data?.assetId) throw new Error('Successful assignment upload returned no asset ID.');
        fixture.trackUpload(uploadBody.data.assetId);

        await assignment.getByLabel('Link URL').fill('https://example.com/recovery-proof');
        await assignment.getByRole('button', { name: 'Add link', exact: true }).click();
        await assignment.locator('.cm-content[contenteditable="true"][aria-label="code editor"]').fill('export const recovered = true;');
        const draftSaved = learnerPage.waitForResponse((response) => response.url().includes('/api/v1/progress/blocks/')
          && response.request().method() === 'PUT' && response.ok());
        await assignment.getByLabel('Notes').fill('Draft one survives a full page reload.');
        await draftSaved;
        await learnerPage.reload();
        const restored = learnerPage.getByRole('region', { name: fixture.assignmentTitle });
        await expect(restored.getByLabel('Notes')).toHaveValue('Draft one survives a full page reload.');
        await expect(restored.locator('.cm-content[aria-label="code editor"]')).toHaveText(/recovered = true/);
        await expect(restored.getByRole('link', { name: 'https://example.com/recovery-proof' })).toBeVisible();
        await expect(restored.getByText(fixture.fileName, { exact: true })).toBeVisible();

        const initial = await submitFromUi(learnerPage, 'Submit assignment');
        expect(initial.requestBody).toMatchObject({ courseId: fixture.courseId, itemId: fixture.itemId, blockId: null });
        await expect(restored.getByRole('heading', { name: 'Submission history' })).toBeVisible();
        await expect(restored.getByText('Attempt 1', { exact: true })).toBeVisible();
        const replay = await learnerPage.request.post('/api/v1/assignments/submit', { data: initial.requestBody });
        expect(replay.ok(), `Identical replay failed with HTTP ${replay.status()}`).toBeTruthy();
        const replayBody = await replay.json() as { data?: { created?: boolean; session?: { submissions?: unknown[] } } };
        expect(replayBody.data?.created).toBe(false);
        expect(replayBody.data?.session?.submissions).toHaveLength(1);
        await fixture.expectSubmissionCount(1);

        const privateFeedback = `Private grading draft ${fixture.courseId}`;
        await saveStudioGrade(instructorPage, fixture, 1, { decision: 'Approve', feedback: privateFeedback, release: false });
        await learnerPage.reload();
        await expect(assignment.locator('header').getByText('In review', { exact: true })).toBeVisible();
        await expect(learnerPage.getByText(privateFeedback, { exact: true })).toHaveCount(0);
        await fixture.expectCompletion(false);
        await expectRequirement(learnerPage, fixture, false);

        const changesFeedback = `Released revision request ${fixture.courseId}`;
        await saveStudioGrade(instructorPage, fixture, 1, { decision: 'Request changes', feedback: changesFeedback, release: true });
        await learnerPage.goto(itemUrl);
        await expect(assignment.locator('header').getByText('Changes requested', { exact: true })).toBeVisible();
        await expect(learnerPage.getByText(`Feedback: ${changesFeedback}`, { exact: true })).toBeVisible();
        await fixture.expectCompletion(false);

        const revision = `Meaningful revision ${fixture.courseId}`;
        await assignment.getByLabel('Notes').fill(revision);
        const revised = await submitFromUi(learnerPage, 'Submit revision');
        expect(revised.requestBody.expectedLatestSubmissionId).toBe(initial.submissionId);
        expect(revised.requestBody).toMatchObject({ blockId: null, payload: { text: revision } });
        await expect(learnerPage.getByText('Attempt 2', { exact: true })).toBeVisible();
        await fixture.expectSubmissionCount(2);

        const feedback = { vi: `Đã duyệt ${fixture.courseId}`, en: `Approved localized feedback ${fixture.courseId}` };
        const approved = await instructorPage.request.post(
          `/api/v1/studio/submissions/${revised.submissionId}/grade?branchId=${fixture.branchId}`,
          { data: { rubricScores: { evidence: 4 }, feedback, decision: 'approved', release: true } },
        );
        expect(approved.ok(), `Released approval failed with HTTP ${approved.status()}`).toBeTruthy();
        const releasedDrawer = await openSubmissionDrawer(instructorPage, fixture, 2);
        await expect(releasedDrawer.getByText('This grade has been released to the learner.', { exact: true })).toBeVisible();
        await expect(releasedDrawer.getByRole('button', { name: 'Save grade', exact: true })).toBeDisabled();
        await releasedDrawer.getByRole('button', { name: 'Close', exact: true }).click();
        await learnerPage.reload();
        await expect(assignment.locator('header').getByText('Approved', { exact: true })).toBeVisible();
        await expect(learnerPage.getByText(`Feedback: ${feedback.en}`, { exact: true })).toBeVisible();
        await fixture.expectCompletion(true);
        await expectRequirement(learnerPage, fixture, true);
        await learnerPage.screenshot({ path: testInfo.outputPath('released-assignment-approval.png'), fullPage: true });
      } finally {
        await Promise.allSettled([learnerContext.close(), instructorContext.close()]);
      }
    });
  });

  test('keeps an equal lesson and inline assignment ID explicit through upload, submit, history, and completion', async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('Inline assignment acceptance requires an explicit application origin.');
    const roleError = unavailableRoleStorageStateMessage(['instructor']);
    if (roleError) throw new Error(roleError);

    await withDisposableAssignmentFixture('inline', async (fixture) => {
      const learnerContext = await browser.newContext({ baseURL });
      await setEnglishLocale(learnerContext, baseURL);
      const learnerPage = await learnerContext.newPage();
      const { context: instructorContext, page: instructorPage } = await openRolePage(browser, 'instructor', new URL(baseURL).origin);
      const observed = { submitTarget: false, historyTarget: false };
      learnerPage.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/v1/assignments/submit' && request.method() === 'POST') {
          observed.submitTarget ||= request.postDataJSON()?.blockId === fixture.assignmentId;
        }
        if (url.pathname.endsWith(`/assignments/${fixture.itemId}/submissions`) && request.method() === 'GET') {
          observed.historyTarget ||= url.searchParams.get('blockId') === fixture.assignmentId;
        }
      });
      try {
        await signInAndEnroll(learnerPage, fixture);
        const itemUrl = `/app/courses/${fixture.courseId}/items/${fixture.itemId}`;
        await learnerPage.goto(itemUrl);
        const assignment = learnerPage.getByRole('region', { name: fixture.assignmentTitle });
        await assignment.getByLabel('Notes').fill('Inline identity remains explicit.');
        const uploaded = learnerPage.waitForResponse((response) => response.url().endsWith('/api/v1/uploads')
          && response.request().method() === 'POST');
        await assignment.getByLabel('Upload files').setInputFiles({
          name: fixture.fileName, mimeType: 'text/plain', buffer: Buffer.from('inline owned upload'),
        });
        const uploadResponse = await uploaded;
        expect(uploadResponse.ok()).toBeTruthy();
        const uploadBody = await uploadResponse.json() as { data?: { assetId?: string } };
        if (!uploadBody.data?.assetId) throw new Error('Inline upload returned no asset ID.');
        fixture.trackUpload(uploadBody.data.assetId);
        // Chromium can omit multipart file bodies from request.postData(). Prove
        // the locator through the server: the same lesson upload without its
        // explicit inline target must fail before storing an object.
        const missingTarget = await learnerPage.request.post('/api/v1/uploads', {
          multipart: {
            courseId: fixture.courseId, itemId: fixture.itemId,
            file: { name: fixture.fileName, mimeType: 'text/plain', buffer: Buffer.from('missing inline target') },
          },
        });
        const missingBody = await missingTarget.json() as { data?: { assetId?: string }; error?: { code?: string } };
        if (missingBody.data?.assetId) fixture.trackUpload(missingBody.data.assetId);
        expect(missingTarget.status()).toBe(404);
        expect(missingBody.error?.code).toBe('ASSIGNMENT_NOT_FOUND');
        const submitted = await submitFromUi(learnerPage, 'Submit assignment');
        expect(submitted.requestBody.blockId).toBe(fixture.assignmentId);
        await learnerPage.reload();
        await expect(learnerPage.getByRole('heading', { name: 'Submission history' })).toBeVisible();
        await expect(learnerPage.getByText('Attempt 1', { exact: true })).toBeVisible();
        const historyStatus = await learnerPage.evaluate(async ({ courseId, itemId, blockId }) => {
          const params = new URLSearchParams({ courseId, blockId });
          return (await fetch(`/api/v1/assignments/${itemId}/submissions?${params}`)).status;
        }, { courseId: fixture.courseId, itemId: fixture.itemId, blockId: fixture.assignmentId });
        expect(historyStatus).toBe(200);
        expect(observed).toEqual({ submitTarget: true, historyTarget: true });
        await fixture.expectCompletion(false);

        const feedback = { vi: `Nội tuyến ${fixture.courseId}`, en: `Inline approved ${fixture.courseId}` };
        const approved = await instructorPage.request.post(
          `/api/v1/studio/submissions/${submitted.submissionId}/grade?branchId=${fixture.branchId}`,
          { data: { rubricScores: { evidence: 4 }, feedback, decision: 'approved', release: true } },
        );
        expect(approved.ok(), `Inline approval failed with HTTP ${approved.status()}`).toBeTruthy();
        await learnerPage.reload();
        await expect(assignment.locator('header').getByText('Approved', { exact: true })).toBeVisible();
        await expect(learnerPage.getByText(`Feedback: ${feedback.en}`, { exact: true })).toBeVisible();
        await fixture.expectCompletion(true);
        await expectRequirement(learnerPage, fixture, true);
        await learnerPage.screenshot({ path: testInfo.outputPath('inline-assignment-approval.png'), fullPage: true });
      } finally {
        await Promise.allSettled([learnerContext.close(), instructorContext.close()]);
      }
    });
  });
});
