import type { Locator } from '@playwright/test';
import type { ExamAttempt } from '@/features/instructor-grading/types';
import type { GradeSubmissionResult, SubmissionQueuePage, SubmissionQueueSubmission } from '@/features/submissions/contracts';
import { expect, test } from './support/fixtures';

async function requireOptions(options: Locator, reason: string) {
  await expect.poll(() => options.count(), { message: reason, timeout: 20_000 }).toBeGreaterThan(0);
}

// Grading is a full page reached from the queue, not a drawer. These journeys drive the real
// authenticated routes with stubbed API responses; the local browser-fixture equivalents live in
// tests/e2e/studio-harness/grading.spec.ts.
test.describe('@main-unique Instructor grading workspaces', () => {
  test.use({ role: 'instructor' });
  test.setTimeout(90_000);

  test('opens an assignment from the queue and completes grading on its own page', async ({ rolePage: page }) => {
    const submission: SubmissionQueueSubmission = {
      id: 'e2e-submission', userId: 'e2e-learner', courseVersionId: 'e2e-version', itemId: 'e2e-assignment',
      blockId: null, assignmentId: 'e2e-assignment', attemptNo: 1, status: 'submitted',
      submittedAt: '2026-09-03T04:00:00.000Z', branchId: 'vinsmc', learnerName: 'E2E Learner',
      payload: { text: 'A learner response', links: [{ url: 'https://example.com/work' }] }, files: [],
    };
    const queue: SubmissionQueuePage = { items: [submission], nextCursor: null };
    const detail = {
      kind: 'assignment',
      submission,
      source: {
        courseId: 'e2e-course', courseVersionId: 'e2e-version', courseVersion: 1,
        publishedAt: '2026-09-01T00:00:00.000Z', itemId: 'e2e-assignment', assignmentId: 'e2e-assignment',
        locale: 'en', availableLocales: ['en'],
        prompt: { id: 'e2e-assignment', type: 'assignment', title: 'E2E assignment', instructions: { blocks: [] }, submission: { accepts: ['text'] } },
        rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] },
        settings: { submission: { accepts: ['text'] }, resubmission: 'until_approved' },
      },
    };
    const completed: GradeSubmissionResult = { submission: {
      ...submission, status: 'approved', grade: {
        rubricScores: { quality: 4 }, feedback: 'Reviewed evidence', decision: 'approved', released: true,
        passed: true, totalPoints: 4, maxPoints: 4, gradedAt: '2026-09-03T05:00:00.000Z',
      },
    } };
    await page.route('**/api/v1/studio/submissions?*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ data: queue }),
    }));
    await page.route('**/api/v1/studio/grading/assignments/e2e-submission*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ data: detail }),
    }));
    await page.route('**/api/v1/studio/submissions/e2e-submission/grade*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ data: completed }),
    }));

    await page.goto('/grading/queue', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Submission queue', exact: true })).toBeVisible();
    const branch = page.getByLabel(/Branch|Chi nhánh/);
    await requireOptions(branch.locator('option'), 'The seeded E2E instructor has no grading branch.');
    await expect(page.getByRole('columnheader', { name: /Learner|Học viên/ })).toBeVisible();

    // Scoped to the table: queue rows also carry a "Preview …" button, and the xl preview adds "Open grading workbench".
    await page.getByRole('table').getByRole('link', { name: /Grade|Chấm bài/ }).click();
    await expect(page).toHaveURL(/\/grading\/assignments\/e2e-submission/);
    // A full page, with a back link — not a dialog.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Back to grading queue|Quay lại danh sách/ })).toBeVisible();
    await expect(page.getByText('A learner response')).toBeVisible();

    await page.getByRole('spinbutton', { name: 'Quality' }).fill('4');
    await page.getByRole('textbox', { name: /Feedback|Phản hồi/ }).fill('Reviewed evidence');
    await page.getByRole('button', { name: /Complete grading|Hoàn tất chấm/ }).click();

    await expect(page.getByRole('heading', { name: /Completed result|Kết quả đã hoàn tất/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Feedback|Phản hồi/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Complete grading|Hoàn tất chấm/ })).toBeDisabled();
  });

  test('grades an exam question, completes the attempt, and keeps release a separate operation', async ({ rolePage: page }) => {
    const attempt: ExamAttempt = {
      attemptId: 'e2e-attempt', userId: 'e2e-learner', learnerName: 'E2E Learner', courseVersionId: 'e2e-version',
      itemId: 'e2e-exam', branchId: 'vinsmc', attemptNo: 1, status: 'pending_manual', late: true,
      startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null, submittedAt: '2026-09-03T04:00:00.000Z',
      points: 2, maxPoints: 7, percent: 28.57, releasedAt: null, resultAvailableAt: null, integrityEventCount: 3,
      pendingManualQuestions: [{ questionId: 'section/essay', type: 'essay', content: { blocks: [] }, answer: 'My answer', maxPoints: 5, points: null, feedback: null }],
    };
    let completed = false;
    const question = {
      questionId: 'section/essay', sectionId: 'section', order: 0, type: 'essay',
      prompt: { id: 'section/essay', type: 'essay', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain the evidence choice.' }] }] } },
      grading: { points: 5 }, answer: 'My answer', result: { status: 'pending_manual' },
      manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: null,
    };
    const completedAttempt = { ...attempt, status: 'graded', points: 6, maxPoints: 7, percent: 85.71, resultAvailableAt: '2026-09-03T05:00:00.000Z' };

    await page.route('**/api/v1/studio/exams/*/attempts?*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        attempts: [completed ? { ...completedAttempt, pendingManualQuestions: [] } : attempt],
        skipped: { unassigned: 1 },
      } }),
    }));
    await page.route('**/api/v1/studio/grading/exams/e2e-attempt*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        kind: 'exam', learnerName: 'E2E Learner',
        attempt: completed ? completedAttempt : attempt,
        source: { locale: 'en', defaultLocale: 'en', sections: [], learner: {}, gradingSnapshot: { questions: {} } },
        questions: [completed ? { ...question, manualPoints: 4, manualFeedback: 'Good reasoning' } : question],
        manualGrading: completed
          ? { total: 1, scored: 1, outstanding: [], complete: true }
          : { total: 1, scored: 0, outstanding: ['section/essay'], complete: false },
      } }),
    }));
    await page.route('**/api/v1/studio/exams/attempts/e2e-attempt/manual-grade', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ data: attempt }),
    }));
    await page.route('**/api/v1/studio/exams/attempts/e2e-attempt/complete-grading', (route) => {
      completed = true;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { attempt: completedAttempt, transitioned: true } }) });
    });

    await page.goto('/grading/assessments', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Exam attempts', exact: true })).toBeVisible();
    const exam = page.getByRole('combobox', { name: /^Exam/ });
    await requireOptions(exam.locator('option'), 'No published exam is available to the seeded E2E instructor.');
    await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible();
    // Release publishes answer keys and legacy results; it is not the completion action and is
    // disabled while the attempt is still being graded.
    await expect(page.getByRole('button', { name: /Release results|Công bố kết quả/ })).toBeDisabled();

    await page.getByRole('link', { name: /Manual grade|Chấm tay/ }).click();
    await expect(page).toHaveURL(/\/grading\/exams\/e2e-attempt/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Explain the evidence choice.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Complete grading|Hoàn tất chấm/ })).toBeDisabled();

    await page.getByLabel(/^Points|^Điểm/).fill('4');
    await page.getByLabel(/Feedback|Phản hồi/).fill('Good reasoning');
    await page.getByRole('button', { name: /Save question grade|Lưu điểm câu hỏi/ }).click();
    await expect(page.getByRole('status')).toContainText(/Question grade saved|Đã lưu điểm câu hỏi/);

    await page.getByRole('button', { name: /Complete grading|Hoàn tất chấm/ }).click();
    await expect(page.getByRole('heading', { name: /Completed result|Kết quả đã hoàn tất/ })).toBeVisible();
    await expect(page.getByText('6 / 7 · 85.71%')).toBeVisible();
  });

  test('reports every release skip count for the separate legacy release operation', async ({ rolePage: page }) => {
    const attempt: ExamAttempt = {
      attemptId: 'e2e-legacy', userId: 'e2e-learner', learnerName: 'E2E Learner', courseVersionId: 'e2e-version',
      itemId: 'e2e-exam', branchId: 'vinsmc', attemptNo: 1, status: 'graded', late: false,
      startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null, submittedAt: '2026-09-03T04:00:00.000Z',
      points: 6, maxPoints: 7, percent: 85.71, releasedAt: null, resultAvailableAt: null, integrityEventCount: 0,
      pendingManualQuestions: [],
    };
    await page.route('**/api/v1/studio/exams/*/attempts?*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { attempts: [attempt], skipped: { unassigned: 3 } } }),
    }));
    await page.route('**/api/v1/studio/exams/*/release', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { released: [{ attemptId: 'e2e-legacy', releasedAt: '2026-09-03T05:00:00.000Z' }], skipped: { forbidden: 2, unassigned: 3, alreadyReleased: [], notReleasable: ['a', 'b'] } } }),
    }));

    await page.goto('/grading/assessments', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const exam = page.getByRole('combobox', { name: /^Exam/ });
    await requireOptions(exam.locator('option'), 'No published exam is available to the seeded E2E instructor.');
    // Graded with no availability timestamp and never released: a historical result still hidden
    // from the learner, awaiting the legacy release operation.
    await expect(page.getByRole('cell', { name: /Awaiting legacy release|Chờ công bố \(cũ\)/ })).toBeVisible();

    await page.getByRole('button', { name: /Release results|Công bố kết quả/ }).click();
    await page.getByRole('button', { name: /Confirm release|Xác nhận công bố/ }).click();
    await expect(page.getByText('Skipped outside permission: 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Skipped unassigned: 3', { exact: true })).toBeVisible();
    await expect(page.getByText('Already released: 0', { exact: true })).toBeVisible();
    await expect(page.getByText('Skipped not releasable: 2', { exact: true })).toBeVisible();
  });
});
