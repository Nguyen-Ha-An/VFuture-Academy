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
});
