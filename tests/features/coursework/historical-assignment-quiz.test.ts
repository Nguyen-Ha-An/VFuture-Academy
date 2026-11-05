import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
import { createAssignmentHistoryReader } from '@/features/submissions/history';
import { createQuizHistoryReader } from '@/features/quizzes/history';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub, type StubResult } from '../learner/test-kit';

const actor: Actor = { userId: 'history-owner', roles: [], authorization: { source: 'database', accountStatus: 'active', assignments: [],
  memberships: [{ branchId: 'original-school', status: 'active' }, { branchId: 'blocked-school', status: 'suspended' }] } };
const identity = { user_id: actor.userId, course_version_id: 'version-original', item_id: 'lesson-original',
  branch_scope_known: true, branch_id: 'original-school' };
const grade = { released: true, decision: 'changes_requested', passed: false, total_points: 6, max_points: 10,
  rubric_scores: { criterion: 6 }, feedback: { en: 'Original released feedback' }, graded_at: '2026-10-01T12:00:00Z' };
const assignment = { id: 'submission-original', ...identity, block_id: 'assignment-block', attempt_no: 1, status: 'changes_requested',
  payload: { text: 'Original immutable submission' }, submitted_at: '2026-10-01T10:00:00Z', due_at_snapshot: '2026-10-01T09:00:00Z', late: true,
  submission_files: [], grades: grade };
const quiz = { id: 'quiz-original', ...identity, quiz_id: 'quiz-block', attempt_no: 1, answers: { 'quiz-block/question': 'chosen-answer' },
  results: [{ questionId: 'quiz-block/question', status: 'incorrect', points: 0, maxPoints: 1,
    parts: { 'secret-key': 'correct' }, children: [{ questionId: 'child', status: 'incorrect', points: 0, maxPoints: 1, parts: { nested: 'correct' } }] }],
  points: 0, max_points: 1, percent: 0, passed: false, submitted_at: '2026-10-01T10:00:00Z' };
function database(table: 'assignment_submissions' | 'quiz_attempts', record: Record<string, unknown>,
  extra: Record<string, StubResult[]> = {}, feedback = 'none') {
  return new SupabaseStub({
    [table]: [successful(record)], course_versions: [successful({ id: 'version-original', course_id: 'course-owned' })],
    enrollments: [successful({ course_version_id: 'version-upgraded', status: 'active' })],
    course_version_outline: [successful({ version_id: 'version-original', course_id: 'course-owned', default_language: 'en',
      meta: { title: 'Original course' } })],
    course_version_items: [successful({ item_id: 'lesson-original', kind: 'lesson', grading: { assignments: { 'assignment-block': {} },
      quizzes: { 'quiz-block': { questionIds: ['quiz-block/question'], feedback, showExplanations: false } }, questions: {} } })],
    course_version_item_renders: [successful([{ locale: 'en', payload: { id: 'lesson-original', kind: 'lesson', title: 'Original lesson', blocks: [
      { id: 'assignment-block', type: 'assignment', title: 'Original assignment', instructions: { blocks: [] }, submission: { accepts: ['text'] } },
      { id: 'quiz-block', type: 'quiz', title: 'Original quiz', questions: [{ id: 'quiz-block/question', type: 'short_answer', stem: { blocks: [] } }] },
    ] } }])], ...extra,
  });
}

