import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
import { CalendarQuerySchema, createCourseworkReadService } from '@/features/coursework/service';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub } from '../learner/test-kit';

const actor: Actor = { userId: 'learner', roles: [], authorization: { source: 'database', accountStatus: 'active',
  memberships: [{ branchId: 'school-a', status: 'active' }, { branchId: 'school-b', status: 'suspended' }], assignments: [] } };
const enrollment = { course_id: 'course-a', course_version_id: 'pinned-v1', status: 'active', branch_id: 'school-a', branch_scope_known: true };
const outline = { course_id: 'course-a', version_id: 'pinned-v1', default_language: 'vi', meta: { title: { vi: 'Khóa học', en: 'Course' } },
  outline: { modules: [{ items: [
    { id: 'lesson-a', type: 'lesson', title: { vi: 'Bài học', en: 'Lesson' } },
    { id: 'assignment-a', type: 'assignment', title: 'Project' }, { id: 'exam-a', type: 'exam', title: 'Exam' },
  ] }] } };
const items = [
  { item_id: 'lesson-a', kind: 'lesson', grading: { assignments: { 'embedded-a': {}, 'embedded-b': {} }, questions: { secret: 'answer-key' } } },
  { item_id: 'assignment-a', kind: 'assignment', grading: { assignments: { 'assignment-a': {} } } },
  { item_id: 'exam-a', kind: 'exam', grading: { exam: { openAt: '2026-11-04T17:00:00Z', closeAt: '2026-11-05T17:00:00Z' }, questions: { secret: 'answer-key' } } },
];
function database(extra: ConstructorParameters<typeof SupabaseStub>[0] = {}) {
  const results: NonNullable<ConstructorParameters<typeof SupabaseStub>[0]> = { enrollments: [successful([enrollment])], course_version_outline: [successful(outline)],
    course_versions: [successful([{ id: 'pinned-v1', course_id: 'course-a' }])],
    course_version_items: [successful(items)], assignment_schedules: [successful([])], ...extra };
  for (const table of ['assignment_submissions', 'exam_attempts', 'quiz_attempts'] as const) {
    if (results[table]) results[table] = results[table]!.map((result) => ({ ...result,
      data: Array.isArray(result.data) ? result.data.map((row) => ({ user_id: actor.userId, course_version_id: 'pinned-v1', branch_scope_known: false, ...row })) : result.data,
    }));
  }
  return new SupabaseStub(results);
}

