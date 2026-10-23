import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { importBundle, importSingle } from '@/features/studio/drafts';
import { productionBundleImportHooks } from '@/features/studio/import-hooks';
import { ApiError, withHandler } from '@/lib/api';
import { readBodyLimited, readStrictJsonBodyLimited } from '@/lib/body-limit';
import { scopedContentContext } from '@/features/admin/content-review-production';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const SingleImportBody = z.object({ mode: z.literal('single'), text: z.string() }).strict();

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const POST = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.edit', 'course.edit', true);
  const actor = admin.actor;
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('studio:course-import', actor.userId),
    RATE_LIMITS.import,
  );
  const expectedUpdatedAt = request.headers.get('if-match') ?? undefined;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const bytes = await readBodyLimited(request, MAX_BUNDLE_BYTES);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const boundedRequest = new Request(request.url, { method: request.method, headers, body });
    const form = await boundedRequest.formData();
    if (form.get('mode') !== 'bundle') throw new ApiError(400, 'INVALID_IMPORT_MODE', 'Multipart imports require mode=bundle');
    const value = form.get('file');
    if (!value || typeof value === 'string' || typeof value.arrayBuffer !== 'function') throw new ApiError(400, 'BUNDLE_REQUIRED', 'Multipart import requires a zip file');
    if (value.size > MAX_BUNDLE_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Bundle exceeds the 50 MB limit');
    const input = await value.arrayBuffer();
    const hooks = productionBundleImportHooks(actor);
    return expectedUpdatedAt === undefined
      ? importBundle(courseId, input, actor, hooks)
      : importBundle(courseId, input, actor, hooks, undefined, expectedUpdatedAt);
  }

  const body = SingleImportBody.parse(await readStrictJsonBodyLimited(request, { envelope: true }));
  return expectedUpdatedAt === undefined
    ? importSingle(courseId, body.text, actor)
    : importSingle(courseId, body.text, actor, undefined, expectedUpdatedAt);
});
