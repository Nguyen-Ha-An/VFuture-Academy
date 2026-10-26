import { NextResponse } from 'next/server';

import { applyPublicResponseHeaders, checkPublicRateLimit } from './public-http';

export function publicRoute(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request) => {
    const rateLimit = await checkPublicRateLimit(request);
    if (!rateLimit.allowed) {
      return applyPublicResponseHeaders(NextResponse.json({ error: rateLimit.status === 503 ? 'rate_limit_unavailable' : 'rate_limited' }, { status: rateLimit.status ?? 429, headers: { 'Retry-After': '60' } }), rateLimit);
    }
    const data = await handler(request);
    return applyPublicResponseHeaders(NextResponse.json({ data }), rateLimit);
  };
}
