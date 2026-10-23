import { z } from 'zod';

import { AttemptIdSchema, BranchIdSchema, examOperation, QuestionIdSchema } from '@/features/exams/http';
import { createServerExamService, studioExamActor } from '@/features/exams/server';
import { parseBody, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

type RouteContext = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  branchId: BranchIdSchema,
  questionId: QuestionIdSchema,
  points: z.number().finite().min(0),
  feedback: z.unknown(),
}).strict();

export const POST = withHandler(async (request, context) => {
  const { branchId, questionId, points, feedback } = await parseBody(bodySchema, request);
  const actor = await requirePermission('submission.grade', { branchId });
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).id);
  return examOperation(() => createServerExamService().manualGrade(
    studioExamActor(actor, branchId, 'submission.grade'),
    attemptId,
    questionId,
    points,
    feedback,
  ));
});
