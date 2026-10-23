import { z } from 'zod';

import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';

const RevokeGrantInput = z.object({ clientId: z.uuid() }).strict();
const revokeLimit = { limit: 10, windowSeconds: 60 } as const;

/** Revokes only a grant owned by the current cookie-authenticated account. */
export const POST = withHandler(async (request) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new ApiError(403, 'FORBIDDEN', 'Same-origin request required');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON body required');
  }

  const user = await requireApiUser();
  await enforceRateLimit(supabaseService(), userRateLimitKey('oauth:grant-revoke', user.id), revokeLimit);
  const { clientId } = await parseBody(RevokeGrantInput, request, { maxBytes: 512 });
  const client = await supabaseUser();

  let listed: Awaited<ReturnType<typeof client.auth.oauth.listGrants>>;
  try {
    listed = await client.auth.oauth.listGrants();
  } catch {
    throw new ApiError(503, 'GRANTS_UNAVAILABLE', 'Unable to verify this authorization. Try again later.');
  }
  if (listed.error || !Array.isArray(listed.data)) {
    throw new ApiError(503, 'GRANTS_UNAVAILABLE', 'Unable to verify this authorization. Try again later.');
  }
  if (!listed.data.some((grant) => grant.client?.id === clientId)) {
    throw new ApiError(404, 'GRANT_NOT_FOUND', 'Authorization not found');
  }

  let revoked: Awaited<ReturnType<typeof client.auth.oauth.revokeGrant>>;
  try {
    revoked = await client.auth.oauth.revokeGrant({ clientId });
  } catch {
    throw new ApiError(503, 'GRANT_REVOKE_UNAVAILABLE', 'Unable to remove this authorization. Try again later.');
  }
  if (revoked.error) {
    throw new ApiError(503, 'GRANT_REVOKE_UNAVAILABLE', 'Unable to remove this authorization. Try again later.');
  }
  return ok({ revoked: true }, { headers: { 'Cache-Control': 'no-store' } });
});
