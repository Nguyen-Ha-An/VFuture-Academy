import { IdSchema } from '@/content-engine';
import { enroll } from '@/features/enrollment/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const POST = withHandler(async (_request, context?: unknown) => {
  const user = await requireApiUser();
  const { courseId } = await (context as { params: Promise<{ courseId: string }> }).params;
  return ok(await enroll({ userId: user.id, roles: [] }, IdSchema.parse(courseId)));
});
