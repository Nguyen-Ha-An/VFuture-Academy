import { z } from 'zod';

import { BranchIdSchema, CourseVersionIdSchema, ExamItemIdSchema } from '@/features/exams/http';
import { listStudioExamAttempts } from '@/features/exams/server';
import { ApiError, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

type RouteContext = { params: Promise<{ itemId: string }> };
const querySchema = z.object({
  branchId: BranchIdSchema,
  courseVersionId: CourseVersionIdSchema,
}).strict();

async function requireAttemptViewer(branchId: string) {
  try {
    return await requirePermission('exam.release', { branchId });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403) throw error;
    return requirePermission('submission.grade', { branchId });
  }
}

export const GET = withHandler(async (request, context) => {
  const { branchId, courseVersionId } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const actor = await requireAttemptViewer(branchId);
  const itemId = ExamItemIdSchema.parse((await (context as RouteContext).params).itemId);
  return listStudioExamAttempts(actor, itemId, branchId, courseVersionId);
});