describe('learner coursework read models', () => {
  it('stably prioritizes active exams across the full authorized task set without altering deadlines or other task states', async () => {
    const db = database({
      exam_attempts: [successful([{ id: 'active-attempt', item_id: 'exam-a', status: 'in_progress', attempt_no: 1 }])],
      assignment_schedules: [successful([{ item_id: 'lesson-a', block_id: 'embedded-a', due_at: '2026-11-05T10:00:00+07:00' }])],
      assignment_submissions: [successful([{ id: 'submitted-work', item_id: 'lesson-a', block_id: 'embedded-b', status: 'submitted' }])],
    });
    const tasks = await createCourseworkReadService(db).tasks(actor);
    expect(tasks.map(({ itemId, blockId }) => [itemId, blockId])).toEqual([
      ['exam-a', null], ['lesson-a', 'embedded-a'], ['lesson-a', 'embedded-b'], ['assignment-a', null],
    ]);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ status: 'in_progress', submissionId: 'active-attempt', dueAt: null });
    expect(tasks[1]).toMatchObject({ dueAt: '2026-11-05T03:00:00.000Z', status: 'not_started' });
    expect(tasks[2]).toMatchObject({ status: 'submitted', submissionId: 'submitted-work' });
    expect(new Set(tasks.map(({ id }) => id)).size).toBe(4);
  });

  it.each(['submitted', 'pending_manual', 'graded', 'expired'])('retains stable outline order and truthful %s exam status when there is no active exam', async (status) => {
    const db = database({ exam_attempts: [successful([{ id: 'terminal-attempt', item_id: 'exam-a', status, attempt_no: 1 }])] });
    const tasks = await createCourseworkReadService(db).tasks(actor);
    expect(tasks.map(({ itemId, blockId }) => [itemId, blockId])).toEqual([
      ['lesson-a', 'embedded-a'], ['lesson-a', 'embedded-b'], ['assignment-a', null], ['exam-a', null],
    ]);
    expect(tasks[3]).toMatchObject({ status, dueAt: null });
    expect(tasks[3].status).not.toBe('completed');
  });

  it('keeps the pinned version and distinct embedded identities, hides draft grade status and never projects grading data', async () => {
    const db = database({ assignment_submissions: [successful([
      { id: 'new', item_id: 'lesson-a', block_id: 'embedded-a', status: 'approved', attempt_no: 2, grades: { released: false, decision: 'approved', total_points: 99 } },
      { id: 'other', item_id: 'lesson-a', block_id: 'embedded-b', status: 'submitted', attempt_no: 1 },
    ])], assignment_schedules: [successful([{ item_id: 'lesson-a', block_id: 'embedded-a', due_at: '2026-11-05T10:00:00+07:00' }])] });
    const tasks = await createCourseworkReadService(db).tasks(actor, { locale: 'en' });
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ courseVersionId: 'pinned-v1', branchId: 'school-a', blockId: 'embedded-a', status: 'in_review',
      dueAt: '2026-11-05T03:00:00.000Z', submissionId: 'new', href: '/app/courses/course-a/items/lesson-a#embedded-a', courseTitle: 'Course' });
    expect(tasks[1]).toMatchObject({ blockId: 'embedded-b', submissionId: 'other' });
    expect(tasks[0].id).not.toBe(tasks[1].id);
    expect(JSON.stringify(tasks)).not.toContain('answer-key');
    for (const table of ['assignment_submissions', 'exam_attempts']) {
      expect(db.queriesFor(table)[0].operations).toContainEqual(['eq', 'user_id', 'learner']);
      expect(db.queriesFor(table)[0].operations).toContainEqual(['eq', 'course_version_id', 'pinned-v1']);
    }
    expect(db.queriesFor('assignment_schedules')[0].operations).toContainEqual(['eq', 'branch_id', 'school-a']);
    expect(db.queriesFor('profiles')).toHaveLength(0);
  });

  it('projects only assignment due dates and pinned exam OPEN/CLOSE windows in an end-exclusive UTC range', async () => {
    const db = database({ assignment_schedules: [successful([{ item_id: 'lesson-a', block_id: 'embedded-a', due_at: '2026-11-05T00:00:00+07:00' }])],
      exam_attempts: [successful([{ deadline_at: '2026-11-05T01:00:00Z' }])] });
    const calendar = await createCourseworkReadService(db).calendar(actor, { start: '2026-11-04T17:00:00Z', end: '2026-11-05T17:00:00Z' });
    expect(calendar.timeZone).toBe('Asia/Ho_Chi_Minh');
    expect(calendar.events.map((event) => event.kind)).toEqual(['assignment_due', 'exam_open']);
    expect(calendar.events.every((event) => event.at === '2026-11-04T17:00:00.000Z')).toBe(true);
    expect(db.queriesFor('exam_attempts')).toHaveLength(0);
  });

  it('rejects absent-zone, reversed and unbounded calendar ranges before reading any database', async () => {
    const db = database();
    const service = createCourseworkReadService(db);
    for (const query of [
      { start: '2026-11-05T00:00:00', end: '2026-11-06T00:00:00Z' },
      { start: '2026-11-06T00:00:00Z', end: '2026-11-05T00:00:00Z' },
      { start: '2026-01-01T00:00:00Z', end: '2028-01-01T00:00:00Z' },
    ]) await expect(service.calendar(actor, query)).rejects.toThrow();
    expect(db.queries).toHaveLength(0);
    expect(CalendarQuerySchema.safeParse({ start: '2026-11-05T00:00:00Z', end: '2026-11-06T00:00:00Z', schoolId: 'forged' }).success).toBe(false);
  });

  it('retains personal unknown historical work without guessing school schedules or announcements', async () => {
    const unknown = { ...enrollment, branch_scope_known: false, branch_id: 'untrusted-school' };
    const db = database({ enrollments: [successful([unknown])], assignment_submissions: [successful([])] });
    expect((await createCourseworkReadService(db).tasks(actor))[0]).toMatchObject({ branchId: null, dueAt: null });
    expect(db.queriesFor('assignment_schedules')).toHaveLength(0);
    const announcementsDb = database({ enrollments: [successful([unknown])] });
    expect(await createCourseworkReadService(announcementsDb).announcements(actor)).toEqual([]);
    expect(announcementsDb.queriesFor('teaching_announcements')).toHaveLength(0);
    expect(announcementsDb.queriesFor('profiles')).toHaveLength(0);
  });

  it('omits suspended schools from aggregate views and rejects their selected course', async () => {
    const suspended = { ...enrollment, branch_id: 'school-b' };
    const db = database({ enrollments: [successful([suspended])] });
    expect(await createCourseworkReadService(db).tasks(actor)).toEqual([]);
    expect(db.queriesFor('course_version_outline')).toHaveLength(0);
    const selected = database({ enrollments: [successful([suspended])] });
    await expect(createCourseworkReadService(selected).tasks(actor, { courseId: 'course-a' })).rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_SUSPENDED' });
  });

  it('shows recorded scores only under assignment release and exam result-availability or pinned legacy policy', async () => {
    const exam = (id: string, overrides = {}) => ({ id, item_id: 'exam-a', status: 'graded', points: 8, max_points: 10, percent: 80,
      submitted_at: '2026-11-04T00:00:00Z', result_available_at: null, released_at: null,
      grading_snapshot: { exam: { review: { showScore: 'never' } }, questions: { secret: 'answer-key' } }, ...overrides });
    const db = database({ assignment_submissions: [successful([
      { id: 'draft', item_id: 'assignment-a', block_id: null, grades: { released: false, total_points: 10, max_points: 10 } },
      { id: 'released', item_id: 'lesson-a', block_id: 'embedded-a', grades: { released: true, total_points: '7', max_points: '10', passed: false, decision: 'changes_requested', graded_at: '2026-11-04T12:00:00Z' } },
    ])], exam_attempts: [successful([
      exam('hidden'), exam('pending', { status: 'pending_manual', released_at: '2026-11-04T12:00:00Z' }),
      exam('completed', { result_available_at: '2026-11-04T12:00:00Z' }),
      exam('legacy-visible', { grading_snapshot: { exam: { review: { showScore: 'on_release' } } }, released_at: '2026-11-04T12:00:00Z' }),
      exam('legacy-immediate', { grading_snapshot: { exam: { review: { showScore: 'immediately' } } } }),
    ])], quiz_attempts: [successful([{ id: 'quiz-score', item_id: 'lesson-a', quiz_id: 'quiz-a', points: 4, max_points: 5, percent: 80, passed: true, submitted_at: '2026-11-04T11:00:00Z' }])] });
    const results = await createCourseworkReadService(db).results(actor);
    expect(results.map((result) => result.id).sort()).toEqual(['completed', 'legacy-immediate', 'legacy-visible', 'quiz-score', 'released']);
    expect(results.find((result) => result.id === 'released')).toMatchObject({ points: 7, maxPoints: 10, percent: null, blockId: 'embedded-a', passed: false });
    expect(JSON.stringify(results)).not.toContain('answer-key');
    expect(results.every((result) => !('grading' in result) && !('grading_snapshot' in result))).toBe(true);
  });

  it('scopes announcements by enrollment school/course and excludes future publications', async () => {
    const db = database({ teaching_announcements: [successful([
      { id: 'visible', title: 'A', body: 'Body', published_at: '2026-11-04T00:00:00Z' },
      { id: 'future', title: 'B', body: 'Future', published_at: '2026-12-04T00:00:00Z' },
    ])] });
    const result = await createCourseworkReadService(db, () => new Date('2026-11-05T00:00:00Z')).announcements(actor);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'visible', branchId: 'school-a', courseId: 'course-a' });
    expect(db.queriesFor('teaching_announcements')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'branch_id', 'school-a'], ['eq', 'course_id', 'course-a'], ['eq', 'status', 'published'],
    ]));
  });

  it('gives every recorded attempt and submission a distinct review selector while retaining embedded block anchors', async () => {
    const releasedSubmission = (id: string, blockId: string | null) => ({ id,
      item_id: blockId ? 'lesson-a' : 'assignment-a', block_id: blockId,
      grades: { released: true, total_points: 7, max_points: 10, decision: 'changes_requested', graded_at: '2026-11-04T12:00:00Z' },
    });
    const recordedExam = (id: string) => ({ id, item_id: 'exam-a', status: 'graded', points: 8, max_points: 10, percent: 80,
      result_available_at: '2026-11-04T12:00:00Z', submitted_at: '2026-11-04T11:00:00Z' });
    const db = database({
      assignment_submissions: [successful([
        releasedSubmission('submission-earlier', 'embedded-a'), releasedSubmission('submission-later', 'embedded-a'),
        releasedSubmission('submission-standalone', null),
      ])],
      exam_attempts: [successful([recordedExam('exam-earlier'), recordedExam('exam-later')])],
      quiz_attempts: [successful([{ id: 'quiz-earlier', item_id: 'lesson-a', quiz_id: 'quiz-a', points: 4, max_points: 5,
        percent: 80, passed: true, submitted_at: '2026-11-04T11:00:00Z' }])],
    });
    const results = await createCourseworkReadService(db).results(actor);
    const byId = new Map(results.map((result) => [result.id, result]));
    expect(byId.get('submission-earlier')?.href).toBe('/app/courses/course-a/items/lesson-a/assignment-reviews/submission-earlier#embedded-a');
    expect(byId.get('submission-later')?.href).toBe('/app/courses/course-a/items/lesson-a/assignment-reviews/submission-later#embedded-a');
    expect(byId.get('submission-standalone')?.href).toBe('/app/courses/course-a/items/assignment-a/assignment-reviews/submission-standalone');
    expect(byId.get('exam-earlier')?.href).toBe('/app/courses/course-a/items/exam-a/exam-reviews/exam-earlier');
    expect(byId.get('exam-later')?.href).toBe('/app/courses/course-a/items/exam-a/exam-reviews/exam-later');
    expect(byId.get('quiz-earlier')?.href).toBe('/app/courses/course-a/items/lesson-a/quiz-reviews/quiz-earlier#quiz-a');
    expect(new Set(results.map((result) => result.href)).size).toBe(results.length);
    expect(results.every((result) => result.courseVersionId === 'pinned-v1')).toBe(true);
  });

});
