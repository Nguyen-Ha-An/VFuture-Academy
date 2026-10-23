import { z } from 'zod';

import { AttemptIdSchema, examOperation } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ attemptId: string }> };
const paramsSchema = z.object({ attemptId: AttemptIdSchema }).strict();

export const POST = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('exam:lifecycle', user.id),
    RATE_LIMITS.examLifecycle,
    'Too many exam requests; try again later',
  );
  const { attemptId } = paramsSchema.parse(await (context as RouteContext).params);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().submit(actor, attemptId));
});
