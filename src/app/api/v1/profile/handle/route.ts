import { z } from 'zod';
import { changeHandle, PROFILE_HANDLE_PATTERN } from '@/features/profile/service';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const HandleBodySchema = z.object({
  handle: z.string().regex(PROFILE_HANDLE_PATTERN),
}).strict();

export const PATCH = withHandler(async (request) => {
  const user = await requireApiUser();
  const actor = { userId: user.id, roles: [] };
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('profile:handle', actor.userId),
    RATE_LIMITS.profileHandle,
    'Too many handle requests; try again later',
  );
  const { handle } = await parseBody(HandleBodySchema, request, { maxBytes: 2_048 });
  return changeHandle(actor, handle);
});
