import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import type { Actor } from '@/lib/permissions';
import { getCourse, listCatalog } from '@/features/catalog/service';
import { successful, SupabaseStub } from './test-kit';

const actor: Actor = { userId: 'learner-1', roles: [] };

const outlineRow = (overrides: Record<string, unknown> = {}) => ({
  version_id: 'version-1',
  course_id: 'ai-foundations',
  outline: {
    modules: [{
      id: 'module-1',
      title: { vi: 'Nen tang', en: 'Foundations' },
      items: [{ id: 'lesson-1', type: 'lesson', title: { vi: 'Bai hoc', en: 'Lesson' }, required: true }],
    }],
  },
  meta: {
    title: { vi: 'AI can ban', en: 'AI Foundations' },
    summary: { vi: 'Tom tat', en: 'Summary' },
    level: 'foundation',
    difficulty: 'beginner',
    pathway: 'ai-emerging-technology',
    tags: ['ai'],
    learningOutcomes: [{ vi: 'Hieu AI', en: 'Understand AI' }],
  },
  access: { scope: 'global' },
  completion: { rules: [{ type: 'all_items' }], certificate: true },
  skills: [{ id: 'ai-literacy', name: { vi: 'AI', en: 'AI literacy' } }],
  languages: ['vi', 'en'],
  default_language: 'vi',
  course_versions: {
    course_id: 'ai-foundations',
    courses: { id: 'ai-foundations', slug: 'ai-foundations', status: 'published', current_version_id: 'version-1' },
  },
  ...overrides,
});

beforeEach(() => mocks.supabaseService.mockReset());

