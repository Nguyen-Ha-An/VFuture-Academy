import { IdSchema } from '@/content-engine/schema/common';
import { PublishInputSchema, publish } from '@/features/studio/drafts';
import { ApiError, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { scopedContentContext } from '@/features/admin/content-review-production';

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const POST = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.publish', 'course.publish', true);
  const actor = admin.actor;
  const input = PublishInputSchema.parse(await readStrictJsonBodyLimited(request));
  const revision = request.headers.get('if-match');
  if (!revision) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required');
  const result = await publish(
    courseId,
    input,
    actor,
    undefined,
    revision,
  );
  invalidatePublicCache('courses');
  return result;
});
