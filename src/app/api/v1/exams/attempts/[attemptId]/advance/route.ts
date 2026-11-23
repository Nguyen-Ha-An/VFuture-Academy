import { z } from 'zod';

import { AttemptIdSchema, examOperation, streamExamJson } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { enforceRateLimit, RATE_LIMITS, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ attemptId: string }> };
const pageRequest = z.object({ fromStep: z.number().int().nonnegative() }).strict();

export const POST = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { fromStep } = await parseBody(pageRequest, request);
  await enforceRateLimit(supabaseService(), userRateLimitKey('exam:advance', user.id),
    RATE_LIMITS.examAnswers, 'Too many exam requests; try again later');
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).attemptId);
  const actor = await learnerExamActor(user.id);
  return streamExamJson(await examOperation(() => createServerExamService().advance(actor, attemptId, fromStep)));
});
