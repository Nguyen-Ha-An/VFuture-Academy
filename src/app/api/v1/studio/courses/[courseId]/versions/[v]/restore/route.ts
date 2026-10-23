import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { restoreAsDraft } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

const RouteParamsSchema = z.object({
  courseId: IdSchema,
  v: z.coerce.number().int().positive(),
});

async function routeParams(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return RouteParamsSchema.parse(params);
}

export const POST = withHandler(async (_request, context) => {
  const { courseId, v } = await routeParams(context);
  const { context: admin } = await scopedContentContext(_request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  return restoreAsDraft(courseId, v, actor);
});
