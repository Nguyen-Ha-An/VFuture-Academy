import { CourseworkQuerySchema, listCourseResults } from '@/features/coursework/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const query = CourseworkQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return ok(await listCourseResults({ userId: user.id, roles: [] }, query), { headers: { 'Cache-Control': 'private, no-store' } });
});
