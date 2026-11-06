import { ReviewQueue } from '@/features/admin/components/ContentReviewWorkspace';
import { studioReviewData } from '@/features/studio/home-data';
import { reviewQueueReturnHref } from '@/features/content-review/review-navigation';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params, searchParams }: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ reviewId }, query] = await Promise.all([params, searchParams]);
  const data = await studioReviewData(reviewId);
  const returnTo = typeof query.returnTo === 'string' ? query.returnTo : undefined;
  return <ReviewQueue {...data} returnHref={reviewQueueReturnHref(returnTo)} />;
}