describe('record-bound assignment and quiz history readers', () => {
  it('reads the selected assignment using its original pin and released projection after upgrade', async () => {
    const db = database('assignment_submissions', assignment);
    const result = await createAssignmentHistoryReader(db).read(actor,
      { courseId: 'course-owned', itemId: 'lesson-original', submissionId: 'submission-original' }, 'en');
    expect(result).toMatchObject({ courseVersionId: 'version-original', blockId: 'assignment-block', courseTitle: 'Original course',
      assignment: { title: 'Original assignment' }, submission: { submissionId: 'submission-original', attemptNo: 1, late: true,
        payload: { text: 'Original immutable submission' }, grade: { feedback: { en: 'Original released feedback' } } } });
    expect(result).not.toHaveProperty('action');
    expect(db.queriesFor('courses')).toHaveLength(0);
    expect(db.queriesFor('course_version_items')[0].operations).toContainEqual(['eq', 'version_id', 'version-original']);
    expect(db.queries.flatMap(({ query }) => query.operations).some(([operation]) => ['insert', 'update', 'upsert'].includes(operation))).toBe(false);
  });

  it('never reveals an assignment grading draft or its internal approval status', async () => {
    const db = database('assignment_submissions', { ...assignment, status: 'approved', grades: { ...grade, released: false, feedback: 'Hidden draft' } });
    const result = await createAssignmentHistoryReader(db).read(actor,
      { courseId: 'course-owned', itemId: 'lesson-original', submissionId: 'submission-original' }, 'en');
    expect(result.submission.status).toBe('in_review');
    expect(result.submission).not.toHaveProperty('grade');
    expect(JSON.stringify(result)).not.toContain('Hidden draft');
  });

  it('reads a quiz record without regrading and strips legacy answer-bearing parts under the pinned hidden policy', async () => {
    const db = database('quiz_attempts', quiz);
    const result = await createQuizHistoryReader(db).read(actor,
      { courseId: 'course-owned', itemId: 'lesson-original', attemptId: 'quiz-original' }, 'en');
    expect(result).toMatchObject({ courseVersionId: 'version-original', courseTitle: 'Original course', quiz: { title: 'Original quiz' },
      attempt: { attemptId: 'quiz-original', points: 0, maxPoints: 1, percent: 0, answers: { 'quiz-block/question': 'chosen-answer' } } });
    expect(JSON.stringify(result)).not.toContain('secret-key');
    expect(JSON.stringify(result.attempt.results)).not.toContain('parts');
    expect(result).not.toHaveProperty('action');
    expect(db.queries.flatMap(({ query }) => query.operations).some(([operation]) => ['insert', 'update', 'upsert'].includes(operation))).toBe(false);
  });

  it.each(['assignment', 'quiz'])('rejects spoofed owner, course, item and dropped enrollment for %s history', async (kind) => {
    for (const violation of ['owner', 'course', 'item', 'dropped']) {
      const table = kind === 'assignment' ? 'assignment_submissions' : 'quiz_attempts';
      const row = kind === 'assignment' ? assignment : quiz;
      const db = database(table, { ...row, ...(violation === 'owner' ? { user_id: 'someone-else' } : {}) }, {
        ...(violation === 'course' ? { course_versions: [successful({ course_id: 'another-course' })] } : {}),
        ...(violation === 'dropped' ? { enrollments: [successful(null)] } : {}),
      });
      const locator = { courseId: 'course-owned', itemId: violation === 'item' ? 'different-item' : 'lesson-original' };
      const read = kind === 'assignment'
        ? createAssignmentHistoryReader(db).read(actor, { ...locator, submissionId: 'submission-original' }, 'en')
        : createQuizHistoryReader(db).read(actor, { ...locator, attemptId: 'quiz-original' }, 'en');
      await expect(read).rejects.toMatchObject({ status: 404 });
    }
  });

  it.each(['assignment', 'quiz'])('uses only the immutable historical school for %s suspension and keeps unknown owner history unknown', async (kind) => {
    const table = kind === 'assignment' ? 'assignment_submissions' : 'quiz_attempts';
    const row = kind === 'assignment' ? assignment : quiz;
    const read = (db: SupabaseStub) => kind === 'assignment'
      ? createAssignmentHistoryReader(db).read(actor, { courseId: 'course-owned', itemId: 'lesson-original', submissionId: 'submission-original' }, 'en')
      : createQuizHistoryReader(db).read(actor, { courseId: 'course-owned', itemId: 'lesson-original', attemptId: 'quiz-original' }, 'en');
    await expect(read(database(table, { ...row, branch_id: 'blocked-school' }))).rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_SUSPENDED' });
    const unknown = database(table, { ...row, branch_scope_known: false, branch_id: 'untrusted-present-school' });
    expect(await read(unknown)).toMatchObject({ branchId: null });
    expect(unknown.queriesFor('profiles')).toHaveLength(0);
    expect(unknown.queriesFor('branch_memberships')).toHaveLength(0);
  });
});
