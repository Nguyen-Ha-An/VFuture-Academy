import { contentReviewContext } from '@/features/admin/content-review-production';
import { ok, withHandler } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = withHandler(async (request) => {
  const { service } = await contentReviewContext(request, 'content.read');
  return ok(await service.listContent(), { headers: { 'cache-control': 'private, no-store' } });
});
