import { z } from 'zod';

import { IdSchema } from '@/content-engine';
import { markViewed, recompute } from '@/features/progress/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import type { Actor } from '@/lib/permissions';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const ViewedBodySchema = z.object({
  courseId: IdSchema,
  itemId: IdSchema,
}).strict();

export const POST = withHandler(async (request) => {
  const user = await requireApiUser();
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('progress:mutation', user.id),
    RATE_LIMITS.progress,
    'Too many progress updates',
  );
  const actor: Actor = { userId: user.id, roles: [] };
  const body = await parseBody(ViewedBodySchema, request);
  const progress = await markViewed(actor, body.courseId, body.itemId);
  const completion = await recompute(actor, body.courseId);
  return ok({ progress, completion });
});
