import { z } from 'zod';
import { ApiError, parseBody, withHandler } from '@/lib/api';
import { getActor, requirePermission } from '@/lib/permissions';
import { getCourseTeachers, replaceCourseTeachers } from '@/features/teaching/assignments';
import { ReplaceCourseTeachersSchema, TeachingBranchId, TeachingCourseId } from '@/features/teaching/assignment-contracts';

async function courseFromContext(context: unknown): Promise<string> {
  const route = context as { params: Promise<{ courseId: string }> };
  return TeachingCourseId.parse((await route.params).courseId);
}
export const GET = withHandler(async (request, context) => {
  const courseId = await courseFromContext(context);
  const branchId = TeachingBranchId.optional().parse(new URL(request.url).searchParams.get('branchId') ?? undefined);
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return getCourseTeachers(actor, courseId, branchId);
});
export const PUT = withHandler(async (request, context) => {
  const courseId = await courseFromContext(context);
  const input = await parseBody(ReplaceCourseTeachersSchema, request, { maxBytes: 32_768 });
  const queryBranch = z.string().optional().parse(new URL(request.url).searchParams.get('branchId') ?? undefined);
  if (queryBranch !== undefined && queryBranch !== input.branchId) throw new ApiError(400, 'BRANCH_MISMATCH', 'School does not match the request');
  const actor = await requirePermission('teaching.assignment.manage', { branchId: input.branchId });
  return replaceCourseTeachers(actor, courseId, input);
});
