import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, withHandler } from '@/lib/api';

type Context = { params: Promise<{ reviewId: string }> };

export const POST = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.publish', true);
  const { reviewId } = await (routeContext as Context).params;
  return ok(await service.publishReview(reviewId), {
    headers: { 'cache-control': 'private, no-store' },
  });
});
