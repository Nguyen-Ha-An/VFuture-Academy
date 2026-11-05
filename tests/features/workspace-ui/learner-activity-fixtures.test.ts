// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_COURSE, ASSIGNMENT_VERSION, assignmentSession, createActivityRuntime, createFixtureExamClient, publishedAssignment, publishedExam, publishedLesson } from '../../e2e/learner-harness/src/activity-fixtures';
const locator = { courseId: ASSIGNMENT_COURSE, itemId: 'assignment', blockId: null };
describe('actual-renderer fixture contracts', () => {
  it('keeps the published version stable and exposes feedback only in explicit released states', () => {
    const content = publishedAssignment('en');
    for (const state of ['draft', 'submitted', 'unreleased', 'feedback', 'approved', 'late']) {
      const session = assignmentSession(locator, 'en', state);
      expect(session.courseVersionId).toBe(ASSIGNMENT_VERSION);
      expect(publishedAssignment('en')).toEqual(content);
      expect(Boolean(session.submissions[0]?.grade)).toBe(['feedback', 'approved'].includes(state));
    }
    expect(assignmentSession({ ...locator, itemId: 'inline', blockId: 'embedded-work' }, 'vi', 'feedback').locator.blockId).toBe('embedded-work');
    expect(publishedLesson('en', 'long', 'Long lesson').blocks).toHaveLength(25);
  });
  it('keeps failed submission data retryable and submits only into its local fixture session', async () => {
    const initial = assignmentSession(locator, 'en', 'submit-error');
    const runtime = createActivityRuntime('en', initial, new URLSearchParams('assignmentState=submit-error'));
    await expect(runtime.submitAssignment({ blockId: null }, { text: 'Retained evidence' }, null)).rejects.toThrow('Disposable submit failure');
    expect(runtime.getAssignmentSession({ blockId: null })?.attemptsUsed).toBe(0);
    const result = await runtime.submitAssignment({ blockId: null }, { text: 'Retained evidence' }, null);
    expect(result.session.submissions[0].payload.text).toBe('Retained evidence');
    expect(result.session.courseVersionId).toBe(ASSIGNMENT_VERSION);
    expect(result.session.action).toEqual({ allowed: false, reason: 'awaiting_review' });
  });
  it('reports real upload progress and cancellation through the renderer runtime contract', async () => {
    const runtime = createActivityRuntime('en', assignmentSession(locator, 'en'), new URLSearchParams('upload=pending'));
    const progress: number[] = []; const abort = new AbortController();
    const promise = runtime.uploadAssignmentFile({ blockId: null }, new File(['evidence'], 'evidence.txt', { type: 'text/plain' }), { signal: abort.signal, onProgress: value => progress.push(value.percent) });
    expect(progress).toEqual([25]); abort.abort();
    await expect(promise).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
  });
  it('supports actual ExamFlow start/resume/submit and keeps unreleased scores absent', async () => {
    const exam = publishedExam('en');
    const client = createFixtureExamClient(exam, 'intro');
    expect((await client.session()).attempt).toBeNull();
    const attempt = await client.start();
    expect(attempt.learner.sections).toEqual(exam.sections);
    expect((await client.session()).attempt?.status).toBe('in_progress');
    await client.submit();
    expect((await client.review()).score).toEqual({ points: 1, maxPoints: 2, percent: 50 });
    const hidden = await createFixtureExamClient(exam, 'unreleased').review();
    expect(hidden.resultsAvailable).toBe(false); expect(hidden.score).toBeUndefined(); expect(hidden.results).toBeUndefined();
  });
  it('acknowledges the complete saved-answer set with the actual ExamAnswerRecord contract', async () => {
    const client = createFixtureExamClient(publishedExam('en'), 'active');
    const attempt = (await client.session()).attempt!;
    const first = await client.save({ q1: 'median' });
    expect(first).toEqual([{ attemptId: attempt.attemptId, questionId: 'q1', answer: 'median', result: null, manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: expect.any(Date) }]);
    const second = await client.save({ q2: { value: 'mode' } });
    expect(Object.fromEntries(second.map(record => [record.questionId, record.answer]))).toEqual({ q1: 'median', q2: { value: 'mode' } });
    (second.find(record => record.questionId === 'q2')!.answer as { value: string }).value = 'mutated response';
    expect((await client.save({})).find(record => record.questionId === 'q2')!.answer).toEqual({ value: 'mode' });
  });
});
