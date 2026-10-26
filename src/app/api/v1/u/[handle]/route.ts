import { getPublicProfile } from '@/features/profile/service';
import {
  applyPublicResponseHeaders,
  checkPublicRateLimit,
} from '@/features/marketing/public-http';
import { ApiError, fail, withHandler } from '@/lib/api';

type RouteContext = { params: Promise<{ handle: string }> };

const handleGet = withHandler(async (_request, context) => {
  const { handle } = await (context as RouteContext).params;
  const profile = await getPublicProfile(handle);
  if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  return profile;
});

export async function GET(request: Request, context: RouteContext) {
  const rateLimit = await checkPublicRateLimit(request);
  if (!rateLimit.allowed) {
    return applyPublicResponseHeaders(
      fail(rateLimit.status ?? 429,
        rateLimit.status === 503 ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
        rateLimit.status === 503 ? 'Rate limit service is unavailable' : 'Too many requests',
        undefined, { 'Retry-After': '60' }),
      rateLimit,
    );
  }
  return applyPublicResponseHeaders(await handleGet(request, context), rateLimit);
}
