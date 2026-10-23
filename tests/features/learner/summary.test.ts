import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { readLearnerHome, readLearnerRewards } from '@/features/learner/summary';
import { successful, SupabaseStub } from './test-kit';

describe('learner summary readers', () => {
  it('loads XP, streak and certificate evidence through the completion-effect services', async () => {
    const database = new SupabaseStub({
      profiles: [successful({
        display_name: 'Avery', handle: 'avery', avatar_url: '/avatar.png', locale: 'vi', profile_public: true,
      })],
      streaks: [successful({ current_streak: 3, longest_streak: 7, last_active_date: '2026-09-02' })],
      certificates: [successful([{
        id: 'certificate-1', user_id: 'user-1', course_id: 'ai-foundations', course_version_id: 'version-1', serial: 'VFA-2026-ABCD',
        issued_at: '2026-09-02T00:00:00Z', pdf_asset_id: 'asset-cert', verification_code: 'verify-1',
      }])],
      course_version_outline: [successful([{
        version_id: 'version-1', default_language: 'vi', meta: { title: { vi: 'Nền tảng AI', en: 'AI Foundations' } },
      }])],
    }, {
      xp_user_total: [successful({ total_points: 35, weekly_points: 20 })],
    });

    await expect(readLearnerRewards({ userId: 'user-1', roles: [] }, 'en', database)).resolves.toEqual({
      profile: {
        displayName: 'Avery', handle: 'avery', avatarUrl: '/avatar.png', locale: 'vi', profilePublic: true,
      },
      xpTotal: 35,
      streak: { current: 3, longest: 7, lastActiveDate: '2026-09-02' },
      certificates: [{
        id: 'certificate-1', courseId: 'ai-foundations', courseTitle: 'AI Foundations', serial: 'VFA-2026-ABCD',
        issuedAt: '2026-09-02T00:00:00Z', pdfAssetId: 'asset-cert', verificationCode: 'verify-1',
      }],
    });
    expect(database.queriesFor('xp_events')).toHaveLength(0);
    expect(database.rpcCalls).toContainEqual({ name: 'xp_user_total', args: { user_id: 'user-1' } });
  });

  it('uses empty reward states when completion-effects rows do not exist yet', async () => {
    const database = new SupabaseStub({ profiles: [successful(null)] });

    const result = await readLearnerRewards({ userId: 'user-1', roles: [] }, 'vi', database);

    expect(result.xpTotal).toBe(0);
    expect(result.streak).toEqual({ current: 0, longest: 0, lastActiveDate: null });
    expect(result.certificates).toEqual([]);
  });

  it('orders targets by enrollment, skips completed work, and bounds exam render reads', async () => {
    const database = new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' })],
      enrollments: [successful([
        { course_id: 'course-first', course_version_id: 'version-first', status: 'active', enrolled_at: '2026-09-02T00:00:00Z' },
        { course_id: 'course-second', course_version_id: 'version-second', status: 'active', enrolled_at: '2026-09-01T00:00:00Z' },
      ])],
      course_version_outline: [successful([
        {
          version_id: 'version-second', course_id: 'course-second', default_language: 'en',
          meta: { title: 'Second course' },
          outline: { modules: [{ items: [{ id: 'lesson-second', type: 'lesson', title: 'Second lesson', required: true }] }] },
        },
        {
          version_id: 'version-first', course_id: 'course-first', default_language: 'en',
          meta: { title: 'First course' },
          outline: { modules: [{ items: [
            { id: 'lesson-done', type: 'lesson', title: 'Completed lesson', required: true },
            { id: 'exam-passed', type: 'exam', title: 'Passed exam', required: true },
            { id: 'exam-upcoming', type: 'exam', title: 'Upcoming exam', required: true },
          ] }] },
        },
      ])],
      lesson_progress: [successful([{
        course_version_id: 'version-first', item_id: 'lesson-done', status: 'completed',
      }])],
      exam_grades: [successful([{
        course_version_id: 'version-first', item_id: 'exam-passed', passed: true,
      }])],
      assignment_submissions: [successful([])],
      activity_state: [successful([{
        course_version_id: 'version-second', item_id: 'lesson-second', updated_at: '2026-09-03T00:00:00Z',
      }])],
      course_version_item_renders: [successful([
        {
          version_id: 'version-first', item_id: 'exam-passed', locale: 'en',
          payload: { kind: 'exam', settings: { availability: { openAt: '2026-09-05T00:00:00Z', closeAt: '2026-09-06T00:00:00Z' } } },
        },
        {
          version_id: 'version-first', item_id: 'exam-upcoming', locale: 'en',
          payload: { kind: 'exam', settings: { availability: { openAt: '2026-09-10T00:00:00Z', closeAt: '2026-09-12T00:00:00Z' } } },
        },
      ])],
    });

    const result = await readLearnerHome(
      { userId: 'user-1', roles: [] },
      'en',
      database,
      new Date('2026-09-03T00:00:00Z'),
    );

    expect(result.continueLearning).toMatchObject({ courseId: 'course-second', itemId: 'lesson-second' });
    expect(result.nextRequired).toMatchObject({ courseId: 'course-first', itemId: 'exam-upcoming' });
    expect(result.upcomingExam).toEqual({
      courseId: 'course-first',
      courseTitle: 'First course',
      itemId: 'exam-upcoming',
      itemTitle: 'Upcoming exam',
      kind: 'exam',
      openAt: '2026-09-10T00:00:00Z',
      closeAt: '2026-09-12T00:00:00Z',
    });
    expect(database.queriesFor('enrollments')[0].operations).toContainEqual([
      'order', 'enrolled_at', { ascending: false },
    ]);
    expect(database.queriesFor('course_version_item_renders')[0].operations).toContainEqual([
      'in', 'item_id', ['exam-passed', 'exam-upcoming'],
    ]);
  });

  it('uses a default-locale exam render for the upcoming exam card', async () => {
    const database = new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' })],
      enrollments: [successful([{
        course_id: 'course-1', course_version_id: 'version-1', status: 'active', enrolled_at: '2026-09-02T00:00:00Z',
      }])],
      course_version_outline: [successful([{
        version_id: 'version-1', course_id: 'course-1', default_language: 'vi', meta: { title: { vi: 'Khóa học' } },
        outline: { modules: [{ items: [{ id: 'exam-1', type: 'exam', title: { vi: 'Kỳ thi' }, required: true }] }] },
      }])],
      lesson_progress: [successful([])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      activity_state: [successful([])],
      course_version_item_renders: [successful([{
        version_id: 'version-1', item_id: 'exam-1', locale: 'vi',
        payload: { kind: 'exam', settings: { availability: { openAt: '2026-09-10T00:00:00Z', closeAt: '2026-09-12T00:00:00Z' } } },
      }])],
    });

    const result = await readLearnerHome(
      { userId: 'user-1', roles: [] },
      'en',
      database,
      new Date('2026-09-03T00:00:00Z'),
    );

    expect(result.upcomingExam).toMatchObject({ itemId: 'exam-1', itemTitle: 'Kỳ thi' });
    expect(database.queriesFor('course_version_item_renders')[0].operations).toContainEqual([
      'in', 'locale', ['en', 'vi'],
    ]);
  });

  it('does not resume a recently saved item after that item is complete', async () => {
    const database = new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' })],
      enrollments: [successful([{
        course_id: 'course-1', course_version_id: 'version-1', status: 'active', enrolled_at: '2026-09-02T00:00:00Z',
      }])],
      course_version_outline: [successful([{
        version_id: 'version-1', course_id: 'course-1', default_language: 'en', meta: { title: 'Course' },
        outline: { modules: [{ items: [
          { id: 'lesson-done', type: 'lesson', title: 'Done', required: true },
          { id: 'lesson-next', type: 'lesson', title: 'Next', required: true },
          { id: 'lesson-resume', type: 'lesson', title: 'Resume here', required: false },
        ] }] },
      }])],
      lesson_progress: [successful([{ course_version_id: 'version-1', item_id: 'lesson-done', status: 'completed' }])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      activity_state: [successful([
        { course_version_id: 'version-1', item_id: 'lesson-done', updated_at: '2026-09-03T00:00:00Z' },
        { course_version_id: 'version-1', item_id: 'lesson-resume', updated_at: '2026-09-02T00:00:00Z' },
      ])],
    });

    const result = await readLearnerHome({ userId: 'user-1', roles: [] }, 'en', database);

    expect(result.continueLearning).toMatchObject({ itemId: 'lesson-resume' });
    expect(result.nextRequired).toMatchObject({ itemId: 'lesson-next' });
  });

  it('requires a released approval before removing a legacy assignment from home targets', async () => {
    const databaseForGrade = (released: boolean) => new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' }), successful({ branch_id: 'branch-1' })],
      enrollments: [successful([{
        course_id: 'course-1', course_version_id: 'version-1', status: 'active', enrolled_at: '2026-09-02T00:00:00Z',
      }])],
      course_version_outline: [successful([{
        version_id: 'version-1', course_id: 'course-1', default_language: 'en', meta: { title: 'Course' },
        outline: { modules: [{ items: [{ id: 'assignment-1', type: 'assignment', title: 'Project', required: true }] }] },
      }])],
      lesson_progress: [successful([])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([{
        course_version_id: 'version-1', item_id: 'assignment-1', status: 'approved',
        submitted_at: '2026-09-03T00:00:00Z', grades: [{ decision: 'approved', released }],
      }])],
      activity_state: [successful([])],
    });
    const dependencies = { recommended: vi.fn().mockResolvedValue(undefined), listSubmissions: vi.fn().mockResolvedValue([]) };

    const draft = await readLearnerHome({ userId: 'user-1', roles: [] }, 'en', databaseForGrade(false), new Date(), dependencies);
    const released = await readLearnerHome({ userId: 'user-1', roles: [] }, 'en', databaseForGrade(true), new Date(), dependencies);

    expect(draft.nextRequired).toMatchObject({ itemId: 'assignment-1' });
    expect(released.nextRequired).toBeNull();
  });

  it('uses the server-derived branch for an eligible recommendation even without an enrollment', async () => {
    const recommended = vi.fn().mockResolvedValue({
      id: 'branch-internship', title: 'Branch internship', organization: 'VFuture', type: 'external_program',
    });
    const database = new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' }), successful({ branch_id: 'branch-1' })],
      enrollments: [successful([])],
    });

    const result = await readLearnerHome(
      { userId: 'user-1', roles: [] },
      'en',
      database,
      new Date('2026-09-05T00:00:00Z'),
      { recommended, listSubmissions: vi.fn().mockResolvedValue([]) },
    );

    expect(recommended).toHaveBeenCalledWith({
      userId: 'user-1', branchId: 'branch-1', locale: 'en', now: new Date('2026-09-05T00:00:00Z'),
    });
    expect(result.recommendedOpportunity).toMatchObject({ id: 'branch-internship' });
  });

  it('shows only released assignment feedback from the pinned course version', async () => {
    const listSubmissions = vi.fn().mockResolvedValue([
      {
        id: 'new-unreleased', course_version_id: 'version-1', submitted_at: '2026-09-05T00:00:00Z',
        grades: [{ released: false, decision: 'changes_requested', feedback: { en: 'Hidden notes' }, graded_at: '2026-09-05T01:00:00Z' }],
      },
      {
        id: 'wrong-version', course_version_id: 'version-2', submitted_at: '2026-09-04T00:00:00Z',
        grades: [{ released: true, decision: 'changes_requested', feedback: { en: 'Wrong version' }, graded_at: '2026-09-04T01:00:00Z' }],
      },
      {
        id: 'released', course_version_id: 'version-1', submitted_at: '2026-09-03T00:00:00Z',
        grades: [{ released: true, decision: 'changes_requested', feedback: { en: 'Clarify your evidence.' }, graded_at: '2026-09-03T01:00:00Z' }],
      },
    ]);
    const database = new SupabaseStub({
      profiles: [successful({ display_name: 'Avery', locale: 'en' }), successful({ branch_id: 'branch-1' })],
      enrollments: [successful([{
        course_id: 'course-1', course_version_id: 'version-1', status: 'completed', enrolled_at: '2026-09-02T00:00:00Z',
      }])],
      course_version_outline: [successful([{
        version_id: 'version-1', course_id: 'course-1', default_language: 'en', meta: { title: 'Course' },
        outline: { modules: [{ items: [{ id: 'assignment-1', type: 'assignment', title: 'Project', required: true }] }] },
      }])],
      lesson_progress: [successful([])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      activity_state: [successful([])],
    });

    const result = await readLearnerHome(
      { userId: 'user-1', roles: [] },
      'en',
      database,
      new Date('2026-09-05T00:00:00Z'),
      { recommended: vi.fn().mockResolvedValue(undefined), listSubmissions },
    );

    expect(listSubmissions).toHaveBeenCalledWith({ userId: 'user-1', roles: [] }, 'course-1', 'assignment-1');
    expect(result.continueLearning).toBeNull();
    expect(result.feedback).toEqual({
      courseId: 'course-1', courseTitle: 'Course', itemId: 'assignment-1', itemTitle: 'Project',
      kind: 'assignment', decision: 'changes_requested', message: 'Clarify your evidence.', at: '2026-09-03T01:00:00Z',
    });
    expect(JSON.stringify(result)).not.toContain('Hidden notes');
    expect(JSON.stringify(result)).not.toContain('Wrong version');
  });
});
