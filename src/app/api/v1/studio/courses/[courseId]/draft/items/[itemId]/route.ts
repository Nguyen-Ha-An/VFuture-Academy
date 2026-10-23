import { z } from 'zod';

import { itemRef } from '@/content-engine/diagnostics';
import { IdSchema } from '@/content-engine/schema/common';
import { deleteItem, saveItem } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { scopedContentContext } from '@/features/admin/content-review-production';

const RouteParamsSchema = z.object({ courseId: IdSchema, itemId: IdSchema });

async function routeParams(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return RouteParamsSchema.parse(params);
}

export const PUT = withHandler(async (request, context) => {
  const { courseId, itemId } = await routeParams(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  return saveItem(courseId, itemId, await readStrictJsonBodyLimited(request, { ref: itemRef(itemId) }), actor, request.headers.get('if-match') ?? undefined);
});

export const DELETE = withHandler(async (_request, context) => {
  const { courseId, itemId } = await routeParams(context);
  const { context: admin } = await scopedContentContext(_request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  return deleteItem(courseId, itemId, actor, undefined, _request.headers.get('if-match') ?? undefined);
});
