import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseService: vi.fn(),
  supabaseUser: vi.fn(),
}));

import { canGradeSubmissionBranch } from '@/features/submissions/permissions';
import type { Actor } from '@/lib/permissions';

describe('submission grading scope', () => {
  const globalGrader: Actor = {
    userId: 'admin-1',
    roles: [{ role: 'admin', branchId: null }],
  };
  const branchGrader: Actor = {
    userId: 'instructor-1',
    roles: [{ role: 'instructor', branchId: 'vinsmc' }],
  };

  it('allows a global grader to cover assigned and unassigned learners', () => {
    expect(canGradeSubmissionBranch(globalGrader, 'vinsmc')).toBe(true);
    expect(canGradeSubmissionBranch(globalGrader, null)).toBe(true);
  });

  it('limits a branch grader to the matching concrete branch', () => {
    expect(canGradeSubmissionBranch(branchGrader, 'vinsmc')).toBe(true);
    expect(canGradeSubmissionBranch(branchGrader, 'ans')).toBe(false);
    expect(canGradeSubmissionBranch(branchGrader, null)).toBe(false);
  });
});
