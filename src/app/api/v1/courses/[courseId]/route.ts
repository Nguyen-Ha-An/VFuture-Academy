import { z } from 'zod';

import { IdSchema, LocaleSchema } from '@/content-engine';
import { getCourse } from '@/features/catalog/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const CourseQuerySchema = z.object({ locale: LocaleSchema.default('vi') }).strict();

export const GET = withHandler(async (
  request,
  context?: unknown,
) => {
  const user = await requireApiUser();
  const { courseId } = await (context as { params: Promise<{ courseId: string }> }).params;
  const parsedCourseId = IdSchema.parse(courseId);
  const locale = CourseQuerySchema.parse({
    locale: new URL(request.url).searchParams.get('locale') ?? undefined,
  }).locale;
  return ok(await getCourse({ userId: user.id, roles: [] }, parsedCourseId, locale));
});
