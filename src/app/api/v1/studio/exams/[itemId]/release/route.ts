import { z } from 'zod';

import { BranchIdSchema, CourseVersionIdSchema, examOperation, ExamItemIdSchema } from '@/features/exams/http';
import { createServerExamService, studioExamActor } from '@/features/exams/server';
import { parseBody, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

type RouteContext = { params: Promise<{ itemId: string }> };
const bodySchema = z.object({
  branchId: BranchIdSchema,
  courseVersionId: CourseVersionIdSchema,
}).strict();

export const POST = withHandler(async (request, context) => {
  const { branchId, courseVersionId } = await parseBody(bodySchema, request);
  const actor = await requirePermission('exam.release', { branchId });
  const itemId = ExamItemIdSchema.parse((await (context as RouteContext).params).itemId);
  return examOperation(() => createServerExamService().release(
    studioExamActor(actor, branchId, 'exam.release'),
    { itemId, courseVersionId },
  ));
});
