import { z } from 'zod';

import { IdSchema, LocaleSchema } from '@/content-engine/schema/common';
import { previewItem } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

const RouteParamsSchema = z.object({ courseId: IdSchema, itemId: IdSchema });

async function routeParams(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return RouteParamsSchema.parse(params);
}

export const POST = withHandler(async (request, context) => {
  const { courseId, itemId } = await routeParams(context);
  await scopedContentContext(request, 'course', courseId, 'content.edit', 'course.edit', true);
  const locale = LocaleSchema.parse(new URL(request.url).searchParams.get('locale') ?? 'vi');
  return previewItem(courseId, itemId, locale);
});
