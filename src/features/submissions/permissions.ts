import {
  hasGlobalPermission,
  hasPermission,
  type Actor,
} from '@/lib/permissions';

export function canGradeSubmissionBranch(actor: Actor, branchId: string | null): boolean {
  if (branchId !== null) {
    return hasPermission(actor, 'submission.grade', { branchId });
  }
  return hasGlobalPermission(actor, 'submission.grade');
}
