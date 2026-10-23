import { z } from 'zod';

import { AttemptIdSchema, ExamAnswersSchema, examOperation } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ attemptId: string }> };
const bodySchema = z.object({
  answers: ExamAnswersSchema,
}).strict();

export const PUT = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { answers } = await parseBody(bodySchema, request);
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('exam:answers', user.id),
    RATE_LIMITS.examAnswers,
    'Too many exam requests; try again later',
  );
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).attemptId);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().save(actor, attemptId, answers));
});
