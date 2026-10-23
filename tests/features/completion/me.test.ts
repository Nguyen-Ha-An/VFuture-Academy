import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { createMeService } from '@/features/me/service';
import { SupabaseStub, successful } from '../learner/test-kit';

describe('learner profile summary', () => {
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
