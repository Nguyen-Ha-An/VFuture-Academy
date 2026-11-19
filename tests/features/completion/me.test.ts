import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { createMeService } from '@/features/me/service';
import { SupabaseStub, successful } from '../learner/test-kit';

describe('learner profile summary', () => {
  it.each([
    ['suspended', { status: 'suspended' }, { status: 'suspended' }],
    ['active', { status: 'active' }, { status: 'eligible', branchId: 'branch-1' }],
    ['legacy', null, { status: 'eligible', branchId: 'branch-1' }],
  ] as const)('keeps the primary school identity and resolves %s leaderboard membership independently', async (_label, membership, board) => {
    const database = new SupabaseStub({
      profiles: [successful({ branch_id: 'branch-1' }), successful({ branch_id: 'branch-1' })],
      branch_memberships: [successful(membership)],
    });
    const service = createMeService({ database });
    await expect(service.branchIdForUser('learner-1')).resolves.toBe('branch-1');
    await expect(service.leaderboardSchoolForUser('learner-1')).resolves.toEqual(board);
    expect(database.queriesFor('branch_memberships')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'learner-1'], ['eq', 'branch_id', 'branch-1'],
    ]));
  });

  it('returns the profile and completion counts without exposing role rows', async () => {
    const database = new SupabaseStub({
      profiles: [successful({
        id: 'learner-1', handle: 'learner-one', display_name: 'Learner One',
        avatar_url: null, locale: 'en', branch_id: 'branch-1', profile_public: true,
      })],
      enrollments: [successful([{ id: 'enrollment-1' }, { id: 'enrollment-2' }])],
      course_completions: [successful([{ course_id: 'course-1' }])],
      certificates: [successful([{ id: 'certificate-1' }])],
      skill_evidence: [successful([{ id: 'evidence-1' }, { id: 'evidence-2' }])],
    });

    await expect(createMeService({ database }).getMe('learner-1')).resolves.toEqual({
      profile: {
        id: 'learner-1', handle: 'learner-one', displayName: 'Learner One', avatarUrl: null,
        locale: 'en', branchId: 'branch-1', profilePublic: true,
      },
      counts: { enrollments: 2, completedCourses: 1, certificates: 1, skillEvidence: 2 },
    });
  });
});
