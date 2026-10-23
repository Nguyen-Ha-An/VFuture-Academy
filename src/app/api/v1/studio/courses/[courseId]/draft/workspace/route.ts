import { IdSchema } from '@/content-engine/schema/common';
import { saveWorkspace } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { scopedContentContext } from '@/features/admin/content-review-production';

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const PUT = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  return saveWorkspace(
    courseId,
    // A manifest plus every item document: the envelope budget applies to the body,
    // and each document inside it is still held to the per-document limit.
    await readStrictJsonBodyLimited(request, { envelope: true }),
    actor,
    request.headers.get('if-match'),
  );
});
