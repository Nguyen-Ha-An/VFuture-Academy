import { IdSchema } from '@/content-engine/schema/common';
import { previewWorkspace } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { canEditStudioCourse } from '@/features/studio/source-access';
import { scopedContentContext } from '@/features/admin/content-review-production';

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const POST = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.read', 'course.read', true);
  return previewWorkspace(
    courseId,
    await readStrictJsonBodyLimited(request, { envelope: true }),
    await canEditStudioCourse(admin, courseId),
  );
});
