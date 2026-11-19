import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { getVersionWorkspace } from '@/features/studio/drafts';
import { readerWorkspace } from '@/features/studio/reader-source';
import { canEditStudioCourse } from '@/features/studio/source-access';
import { ok, withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

const ParamsSchema = z.object({ courseId: IdSchema, v: z.coerce.number().int().positive() });

export const GET = withHandler(async (_request, context) => {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  const { courseId, v } = ParamsSchema.parse(params);
  const { context: admin } = await scopedContentContext(_request, 'course', courseId, 'content.read', 'course.read');
  const canEdit = await canEditStudioCourse(admin, courseId);
  const version = await getVersionWorkspace(courseId, v);
  return ok(canEdit ? version : readerWorkspace(version), { headers: { 'cache-control': 'private, no-store' } });
});
