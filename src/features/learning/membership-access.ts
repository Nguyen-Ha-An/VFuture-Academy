import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';

type MembershipResult = { data: unknown; error: unknown | null };
export interface MembershipAccessQuery {
  eq(column: string, value: unknown): this;
  maybeSingle(): PromiseLike<MembershipResult>;
}
export interface MembershipAccessDatabase {
  from(table: 'branch_memberships'): { select(columns: string): MembershipAccessQuery };
}
export type TrustedEnrollmentBranch = { branch_scope_known?: unknown; branch_id?: unknown };
export type SuspendedSchoolAccess = 'exclude' | 'deny';

async function schoolMembershipSuspended(
  actor: Pick<Actor, 'userId' | 'authorization'>,
  branchId: string,
  database: MembershipAccessDatabase,
): Promise<boolean> {
  if (actor.authorization?.source === 'database') {
    return actor.authorization.memberships.some((membership) =>
      membership.branchId === branchId && membership.status === 'suspended');
  }
  const result = await database.from('branch_memberships').select('status')
    .eq('user_id', actor.userId).eq('branch_id', branchId).maybeSingle();
  if (result.error) throw new ApiError(503, 'MEMBERSHIP_ACCESS_UNAVAILABLE', 'School membership could not be verified');
  const row = typeof result.data === 'object' && result.data !== null ? result.data as Record<string, unknown> : null;
  return row?.status === 'suspended';
}

/** An explicit suspension removes only this school's grant. Older profiles may have no membership row. */
export async function eligibleAudienceBranch(
  actor: Pick<Actor, 'userId' | 'authorization'>,
  branchId: unknown,
  database: MembershipAccessDatabase,
  onSuspension: SuspendedSchoolAccess = 'exclude',
): Promise<string | null> {
  if (typeof branchId !== 'string' || !branchId) return null;
  if (!await schoolMembershipSuspended(actor, branchId, database)) return branchId;
  if (onSuspension === 'deny') {
    throw new ApiError(403, 'MEMBERSHIP_SUSPENDED', 'Your membership for this school is suspended');
  }
  return null;
}

function enrollmentBranch(enrollment: TrustedEnrollmentBranch): string | null {
  return enrollment.branch_scope_known === true && typeof enrollment.branch_id === 'string' && enrollment.branch_id
    ? enrollment.branch_id : null;
}

export async function membershipEligibleEnrollments<T extends TrustedEnrollmentBranch>(
  actor: Actor,
  enrollments: T[],
  database: MembershipAccessDatabase,
): Promise<T[]> {
  const branches = new Set(enrollments.map(enrollmentBranch));
  const eligible = new Set(await Promise.all([...branches].map((branchId) =>
    eligibleAudienceBranch(actor, branchId, database))));
  return enrollments.filter((enrollment) => eligible.has(enrollmentBranch(enrollment)));
}

/** Gates live learning at the immutable enrollment branch while preserving unknown historical records. */
export async function assertEnrollmentMembershipAccess(
  actor: Actor,
  enrollment: TrustedEnrollmentBranch,
  database: MembershipAccessDatabase,
): Promise<void> {
  await eligibleAudienceBranch(actor, enrollmentBranch(enrollment), database, 'deny');
}
