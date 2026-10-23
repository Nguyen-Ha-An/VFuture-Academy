import { z } from 'zod';

import { AttemptIdSchema, examOperation } from '@/features/exams/http';
import { completeExamGrading } from '@/features/exams/server';
import { ApiError, parseBody, withHandler } from '@/lib/api';
import { getActor } from '@/lib/permissions';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The body is deliberately empty: the branch is resolved from the attempt, not
 * nominated by the client, and there is nothing else to finalize with. It stays
 * strict so a caller that believes it is sending scores here fails loudly.
 */
const bodySchema = z.object({}).strict();

export const POST = withHandler(async (request, context) => {
  await parseBody(bodySchema, request);
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).id);
  return examOperation(() => completeExamGrading(actor, attemptId));
});
