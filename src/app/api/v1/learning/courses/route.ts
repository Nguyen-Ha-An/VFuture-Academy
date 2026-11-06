import { LocaleSchema } from '@/content-engine';
import { listEnrolledCourses } from '@/features/learning/enrolled-courses';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async request => {
  const user = await requireApiUser();
  const locale = LocaleSchema.parse(new URL(request.url).searchParams.get('locale') ?? 'vi');
  return ok(await listEnrolledCourses({ userId: user.id, roles: [] }, locale), { headers: { 'Cache-Control': 'private, no-store' } });
});
