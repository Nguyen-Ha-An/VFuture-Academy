import { createServerGradingDetailService } from '@/features/grading/detail';
import { AttemptIdSchema, BranchIdSchema } from '@/features/exams/http';
import { ApiError, ok, withHandler } from '@/lib/api';
import { getActor, hasGlobalPermission, can, type Actor } from '@/lib/permissions';

type RouteContext = { params: Promise<{ attemptId: string }> };

async function viewer(branchId: string | undefined): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  const allowed = branchId
    ? can(actor, 'submission.grade', { kind: 'branch', branchId })
    : hasGlobalPermission(actor, 'submission.grade');
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  return actor;
}

export const GET = withHandler(async (request, context) => {
  const rawBranch = new URL(request.url).searchParams.get('branchId') ?? undefined;
  const branchId = rawBranch === undefined ? undefined : BranchIdSchema.parse(rawBranch);
  const actor = await viewer(branchId);
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).attemptId);
  return ok(await createServerGradingDetailService().exam(actor, attemptId, branchId));
});
