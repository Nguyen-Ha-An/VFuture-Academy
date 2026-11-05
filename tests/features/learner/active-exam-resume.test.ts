import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { readLearnerHome } from '@/features/learner/summary';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub, type StubResult } from './test-kit';

const actor: Actor = { userId: 'learner-owner', roles: [], authorization: {
  source: 'database', accountStatus: 'active', assignments: [], memberships: [{ branchId: 'school-active', status: 'active' }],
} };
const now = new Date('2026-11-05T12:00:00Z');
const attempt = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, user_id: actor.userId, course_version_id: 'version-pinned', item_id: 'exam-new', status: 'in_progress',
  started_at: '2026-11-05T10:00:00Z', ...overrides,
});
const dependencies = () => ({ recommended: vi.fn().mockResolvedValue(undefined), listSubmissions: vi.fn().mockResolvedValue([]) });
function database(attempts: StubResult, overrides: Record<string, StubResult[]> = {}) {
  return new SupabaseStub({
    profiles: [successful({ display_name: 'Learner', locale: 'en' }), successful({ branch_id: null })],
    enrollments: [successful([{ course_id: 'course-owned', course_version_id: 'version-pinned', status: 'active',
      branch_id: 'school-active', branch_scope_known: true, enrolled_at: '2026-11-01T00:00:00Z' }])],
    course_version_outline: [successful([{ version_id: 'version-pinned', course_id: 'course-owned', default_language: 'en',
      meta: { title: 'Owned course' }, outline: { modules: [{ items: [
        { id: 'lesson-first', type: 'lesson', title: 'First required lesson', required: true },
        { id: 'assignment-optional', type: 'assignment', title: 'Optional assignment', required: false },
        { id: 'exam-old', type: 'exam', title: 'Earlier active exam', required: true },
        { id: 'exam-new', type: 'exam', title: 'Most recent active exam', required: true },
      ] }] } }])],
    lesson_progress: [successful([])], exam_grades: [successful([])], assignment_submissions: [successful([])],
    activity_state: [successful([{ course_version_id: 'version-pinned', item_id: 'assignment-optional', updated_at: '2026-11-05T11:00:00Z' }])],
    course_version_item_renders: [successful([])], exam_attempts: [attempts], ...overrides,
  });
}

describe('owned active exam resume priority', () => {
  it('resumes the most recently started exact-pin active exam before a recent optional assignment and first required lesson', async () => {
    const db = database(successful([
      attempt('attempt-earlier', { item_id: 'exam-old', started_at: '2026-11-05T09:00:00Z' }),
      attempt('attempt-latest'),
    ]));
    const result = await readLearnerHome(actor, 'en', db, now, dependencies());
    expect(result.continueLearning).toMatchObject({ courseId: 'course-owned', courseVersionId: 'version-pinned', itemId: 'exam-new',
      kind: 'exam', attemptId: 'attempt-latest', startedAt: '2026-11-05T10:00:00Z' });
    expect(result.nextRequired).toMatchObject({ itemId: 'lesson-first' });
    expect(result.upcomingExam).toBeNull();
    expect(db.queriesFor('exam_attempts')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'user_id', actor.userId], ['in', 'course_version_id', ['version-pinned']], ['eq', 'status', 'in_progress'],
    ]));
    expect(db.queries.flatMap(({ query }) => query.operations).some(([operation]) => ['insert', 'update', 'upsert'].includes(operation))).toBe(false);
  });

  it.each(['submitted', 'submitted_late', 'pending_manual', 'graded', 'expired'])('does not treat a %s attempt as an active resume or manufacture completion', async (status) => {
    const db = database(successful([attempt('attempt-terminal', { status })]), {
      activity_state: [successful([])], exam_grades: [successful([{ course_version_id: 'version-pinned', item_id: 'exam-new', passed: false }])],
    });
    const result = await readLearnerHome(actor, 'en', db, now, dependencies());
    expect(result.continueLearning).toEqual(result.nextRequired);
    expect(result.continueLearning).toMatchObject({ itemId: 'lesson-first' });
    expect(result.continueLearning).not.toHaveProperty('attemptId');
  });

  it.each([
    { user_id: 'different-owner' }, { course_version_id: 'different-pin' }, { item_id: 'lesson-first' },
    { item_id: 'unlisted-exam' }, { started_at: 'invalid-date' },
  ])('does not admit a mismatched active attempt (%j)', async (overrides) => {
    const db = database(successful([attempt('untrusted-attempt', overrides)]));
    const result = await readLearnerHome(actor, 'en', db, now, dependencies());
    expect(result.continueLearning).toMatchObject({ itemId: 'assignment-optional' });
    expect(result.continueLearning).not.toHaveProperty('attemptId');
  });

  it('retains the complete existing resume fallback when the additional read is unavailable', async () => {
    const available = await readLearnerHome(actor, 'en', database(successful([])), now, dependencies());
    const unavailable = await readLearnerHome(actor, 'en', database({ data: null, error: new Error('read unavailable') }), now, dependencies());
    expect(unavailable).toEqual(available);
    expect(unavailable.continueLearning).toMatchObject({ itemId: 'assignment-optional' });
  });

  it('does not resume an attempt from a completed enrollment or explicitly suspended school', async () => {
    for (const enrollment of [
      { course_id: 'course-owned', course_version_id: 'version-pinned', status: 'completed' },
      { course_id: 'course-owned', course_version_id: 'version-pinned', status: 'active', branch_id: 'school-suspended', branch_scope_known: true },
    ]) {
      const db = database(successful([attempt('attempt-excluded')]), { enrollments: [successful([enrollment])] });
      const suspendedActor: Actor = { ...actor, authorization: { ...actor.authorization!, memberships: [
        { branchId: 'school-active', status: 'active' }, { branchId: 'school-suspended', status: 'suspended' },
      ] } };
      const result = await readLearnerHome(suspendedActor, 'en', db, now, dependencies());
      expect(result.continueLearning && 'attemptId' in result.continueLearning).not.toBe(true);
    }
  });
});
