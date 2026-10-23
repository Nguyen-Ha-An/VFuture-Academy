import { z } from 'zod';

import { ContentTypeSchema } from '@/features/admin/content-review';
import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, parseBody, withHandler } from '@/lib/api';

type Context = { params: Promise<{ contentType: string; contentId: string }> };
const RequestSchema = z.object({ expectedRevision: z.string().min(1) }).strict();

export const POST = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.review.request', true);
  const params = await (routeContext as Context).params;
  const { expectedRevision } = await parseBody(RequestSchema, request);
  const result = await service.requestReview(
    ContentTypeSchema.parse(params.contentType),
    z.string().min(1).parse(params.contentId),
    expectedRevision,
  );
  return ok(result, { status: 201, headers: { 'cache-control': 'private, no-store' } });
});
