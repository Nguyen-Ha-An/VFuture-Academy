import { z } from 'zod';
import { ApiError, withHandler } from '@/lib/api';
import { getActor } from '@/lib/permissions';
import { assignedCourses } from '@/features/teaching/assignments';
export const GET = withHandler(async request => {
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  const locale = z.enum(['vi', 'en']).default('vi').parse(new URL(request.url).searchParams.get('locale') ?? undefined);
  return assignedCourses(actor, locale);
});
