import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { enroll } from '@/features/enrollment/service';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub } from './test-kit';

const actor: Actor = { userId: 'learner-1', roles: [] };
const course = { id: 'ai-foundations', status: 'published', current_version_id: 'version-2' };
const outline = { version_id: 'version-2', course_id: 'ai-foundations', access: { scope: 'global' } };
const pinnedOutline = { version_id: 'version-1', course_id: 'ai-foundations', access: { scope: 'global' } };

function baseResults(manifest: Record<string, unknown>) {
  return {
    courses: [successful(course)],
    profiles: [successful({ branch_id: null })],
    course_version_outline: [successful(outline)],
    enrollments: [successful(null)],
    course_versions: [successful({ id: 'version-2', manifest })],
  };
}

beforeEach(() => mocks.supabaseService.mockReset());

describe('learner enrollment service', () => {
  it('blocks a new enrollment for an explicitly suspended intended school membership',async()=>{
    const suspended:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'}],assignments:[]}};
    const client=new SupabaseStub({
      courses:[successful(course)],enrollments:[successful(null)],profiles:[successful({branch_id:'school-a'})],
    });
    mocks.supabaseService.mockReturnValue(client);
    await expect(enroll(suspended,'ai-foundations')).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });
  it('pins a new enrollment to the published current course version', async () => {
    const enrollment = {
      id: 'enrollment-1',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-2',
      status: 'active',
      enrolled_at: '2026-09-03T00:00:00Z',
    };
    const client = new SupabaseStub({
      ...baseResults({ enrollment: 'open', prerequisites: [] }),
      enrollments: [successful(null), successful(enrollment)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      courseId: 'ai-foundations',
      courseVersionId: 'version-2',
      status: 'active',
    });
    expect(client.queriesFor('enrollments')[1].operations).toContainEqual(['insert', {
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-2',
      status: 'active',
    }]);
  });

  it('returns the winner when concurrent enrollment insertion reports a unique violation', async () => {
    const racedEnrollment = {
      id: 'enrollment-race-winner',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-2',
      status: 'active',
      enrolled_at: '2026-09-03T00:00:00Z',
    };
    const client = new SupabaseStub({
      ...baseResults({ enrollment: 'open', prerequisites: [] }),
      enrollments: [
        successful(null),
        { data: null, error: { code: '23505', message: 'duplicate key value' } },
        successful(racedEnrollment),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      id: 'enrollment-race-winner',
      courseVersionId: 'version-2',
      status: 'active',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(3);
  });

  it('refuses invite-only self-enrollment without a pre-existing enrollment row', async () => {
    const client = new SupabaseStub(baseResults({ enrollment: 'invite', prerequisites: [] }));
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 403,
      code: 'INVITE_ONLY',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('returns an existing invite enrollment idempotently without changing its pinned version', async () => {
    const existing = {
      id: 'invited-1',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'active',
      enrolled_at: '2026-08-01T00:00:00Z',
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      profiles: [successful({ branch_id: null })],
      course_version_outline: [successful(outline)],
      enrollments: [successful(existing)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      id: 'invited-1',
      courseVersionId: 'version-1',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
    expect(client.queriesFor('course_versions')).toHaveLength(0);
  });

  it('returns an active existing enrollment before applying a re-scoped current outline', async () => {
    const existing = {
      id: 'enrollment-1',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'active',
      enrolled_at: '2026-08-01T00:00:00Z',
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [successful(existing)],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful({
        ...outline, access: { scope: 'branches', branchIds: ['branch-2'] },
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      id: 'enrollment-1', courseVersionId: 'version-1', status: 'active',
    });
    expect(client.queriesFor('profiles')).toHaveLength(0);
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
  });

  it('re-enrolls a dropped learner with a status-only update while preserving the pinned version', async () => {
    const dropped = {
      id: 'enrollment-dropped',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'dropped',
      enrolled_at: '2026-08-01T00:00:00Z',
      completed_at: null,
    };
    const reactivated = { ...dropped, status: 'active' };
    const client = new SupabaseStub({
      ...baseResults({ enrollment: 'open', prerequisites: [] }),
      enrollments: [successful(dropped), successful(reactivated)],
      course_version_outline: [successful(outline), successful(pinnedOutline)],
      course_versions: [
        successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } }),
        successful({ id: 'version-1', manifest: { enrollment: 'open', prerequisites: [] } }),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      id: 'enrollment-dropped',
      courseVersionId: 'version-1',
      status: 'active',
      enrolledAt: '2026-08-01T00:00:00Z',
    });
    expect(client.queriesFor('enrollments')[1].operations).toEqual(expect.arrayContaining([
      ['update', { status: 'active' }],
      ['eq', 'id', 'enrollment-dropped'],
      ['eq', 'user_id', 'learner-1'],
      ['eq', 'course_id', 'ai-foundations'],
      ['eq', 'course_version_id', 'version-1'],
      ['eq', 'status', 'dropped'],
    ]));
    expect(client.queriesFor('enrollments')[1].operations.some(([operation]) => operation === 'insert')).toBe(false);
  });

  it('restores a previously completed dropped enrollment without clearing completion evidence', async () => {
    const dropped = {
      id: 'enrollment-completed',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'dropped',
      enrolled_at: '2026-08-01T00:00:00Z',
      completed_at: '2026-08-20T00:00:00Z',
    };
    const restored = { ...dropped, status: 'completed' };
    const client = new SupabaseStub({
      ...baseResults({ enrollment: 'open', prerequisites: [] }),
      enrollments: [successful(dropped), successful(restored)],
      course_version_outline: [successful(outline), successful(pinnedOutline)],
      course_versions: [
        successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } }),
        successful({ id: 'version-1', manifest: { enrollment: 'open', prerequisites: [] } }),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      courseVersionId: 'version-1',
      status: 'completed',
      completedAt: '2026-08-20T00:00:00Z',
    });
    expect(client.queriesFor('enrollments')[1].operations).toContainEqual([
      'update', { status: 'completed' },
    ]);
  });

  it('returns the winner when concurrent requests reactivate the same dropped enrollment', async () => {
    const dropped = {
      id: 'enrollment-dropped',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'dropped',
      enrolled_at: '2026-08-01T00:00:00Z',
      completed_at: null,
    };
    const winner = { ...dropped, status: 'active' };
    const client = new SupabaseStub({
      ...baseResults({ enrollment: 'open', prerequisites: [] }),
      enrollments: [successful(dropped), successful(null), successful(winner)],
      course_version_outline: [successful(outline), successful(pinnedOutline)],
      course_versions: [
        successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } }),
        successful({ id: 'version-1', manifest: { enrollment: 'open', prerequisites: [] } }),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).resolves.toMatchObject({
      id: 'enrollment-dropped',
      courseVersionId: 'version-1',
      status: 'active',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(3);
  });

  it('rechecks branch access before re-enrolling a dropped learner', async () => {
    const dropped = {
      id: 'enrollment-dropped',
      user_id: 'learner-1',
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      status: 'dropped',
      enrolled_at: '2026-08-01T00:00:00Z',
      completed_at: null,
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [successful(dropped)],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful({
        ...outline,
        access: { scope: 'branches', branchIds: ['branch-2'] },
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 404,
      code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('denies re-enrollment when the latest version is visible but the preserved pin is branch-forbidden', async () => {
    const dropped = {
      id: 'enrollment-dropped', user_id: 'learner-1', course_id: 'ai-foundations',
      course_version_id: 'version-1', status: 'dropped', enrolled_at: '2026-08-01T00:00:00Z', completed_at: null,
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [successful(dropped)],
      profiles: [successful({ branch_id: 'branch-2' })],
      course_version_outline: [
        successful(outline),
        successful({ ...pinnedOutline, access: { scope: 'branches', branchIds: ['branch-1'] } }),
      ],
      course_versions: [successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 404,
      code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('denies re-enrollment when the preserved pinned outline is missing', async () => {
    const dropped = {
      id: 'enrollment-dropped', user_id: 'learner-1', course_id: 'ai-foundations',
      course_version_id: 'version-1', status: 'dropped', enrolled_at: '2026-08-01T00:00:00Z', completed_at: null,
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [successful(dropped)],
      profiles: [successful({ branch_id: null })],
      course_version_outline: [successful(outline), successful(null)],
      course_versions: [successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 404,
      code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('does not reopen a pinned invite-only version merely because the latest version is open', async () => {
    const dropped = {
      id: 'enrollment-dropped', user_id: 'learner-1', course_id: 'ai-foundations',
      course_version_id: 'version-1', status: 'dropped', enrolled_at: '2026-08-01T00:00:00Z', completed_at: null,
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [successful(dropped)],
      profiles: [successful({ branch_id: null })],
      course_version_outline: [successful(outline), successful(pinnedOutline)],
      course_versions: [
        successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } }),
        successful({ id: 'version-1', manifest: { enrollment: 'invite', prerequisites: [] } }),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 403,
      code: 'INVITE_ONLY',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('applies preserved-pin authorization when an insert race reveals a dropped row', async () => {
    const dropped = {
      id: 'enrollment-dropped', user_id: 'learner-1', course_id: 'ai-foundations',
      course_version_id: 'version-1', status: 'dropped', enrolled_at: '2026-08-01T00:00:00Z', completed_at: null,
    };
    const client = new SupabaseStub({
      courses: [successful(course)],
      enrollments: [
        successful(null),
        { data: null, error: { code: '23505', message: 'duplicate key value' } },
        successful(dropped),
      ],
      profiles: [successful({ branch_id: 'branch-2' })],
      course_version_outline: [
        successful(outline),
        successful({ ...pinnedOutline, access: { scope: 'branches', branchIds: ['branch-1'] } }),
      ],
      course_versions: [successful({ id: 'version-2', manifest: { enrollment: 'open', prerequisites: [] } })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 404,
      code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('enrollments')).toHaveLength(3);
  });

  it('refuses enrollment when any declared course prerequisite is incomplete', async () => {
    const client = new SupabaseStub({
      ...baseResults({
        enrollment: 'open',
        prerequisites: [
          { type: 'course_completion', courseId: 'intro-ai' },
          { type: 'course_completion', courseId: 'data-basics' },
        ],
      }),
      course_completions: [successful([{ course_id: 'intro-ai' }])],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({
      status: 409,
      code: 'PREREQ_MISSING',
      issues: [{ path: ['prerequisites', 'data-basics'], message: 'Required course is incomplete' }],
    });
    expect(client.queriesFor('enrollments')).toHaveLength(1);
  });

  it('uses the typed publication and access errors before enrollment writes', async () => {
    const unpublished = new SupabaseStub({ courses: [successful({ ...course, status: 'draft' })] });
    mocks.supabaseService.mockReturnValueOnce(unpublished);
    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });

    const forbidden = new SupabaseStub({
      courses: [successful(course)],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful({ ...outline, access: { scope: 'branches', branchIds: ['branch-2'] } })],
    });
    mocks.supabaseService.mockReturnValueOnce(forbidden);
    await expect(enroll(actor, 'ai-foundations')).rejects.toMatchObject({ status: 404, code: 'COURSE_NOT_FOUND' });
    expect(forbidden.queriesFor('enrollments')).toHaveLength(1);
    expect(forbidden.queriesFor('enrollments')[0].operations.some(([operation]) => operation === 'insert')).toBe(false);
  });
});
