import 'server-only';

import { ApiError } from '@/lib/api';
import {
  allowedBranchIds,
  getActor,
  requirePermission,
} from '@/lib/permissions';
import { canGradeSubmissionBranch } from './permissions';

/** Resolves global or branch-intersection grading authority for a Studio route. */
export async function requireSubmissionGrader(branchId?: string) {
  if (branchId) return requirePermission('submission.grade', { branchId });

  const actor = await getActor();
  if (!actor) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (canGradeSubmissionBranch(actor, null)) return actor;

  const branches = allowedBranchIds(actor, 'submission.grade');
  if (!branches.length) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  return actor;
}
