import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { getVersionWorkspace } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

const ParamsSchema = z.object({ courseId: IdSchema, v: z.coerce.number().int().positive() });

export const GET = withHandler(async (_request, context) => {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  const { courseId, v } = ParamsSchema.parse(params);
  await scopedContentContext(_request, 'course', courseId, 'content.read', 'course.read');
  return getVersionWorkspace(courseId, v);
});
