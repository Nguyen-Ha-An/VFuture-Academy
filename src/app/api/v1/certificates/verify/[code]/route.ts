import { NextResponse } from 'next/server';

import { verify } from '@/features/certificates/service';
import {
  applyPublicResponseHeaders,
  checkPublicRateLimit,
} from '@/features/marketing/public-http';
import { fail, withHandler } from '@/lib/api';

type RouteContext = { params: Promise<{ code: string }> };

export const runtime = 'nodejs';

const handleVerification = withHandler(async (_request, context) => {
  const { code } = await (context as RouteContext).params;
  const certificate = await verify(code);
  return certificate ?? fail(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found');
});

export async function GET(request: Request, context: RouteContext) {
  const rateLimit = await checkPublicRateLimit(request);
  if (!rateLimit.allowed) {
    return applyPublicResponseHeaders(NextResponse.json(
      { error: { code: rateLimit.status === 503 ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
        message: rateLimit.status === 503 ? 'Rate limit service is unavailable' : 'Too many verification requests' } },
      { status: rateLimit.status ?? 429, headers: { 'Retry-After': '60' } },
    ), rateLimit);
  }
  return applyPublicResponseHeaders(await handleVerification(request, context), rateLimit);
}
