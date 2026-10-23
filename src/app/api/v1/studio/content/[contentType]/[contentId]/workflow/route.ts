import { z } from 'zod';

import { ContentTypeSchema } from '@/features/admin/content-review';
import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, withHandler } from '@/lib/api';

type Context = { params: Promise<{ contentType: string; contentId: string }> };

export const GET = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.read');
  const params = await (routeContext as Context).params;
  const result = await service.workflow(
    ContentTypeSchema.parse(params.contentType),
    z.string().min(1).parse(params.contentId),
  );
  return ok(result, { headers: { 'cache-control': 'private, no-store' } });
});
