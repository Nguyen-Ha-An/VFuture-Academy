import { z } from 'zod';

import { AttemptIdSchema, examOperation } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

type RouteContext = { params: Promise<{ attemptId: string }> };
const paramsSchema = z.object({ attemptId: AttemptIdSchema }).strict();

export const GET = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { attemptId } = paramsSchema.parse(await (context as RouteContext).params);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().review(actor, attemptId));
});
