import { COURSE_REF } from '@/content-engine/diagnostics';
import { IdSchema } from '@/content-engine/schema/common';
import { saveManifest } from '@/features/studio/drafts';
import { visibleStudioDraft } from '@/features/studio/source-access';
import { ok, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { scopedContentContext, typedContentContext } from '@/features/admin/content-review-production';

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const GET = withHandler(async (_request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await typedContentContext(_request, 'content.read', 'course.read');
  const { draft } = await visibleStudioDraft(admin, courseId);
  return ok(draft, { headers: { 'cache-control': 'private, no-store' } });
});

export const PUT = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  return saveManifest(
    courseId,
    await readStrictJsonBodyLimited(request, { ref: COURSE_REF }),
    actor,
    request.headers.get('if-match') ?? undefined,
  );
});
