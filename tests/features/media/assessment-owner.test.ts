import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { checkBoundAssessmentOwnerAccess } from '@/features/media/assessment-owner';
import type { Actor } from '@/lib/permissions';
import type { SupabaseClient } from '@supabase/supabase-js';

const actor: Actor = { userId: 'learner', roles: [] };
function database(rows: Record<string, Record<string, unknown>[]>) {
  return { from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      maybeSingle: async () => ({ data: (rows[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null, error: null }),
    };
    return query;
  } } as unknown as SupabaseClient;
}
const examRows = () => ({
  exam_attachment_bindings: [{ asset_id: 'asset', owner_id: 'learner', attempt_id: 'attempt' }],
  exam_attempts: [{ id: 'attempt', user_id: 'learner', course_version_id: 'old-version', branch_scope_known: false, branch_id: null }],
  course_versions: [{ id: 'old-version', course_id: 'course' }],
  enrollments: [{ user_id: 'learner', course_id: 'course', course_version_id: 'old-version', status: 'active', branch_scope_known: false, branch_id: null }],
  branch_memberships: [],
});

describe('assessment attachment owner access', () => {
  it('retains owned exam access with matching enrollment when historical school is unknown', async () => {
    expect(await checkBoundAssessmentOwnerAccess(database(examRows()), actor, 'asset')).toBe(true);
  });
  it('preserves owner access after upgrading the enrollment to another version of the same course', async () => {
    const rows = examRows(); rows.enrollments[0].course_version_id = 'new-version';
    expect(await checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).toBe(true);
  });
  it('denies owner access after the same-course enrollment is dropped or changed to another course', async () => {
    const rows = examRows(); rows.enrollments[0].status = 'cancelled';
    expect(await checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).toBe(false);
    rows.enrollments[0].status = 'active'; rows.enrollments[0].course_id = 'other-course';
    expect(await checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).toBe(false);
  });
  it('denies a known suspended historical school without substituting the current school', async () => {
    const rows = examRows(); rows.exam_attempts[0].branch_scope_known = true; rows.exam_attempts[0].branch_id = 'historical' as never;
    rows.branch_memberships = [{ user_id: 'learner', branch_id: 'historical', status: 'suspended' }] as never;
    await expect(checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED' });
  });
  it('denies a different owner and leaves unrelated assignment assets to existing policy', async () => {
    expect(await checkBoundAssessmentOwnerAccess(database(examRows()), { userId: 'other', roles: [] }, 'asset')).toBe(false);
    expect(await checkBoundAssessmentOwnerAccess(database({}), actor, 'asset')).toBeNull();
  });
  it('preserves unknown-school quiz ownership with same-course enrollment after a version upgrade', async () => {
    const rows = { quiz_attachment_bindings: [{ asset_id: 'asset', owner_id: 'learner', course_version_id: 'version', branch_scope_known: false, branch_id: null }], course_versions: [{ id: 'version', course_id: 'course' }], enrollments: [{ user_id: 'learner', course_id: 'course', course_version_id: 'new-version', status: 'active', branch_scope_known: false, branch_id: null }] };
    expect(await checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).toBe(true);
    rows.enrollments[0].status = 'cancelled';
    expect(await checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).toBe(false);
  });
  it('blocks suspension at the quiz binding school, even after the learner moves', async () => {
    const rows = {
      quiz_attachment_bindings: [{ asset_id: 'asset', owner_id: 'learner', course_version_id: 'version', branch_scope_known: true, branch_id: 'historical' }],
      course_versions: [{ id: 'version', course_id: 'course' }],
      enrollments: [{ user_id: 'learner', course_id: 'course', course_version_id: 'new-version', status: 'active', branch_scope_known: true, branch_id: 'current' }],
      branch_memberships: [{ user_id: 'learner', branch_id: 'historical', status: 'suspended' }],
    };
    await expect(checkBoundAssessmentOwnerAccess(database(rows), actor, 'asset')).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED' });
  });
});