describe('learner catalog service', () => {
  it('blocks enrolled course detail only at its explicitly suspended trusted branch',async()=>{
    const suspended:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'},{branchId:'school-b',status:'active'}],assignments:[]}};
    const client=new SupabaseStub({
      courses:[successful({id:'ai-foundations',status:'published',current_version_id:'version-current'})],
      enrollments:[successful({id:'enrollment-1',course_version_id:'version-1',status:'active',branch_id:'school-a',branch_scope_known:true})],
    });
    mocks.supabaseService.mockReturnValue(client);
    await expect(getCourse(suspended,'ai-foundations','en')).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
  });
  it('filters published accessible courses by every catalog filter and localizes metadata', async () => {
    const wrongBranch = outlineRow({
      version_id: 'version-branch',
      course_id: 'branch-course',
      access: { scope: 'branches', branchIds: ['branch-2'] },
      course_versions: { course_id: 'branch-course', courses: { id: 'branch-course', status: 'published', current_version_id: 'version-branch' } },
    });
    const wrongDifficulty = outlineRow({
      version_id: 'version-advanced',
      course_id: 'advanced-course',
      meta: { ...(outlineRow().meta as object), difficulty: 'advanced' },
      course_versions: { course_id: 'advanced-course', courses: { id: 'advanced-course', status: 'published', current_version_id: 'version-advanced' } },
    });
    const client = new SupabaseStub({
      profiles: [successful({ branch_id: 'branch-1' })],
      courses: [successful([
        { id: 'ai-foundations', slug: 'ai-foundations', status: 'published', current_version_id: 'version-1' },
        { id: 'branch-course', slug: 'branch-course', status: 'published', current_version_id: 'version-branch' },
        { id: 'advanced-course', slug: 'advanced-course', status: 'published', current_version_id: 'version-advanced' },
      ])],
      course_version_outline: [successful([outlineRow(), wrongBranch, wrongDifficulty])],
      enrollments: [successful([{
        course_id: 'ai-foundations', course_version_id: 'version-1', status: 'active',
      }])],
    });
    mocks.supabaseService.mockReturnValue(client);

    const courses = await listCatalog(actor, 'en', {
      level: 'foundation',
      pathway: 'ai-emerging-technology',
      difficulty: 'beginner',
      language: 'en',
    });

    expect(courses).toEqual([expect.objectContaining({
      id: 'ai-foundations',
      title: 'AI Foundations',
      summary: 'Summary',
      learningOutcomes: ['Understand AI'],
      enrollment: { status: 'active', courseVersionId: 'version-1' },
    })]);
    expect(client.queriesFor('course_version_outline')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'meta->>level', 'foundation'],
      ['eq', 'meta->>pathway', 'ai-emerging-technology'],
      ['eq', 'meta->>difficulty', 'beginner'],
      ['contains', 'languages', ['en']],
    ]));
    expect(client.queriesFor('courses')[0].operations).toContainEqual(['eq', 'status', 'published']);
    expect(client.queriesFor('course_version_outline')[0].operations[0][1]).not.toContain('course_versions');
  });

  it('treats a dropped enrollment as available course discovery', async () => {
    const client = new SupabaseStub({
      profiles: [successful({ branch_id: 'branch-1' })],
      courses: [successful([{
        id: 'ai-foundations', slug: 'ai-foundations', status: 'published', current_version_id: 'version-1',
      }])],
      course_version_outline: [successful([outlineRow()])],
      enrollments: [successful([{
        course_id: 'ai-foundations', course_version_id: 'version-old', status: 'dropped',
      }])],
    });
    mocks.supabaseService.mockReturnValue(client);

    const [course] = await listCatalog(actor, 'en');

    expect(course.enrollment).toBeNull();
    expect(course.versionId).toBe('version-1');
  });

  describe('internal fixture guard', () => {
    afterEach(() => vi.unstubAllEnvs());
    const fixtureClient = () => new SupabaseStub({
      profiles: [successful({ branch_id: null })],
      courses: [successful([
        { id: 'ai-foundations', slug: 'ai-foundations', status: 'published', current_version_id: 'version-1' },
        { id: 'recovery-enrolled', slug: 'recovery-enrolled', status: 'published', current_version_id: 'version-2' },
        { id: 'recovery-browse', slug: 'recovery-browse', status: 'published', current_version_id: 'version-3' },
      ])],
      course_version_outline: [successful([
        outlineRow(),
        outlineRow({ version_id: 'version-2', course_id: 'recovery-enrolled' }),
        outlineRow({ version_id: 'version-3', course_id: 'recovery-browse' }),
      ])],
      enrollments: [successful([{ course_id: 'recovery-enrolled', course_version_id: 'version-2', status: 'active' }])],
    });

    it('lists fixture courses while HIDE_INTERNAL_CONTENT is unset', async () => {
      mocks.supabaseService.mockReturnValue(fixtureClient());
      expect((await listCatalog(actor, 'en')).map(({ id }) => id)).toEqual(['ai-foundations', 'recovery-enrolled', 'recovery-browse']);
    });

    it('hides unenrolled fixtures but keeps the ones the learner is enrolled in', async () => {
      vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
      mocks.supabaseService.mockReturnValue(fixtureClient());
      expect((await listCatalog(actor, 'en')).map(({ id }) => id)).toEqual(['ai-foundations', 'recovery-enrolled']);
    });
  });

  it('returns a localized pinned outline with enrollment progress and evaluated requirements', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', slug: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-1', status: 'active', enrolled_at: '2026-09-01T00:00:00Z' })],
      course_version_outline: [successful(outlineRow())],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      quiz_attempts: [successful([])],
      course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);

    const course = await getCourse(actor, 'ai-foundations', 'en');

    expect(course).toMatchObject({
      id: 'ai-foundations',
      versionId: 'version-1',
      meta: { title: 'AI Foundations', learningOutcomes: ['Understand AI'] },
      outline: { modules: [{ title: 'Foundations', items: [{ title: 'Lesson', status: 'completed' }] }] },
      enrollment: { id: 'enrollment-1', status: 'active' },
      progress: { completedItems: 1, totalItems: 1 },
      completion: { complete: true, requirements: [{ satisfied: true, progress: { done: 1, total: 1 } }] },
    });
    expect(client.queriesFor('profiles')).toHaveLength(0);
    expect(client.queriesFor('course_version_outline')).toHaveLength(1);
    expect(client.queriesFor('course_version_outline')[0].operations).toContainEqual(['eq', 'version_id', 'version-1']);
  });

  it('keeps course detail accessible to an active enrollee after the current course is re-scoped', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-current', status: 'active' })],
      course_version_outline: [successful(outlineRow({
        version_id: 'version-current', access: { scope: 'branches', branchIds: ['branch-2'] },
      }))],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      quiz_attempts: [successful([])],
      course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getCourse(actor, 'ai-foundations', 'en')).resolves.toMatchObject({
      id: 'ai-foundations', versionId: 'version-current', enrollment: { status: 'active' },
    });
    expect(client.queriesFor('profiles')).toHaveLength(0);
    expect(client.queriesFor('course_version_outline')).toHaveLength(1);
  });

  it('returns not found when a non-enrolled learner cannot see a branch-scoped course', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful(null)],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful(outlineRow({
        version_id: 'version-current', access: { scope: 'branches', branchIds: ['branch-2'] },
      }))],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getCourse(actor, 'ai-foundations', 'en')).rejects.toMatchObject({
      status: 404, code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('lesson_progress')).toHaveLength(0);
  });

  it('projects pinned exam lifecycle and assignment activity without awarding completion', async () => {
    const activityItems = [
      { id: 'lesson-1', type: 'lesson', title: 'Lesson', required: true },
      { id: 'exam-active', type: 'exam', title: 'Active exam', required: true },
      { id: 'exam-submitted', type: 'exam', title: 'Submitted exam', required: true },
      { id: 'exam-failed', type: 'exam', title: 'Failed exam', required: true },
      { id: 'exam-untouched', type: 'exam', title: 'Untouched exam', required: true },
      { id: 'assignment-submitted', type: 'assignment', title: 'Submitted assignment', required: true },
      { id: 'assignment-changes', type: 'assignment', title: 'Revision requested', required: true },
      { id: 'assignment-approved', type: 'assignment', title: 'Approved assignment', required: true },
    ];
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-pinned', status: 'active' })],
      course_version_outline: [successful(outlineRow({ version_id: 'version-pinned', outline: {
        modules: [{ id: 'module-1', title: 'Module', items: activityItems }],
      } }))],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_attempts: [successful([
        { id: 'active-attempt', user_id: 'learner-1', course_version_id: 'version-pinned', item_id: 'exam-active', status: 'in_progress', attempt_no: 1, started_at: '2026-11-05T10:00:00Z' },
        { id: 'submitted-attempt', user_id: 'learner-1', course_version_id: 'version-pinned', item_id: 'exam-submitted', status: 'submitted', attempt_no: 1, started_at: '2026-11-05T10:00:00Z' },
        { id: 'graded-attempt', user_id: 'learner-1', course_version_id: 'version-pinned', item_id: 'exam-failed', status: 'graded', attempt_no: 1, started_at: '2026-11-05T10:00:00Z' },
      ])],
      exam_grades: [successful([{ item_id: 'exam-failed', percent: 30, passed: false }])],
      assignment_submissions: [successful([
        { item_id: 'assignment-submitted', block_id: null, status: 'submitted', grades: null },
        { item_id: 'assignment-changes', block_id: null, status: 'changes_requested', grades: { released: true, decision: 'changes_requested' } },
        { item_id: 'assignment-approved', block_id: null, status: 'approved', grades: { released: true, decision: 'approved' } },
      ])],
      quiz_attempts: [successful([])],
      course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);

    const course = await getCourse(actor, 'ai-foundations', 'en');

    expect(course.progress).toEqual({ completedItems: 2, totalItems: 8, items: {
      'lesson-1': 'completed', 'exam-active': 'in_progress', 'exam-submitted': 'submitted',
      'exam-failed': 'submitted', 'exam-untouched': 'not_started', 'assignment-submitted': 'in_progress',
      'assignment-changes': 'in_progress', 'assignment-approved': 'completed',
    } });
    expect(course.completion).toMatchObject({ complete: false, requirements: [{ satisfied: false, progress: { done: 2, total: 8 } }] });
    expect(course.outline.modules[0].items.map(({ id, status }) => [id, status])).toEqual(Object.entries(course.progress.items));
    expect(client.queriesFor('exam_attempts')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'learner-1'], ['eq', 'course_version_id', 'version-pinned'],
    ]));
    expect(client.queriesFor('profiles')).toHaveLength(0);
  });

  it('keeps a passing exam complete while another attempt is active and does not mutate recorded totals', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-pinned', status: 'active' })],
      course_version_outline: [successful(outlineRow({ version_id: 'version-pinned', outline: {
        modules: [{ id: 'module-1', title: 'Module', items: [{ id: 'exam-passed', type: 'exam', title: 'Exam', required: true }] }],
      } }))],
      lesson_progress: [successful([])], exam_attempts: [successful([{ id: 'passed-active', user_id: 'learner-1', course_version_id: 'version-pinned', item_id: 'exam-passed', status: 'in_progress', attempt_no: 2, started_at: '2026-11-05T10:00:00Z' }])],
      exam_grades: [successful([{ item_id: 'exam-passed', percent: 80, passed: true }])],
      assignment_submissions: [successful([])], quiz_attempts: [successful([])], course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    const course = await getCourse(actor, 'ai-foundations', 'en');
    expect(course.progress).toEqual({ completedItems: 1, totalItems: 1, items: { 'exam-passed': 'completed' } });
    expect(course.completion.complete).toBe(true);
    expect(client.queries.flatMap(({ query }) => query.operations).some(([operation]) => ['insert', 'update', 'upsert'].includes(operation))).toBe(false);
  });


  it.each(['active', 'completed'])('keeps an archived course readable through its %s enrollment pin without requiring a current public version', async (status) => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'archived', current_version_id: null })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-pinned', status })],
      course_version_outline: [successful(outlineRow({ version_id: 'version-pinned' }))],
      lesson_progress: [successful([])], exam_attempts: [successful([])], exam_grades: [successful([])],
      assignment_submissions: [successful([])], quiz_attempts: [successful([])], course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    await expect(getCourse(actor, 'ai-foundations', 'en')).resolves.toMatchObject({
      id: 'ai-foundations', versionId: 'version-pinned', enrollment: { status },
    });
    expect(client.queriesFor('course_version_outline')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'version_id', 'version-pinned'], ['eq', 'course_id', 'ai-foundations'],
    ]));
    expect(client.queriesFor('profiles')).toHaveLength(0);
    expect(client.queries.flatMap(({ query }) => query.operations).some(([operation]) => ['insert', 'update', 'upsert'].includes(operation))).toBe(false);
  });

  it.each([null, { course_version_id: 'version-pinned', status: 'dropped' }])('does not expose archived course content without an active or completed owned enrollment (%j)', async (enrollment) => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'archived', current_version_id: 'version-current' })],
      enrollments: [successful(enrollment)],
    });
    mocks.supabaseService.mockReturnValue(client);
    await expect(getCourse(actor, 'ai-foundations', 'en')).rejects.toMatchObject({ status: 404, code: 'COURSE_NOT_FOUND' });
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
    expect(client.queriesFor('lesson_progress')).toHaveLength(0);
  });

  it('does not expose draft course content through an enrollment pin', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'draft', current_version_id: 'version-current' })],
      enrollments: [successful({ course_version_id: 'version-pinned', status: 'active' })],
    });
    mocks.supabaseService.mockReturnValue(client);
    await expect(getCourse(actor, 'ai-foundations', 'en')).rejects.toMatchObject({ status: 404, code: 'COURSE_NOT_FOUND' });
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
  });

  it('still denies archived pinned history for an explicitly suspended enrollment school', async () => {
    const client = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'archived', current_version_id: null })],
      enrollments: [successful({ course_version_id: 'version-pinned', status: 'active', branch_id: 'school-a', branch_scope_known: true })],
    });
    const suspended: Actor = { userId: 'learner-1', roles: [], authorization: { source: 'database', accountStatus: 'active',
      memberships: [{ branchId: 'school-a', status: 'suspended' }], assignments: [] } };
    mocks.supabaseService.mockReturnValue(client);
    await expect(getCourse(suspended, 'ai-foundations', 'en')).rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_SUSPENDED' });
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
  });

  describe('public exam lifecycle projection', () => {
    const attempt = (status: string, overrides: Record<string, unknown> = {}) => ({ id: 'owned-attempt', user_id: 'learner-1',
      course_version_id: 'version-pinned', item_id: 'exam-lifecycle', status, attempt_no: 1, started_at: '2026-11-05T10:00:00Z', ...overrides });
    const databaseFor = (attempts: unknown[], grades: unknown[] = []) => new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      enrollments: [successful({ id: 'enrollment-1', course_version_id: 'version-pinned', status: 'active' })],
      course_version_outline: [successful(outlineRow({ version_id: 'version-pinned', outline: {
        modules: [{ id: 'module-1', title: 'Module', items: [{ id: 'exam-lifecycle', type: 'exam', title: 'Exam', required: true }] }],
      } }))],
      lesson_progress: [successful([])], exam_attempts: [successful(attempts)], exam_grades: [successful(grades)],
      assignment_submissions: [successful([])], quiz_attempts: [successful([])], course_completions: [successful(null)],
    });

    it.each([
      ['in_progress', 'in_progress'], ['pending_manual', 'in_review'], ['submitted', 'submitted'],
      ['submitted_late', 'submitted'], ['graded', 'submitted'], ['expired', 'expired'],
    ])('shows %s as %s without granting completion or exposing private score fields', async (storedStatus, publicStatus) => {
      const db = databaseFor([attempt(storedStatus, { points: 99, max_points: 100, percent: 99 })]);
      mocks.supabaseService.mockReturnValue(db);
      const course = await getCourse(actor, 'ai-foundations', 'en');
      expect(course.progress).toEqual({ completedItems: 0, totalItems: 1, items: { 'exam-lifecycle': publicStatus } });
      expect(course.outline.modules[0].items[0].status).toBe(publicStatus);
      expect(course.completion.complete).toBe(false);
      const selected = String(db.queriesFor('exam_attempts')[0].operations.find(([operation]) => operation === 'select')?.[1]);
      expect(selected).not.toMatch(/points|percent|grading|released/);
      expect(JSON.stringify(course)).not.toContain('max_points');
    });

    it('uses the latest numbered attempt rather than an older active attempt, regardless of input row order', async () => {
      const db = databaseFor([
        attempt('in_progress', { id: 'older', attempt_no: 1, started_at: '2026-11-05T11:00:00Z' }),
        attempt('pending_manual', { id: 'latest', attempt_no: 2, started_at: '2026-11-05T10:00:00Z' }),
      ]);
      mocks.supabaseService.mockReturnValue(db);
      const course = await getCourse(actor, 'ai-foundations', 'en');
      expect(course.progress.items['exam-lifecycle']).toBe('in_review');
      expect(course.progress.completedItems).toBe(0);
      expect(db.queriesFor('exam_attempts')[0].operations).toEqual(expect.arrayContaining([
        ['eq', 'user_id', 'learner-1'], ['eq', 'course_version_id', 'version-pinned'],
        ['order', 'attempt_no', { ascending: false }], ['order', 'started_at', { ascending: false }],
      ]));
    });

    it('rejects mismatched owner and version rows before selecting the latest public lifecycle', async () => {
      const db = databaseFor([
        attempt('in_progress', { id: 'other-owner', user_id: 'another-user', attempt_no: 20 }),
        attempt('in_progress', { id: 'other-pin', course_version_id: 'version-other', attempt_no: 19 }),
        attempt('submitted_late'),
      ]);
      mocks.supabaseService.mockReturnValue(db);
      expect((await getCourse(actor, 'ai-foundations', 'en')).progress.items['exam-lifecycle']).toBe('submitted');
    });

    it('keeps recorded completion authoritative even when the latest attempt expired', async () => {
      const db = databaseFor([attempt('expired')], [{ item_id: 'exam-lifecycle', percent: 70, passed: true }]);
      mocks.supabaseService.mockReturnValue(db);
      const course = await getCourse(actor, 'ai-foundations', 'en');
      expect(course.progress).toEqual({ completedItems: 1, totalItems: 1, items: { 'exam-lifecycle': 'completed' } });
      expect(course.completion.complete).toBe(true);
    });

    it('uses legacy recorded grade evidence as submitted when no attempt lifecycle exists, without inventing completion', async () => {
      const db = databaseFor([], [{ item_id: 'exam-lifecycle', percent: 20, passed: false }]);
      mocks.supabaseService.mockReturnValue(db);
      const course = await getCourse(actor, 'ai-foundations', 'en');
      expect(course.progress).toEqual({ completedItems: 0, totalItems: 1, items: { 'exam-lifecycle': 'submitted' } });
      expect(course.completion.complete).toBe(false);
    });
  });

});
