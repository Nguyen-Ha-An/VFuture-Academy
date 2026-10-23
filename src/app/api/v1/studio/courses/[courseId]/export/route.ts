import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { exportVersion } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { scopedContentContext } from '@/features/admin/content-review-production';

const FormatSchema = z.enum(['bundle', 'single']).default('bundle');
const VersionSchema = z.coerce.number().int().positive();

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const GET = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  await scopedContentContext(request, 'course', courseId, 'content.read', 'course.read');
  const query = new URL(request.url).searchParams;
  const exported = await exportVersion(
    courseId,
    VersionSchema.parse(query.get('version')),
    FormatSchema.parse(query.get('format') ?? undefined),
  );
  const body = typeof exported.body === 'string'
    ? exported.body
    : exported.body.buffer.slice(exported.body.byteOffset, exported.body.byteOffset + exported.body.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': exported.contentType,
      'content-disposition': `attachment; filename="${exported.filename}"`,
      'x-content-checksum': exported.checksum,
    },
  });
});
