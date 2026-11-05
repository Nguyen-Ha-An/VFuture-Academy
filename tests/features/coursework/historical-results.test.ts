import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
import { createCourseworkReadService } from '@/features/coursework/service';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub } from '../learner/test-kit';

const actor: Actor = { userId: 'history-owner', roles: [], authorization: { source: 'database', accountStatus: 'active', assignments: [],
  memberships: [{ branchId: 'old-school', status: 'active' }, { branchId: 'suspended-school', status: 'suspended' }] } };
function database(options: { dropped?: boolean; suspended?: boolean; unknown?: boolean } = {}) {
  const scope = { branch_scope_known: !options.unknown, branch_id: options.unknown ? 'untrusted-current-school' : options.suspended ? 'suspended-school' : 'old-school' };
  const base = { user_id: actor.userId, course_version_id: 'version-original', ...scope };
  return new SupabaseStub({
    enrollments: [successful([{ course_id: 'course-owned', course_version_id: 'version-upgraded', status: options.dropped ? 'dropped' : 'active',
      branch_id: 'present-school', branch_scope_known: true }])],
    course_versions: [successful([{ id: 'version-original', course_id: 'course-owned' }])],
    course_version_outline: [successful({ version_id: 'version-original', course_id: 'course-owned', default_language: 'en',
      meta: { title: 'Original course title' }, outline: { modules: [{ items: [
        { id: 'old-lesson', type: 'lesson', title: 'Original lesson' }, { id: 'old-exam', type: 'exam', title: 'Original exam' },
      ] }] } })],
    course_version_items: [successful([
      { item_id: 'old-lesson', kind: 'lesson', grading: { assignments: { 'old-block': {} } } },
      { item_id: 'old-exam', kind: 'exam', grading: { exam: {} } },
    ])],
    assignment_submissions: [successful([{ ...base, id: 'old-submission', item_id: 'old-lesson', block_id: 'old-block',
      grades: { released: true, decision: 'approved', total_points: 7, max_points: 10, passed: true, graded_at: '2026-10-01T00:00:00Z' } }])],
    exam_attempts: [successful([{ ...base, id: 'old-attempt', item_id: 'old-exam', status: 'graded', points: 8, max_points: 10, percent: 80,
      result_available_at: '2026-10-01T00:00:00Z' }])],
    quiz_attempts: [successful([{ ...base, id: 'old-quiz-attempt', item_id: 'old-lesson', quiz_id: 'old-quiz', points: 4, max_points: 5,
      percent: 80, passed: true, submitted_at: '2026-10-01T00:00:00Z' }])],
  });
}

describe('owned historical recorded-results listing', () => {
  it('keeps original versions, titles and review identities after enrollment upgrade without requiring current publication', async () => {
    const db = database();
    const results = await createCourseworkReadService(db).results(actor, { locale: 'en' });
    expect(results.map(({ id }) => id).sort()).toEqual(['old-attempt', 'old-quiz-attempt', 'old-submission']);
    expect(results.every(({ courseVersionId, courseTitle, branchId }) => courseVersionId === 'version-original'
      && courseTitle === 'Original course title' && branchId === 'old-school')).toBe(true);
    expect(results.find(({ id }) => id === 'old-submission')?.href)
      .toBe('/app/courses/course-owned/items/old-lesson/assignment-reviews/old-submission#old-block');
    expect(results.find(({ id }) => id === 'old-attempt')?.href)
      .toBe('/app/courses/course-owned/items/old-exam/exam-reviews/old-attempt');
    expect(results.find(({ id }) => id === 'old-quiz-attempt')?.href)
      .toBe('/app/courses/course-owned/items/old-lesson/quiz-reviews/old-quiz-attempt#old-quiz');
    expect(db.queriesFor('courses')).toHaveLength(0);
    expect(db.queriesFor('profiles')).toHaveLength(0);
    expect(db.queriesFor('course_versions')[0].operations).toContainEqual(['in', 'course_id', ['course-owned']]);
    for (const table of ['assignment_submissions', 'exam_attempts', 'quiz_attempts']) {
      expect(db.queriesFor(table)[0].operations).toContainEqual(['eq', 'user_id', actor.userId]);
      expect(db.queriesFor(table)[0].operations).toContainEqual(['eq', 'course_version_id', 'version-original']);
    }
  });

  it('does not expose history of a dropped course and excludes records from a suspended historical school', async () => {
    expect(await createCourseworkReadService(database({ dropped: true })).results(actor)).toEqual([]);
    expect(await createCourseworkReadService(database({ suspended: true })).results(actor)).toEqual([]);
  });

  it('retains legacy owner history with unknown school without substituting the present school', async () => {
    const db = database({ unknown: true });
    const results = await createCourseworkReadService(db).results(actor);
    expect(results).toHaveLength(3);
    expect(results.every(({ branchId }) => branchId === null)).toBe(true);
    expect(db.queriesFor('profiles')).toHaveLength(0);
    expect(db.queriesFor('branch_memberships')).toHaveLength(0);
  });
});
