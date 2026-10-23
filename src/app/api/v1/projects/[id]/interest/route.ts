import { ProjectInterestSchema, setProjectInterest } from '@/features/projects/service';
import { fail, ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { id } = await (context as RouteContext).params;
  if (!id) return fail(400, 'PROJECT_ID_REQUIRED', 'Project id is required');
  const { interested } = await parseBody(ProjectInterestSchema, request, { maxBytes: 4 * 1024 });
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey(`project:interest:${id}`, user.id),
    RATE_LIMITS.projectInterest,
    'Too many project interest requests; try again later',
  );
  return ok(await setProjectInterest(user.id, id, interested));
});
