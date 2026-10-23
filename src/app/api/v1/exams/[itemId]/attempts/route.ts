import { z } from 'zod';

import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { examOperation, ExamItemIdSchema } from '@/features/exams/http';
import { IdSchema } from '@/content-engine/schema/common';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ itemId: string }> };
const bodySchema = z.object({ courseId: IdSchema }).strict();

export const GET = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const courseId = IdSchema.parse(new URL(request.url).searchParams.get('courseId'));
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('exam:lifecycle', user.id),
    RATE_LIMITS.examLifecycle,
    'Too many exam requests; try again later',
  );
  const itemId = ExamItemIdSchema.parse((await (context as RouteContext).params).itemId);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().session(actor, courseId, itemId));
});

export const POST = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { courseId } = await parseBody(bodySchema, request);
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('exam:lifecycle', user.id),
    RATE_LIMITS.examLifecycle,
    'Too many exam requests; try again later',
  );
  const itemId = ExamItemIdSchema.parse((await (context as RouteContext).params).itemId);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().start(actor, courseId, itemId));
});
