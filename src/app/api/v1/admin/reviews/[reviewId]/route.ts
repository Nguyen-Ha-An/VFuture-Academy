import { pinnedBankPreview } from '@/features/content-review/pinned-bank-preview';
import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, withHandler } from '@/lib/api';

type Context = { params: Promise<{ reviewId: string }> };

export const dynamic = 'force-dynamic';

export const GET = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.review');
  const { reviewId } = await (routeContext as Context).params;
  return ok(await pinnedBankPreview(await service.reviewPreview(reviewId)), {
    headers: { 'cache-control': 'private, no-store' },
  });
});
