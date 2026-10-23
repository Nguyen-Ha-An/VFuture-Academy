import { z } from 'zod';

import { ReviewDecisionSchema } from '@/features/admin/content-review';
import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, parseBody, withHandler } from '@/lib/api';

type Context = { params: Promise<{ reviewId: string }> };
const DecisionSchema = z.object({ decision: ReviewDecisionSchema, note: z.string().trim().min(1).max(4000) }).strict();

export const POST = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.review', true);
  const { reviewId } = await (routeContext as Context).params;
  const body = await parseBody(DecisionSchema, request);
  return ok(await service.decideReview(reviewId, body.decision, body.note), {
    headers: { 'cache-control': 'private, no-store' },
  });
});
