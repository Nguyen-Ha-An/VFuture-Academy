import { IdSchema } from '@/content-engine/schema/common';
import { migrateEnrollments } from '@/features/enrollment/migrate';
import { withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

export const POST = withHandler(async (_request, context) => {
  await requirePermission('course.publish');
  const { courseId } = await (context as { params: Promise<{ courseId: string }> }).params;
  return migrateEnrollments(IdSchema.parse(courseId));
});
