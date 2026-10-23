import { IdSchema } from '@/content-engine/schema/common';
import { listVersions } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const GET = withHandler(async (_request, context) => {
  const courseId = await courseIdOf(context);
  await scopedContentContext(_request, 'course', courseId, 'content.read', 'course.read');
  return listVersions(courseId);
});
