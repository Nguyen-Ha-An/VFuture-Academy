import { z } from 'zod';

import { AttemptIdSchema, ExamEventMetaSchema, examOperation } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ attemptId: string }> };
const eventSchema = z.object({
  type: z.enum(['focus_lost', 'focus_gained', 'visibility_hidden', 'paste', 'fullscreen_exit']),
  at: z.string().refine((value) => Number.isFinite(Date.parse(value)), { message: 'Invalid event timestamp' }).optional(),
  meta: ExamEventMetaSchema.optional(),
}).strict();
const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(50) }).strict();

export const POST = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { events } = await parseBody(bodySchema, request);
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('exam:events', user.id),
    RATE_LIMITS.examEvents,
    'Too many exam requests; try again later',
  );
  const attemptId = AttemptIdSchema.parse((await (context as RouteContext).params).attemptId);
  const actor = await learnerExamActor(user.id);
  return examOperation(() => createServerExamService().events(actor, attemptId, events.map(({ at, ...event }) => ({
    ...event,
    ...(at ? { at: new Date(at) } : {}),
  }))));
});
