import { z } from 'zod';

import { hasStudioConsentAccess, isConsentTester } from '@/features/oauth-consent/admission';
import { allowedConsentCallback, allowedConsentReturn } from '@/features/oauth-consent/redirect-allowlist';
import { logMcpEvent } from '@/features/studio-mcp/log';
import { isMcpAccessBlocked } from '@/features/studio-mcp/auth/access-block';
import { mcpEnabled } from '@/features/studio-mcp/config';
import { getStudioContext } from '@/features/workspace/context';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';

const Decision = z.object({
  authorizationId: z.string().min(1).max(256),
  decision: z.enum(['approve', 'deny']),
}).strict();

function authorizationUnavailable(error: { status?: number } | null): ApiError {
  return error?.status === 400 || error?.status === 404 || error?.status === 410
    ? new ApiError(410, 'AUTHORIZATION_EXPIRED', 'Authorization expired. Start again from your AI app.')
    : new ApiError(503, 'AUTHORIZATION_UNAVAILABLE', 'Authorization is unavailable. Try again later.');
}

function clientLogFields(value: unknown): { clientId?: string; clientName?: string } {
  if (typeof value !== 'object' || value === null || !('client' in value)) return {};
  const client = value.client;
  if (typeof client !== 'object' || client === null) return {};
  return {
    ...('id' in client && typeof client.id === 'string' ? { clientId: client.id } : {}),
    ...('name' in client && typeof client.name === 'string' ? { clientName: client.name } : {}),
  };
}

/** Consent is a cookie-authenticated mutation; require a browser same-origin POST. */
export const POST = withHandler(async (request) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new ApiError(403, 'FORBIDDEN', 'Same-origin request required');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON body required');
  }
  if (!mcpEnabled()) {
    throw new ApiError(404, 'MCP_DISABLED', 'Studio MCP is unavailable');
  }

  const user = await requireApiUser();
  const { actor } = await getStudioContext();
  if (actor.userId !== user.id || !hasStudioConsentAccess(actor)) {
    throw new ApiError(403, 'FORBIDDEN', 'Studio course access required');
  }
  if (!isConsentTester(user.id)) {
    throw new ApiError(403, 'NOT_A_TESTER', 'This connection is limited to named testers');
  }

  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('mcp:consent', user.id),
    RATE_LIMITS.mcpConsent,
  );
  if (await isMcpAccessBlocked(user.id, supabaseService())) {
    throw new ApiError(403, 'MCP_ACCESS_BLOCKED', 'Studio MCP access is blocked for this account');
  }
  const { authorizationId, decision } = await parseBody(Decision, request, { maxBytes: 2_048 });
  const client = await supabaseUser();
  const detailsResult = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsResult.error || !detailsResult.data || typeof detailsResult.data !== 'object') {
    throw authorizationUnavailable(detailsResult.error);
  }
  const details = detailsResult.data;

  // Supabase may return a completed redirect when the user already consented.
  // It still needs the same destination check before any browser navigation.
  if ('redirect_url' in details) {
    const redirectUrl = allowedConsentReturn(details.redirect_url);
    if (decision === 'approve') {
      if (!redirectUrl) throw new ApiError(403, 'UNSAFE_REDIRECT', 'OAuth callback is not allowed');
      logMcpEvent({ event: 'consent', outcome: 'already_approved', userId: user.id, ...clientLogFields(details) });
      return ok({ redirectUrl }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const denied = await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (denied.error || !denied.data) throw authorizationUnavailable(denied.error);
    logMcpEvent({ event: 'consent', outcome: 'denied', userId: user.id, ...clientLogFields(details) });
    return ok({ redirectUrl: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (details.authorization_id !== authorizationId || details.user?.id !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Authorization does not belong to this account');
  }
  const callback = allowedConsentCallback(details.redirect_uri);
  if (decision === 'approve' && !callback) {
    logMcpEvent({ event: 'consent', outcome: 'blocked_redirect', userId: user.id, ...clientLogFields(details) });
    throw new ApiError(403, 'UNSAFE_REDIRECT', 'OAuth callback is not allowed');
  }

  const result = decision === 'approve'
    ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (result.error || !result.data) throw authorizationUnavailable(result.error);

  // Never hand a code to a different destination, even if Auth returns an
  // unexpected completion URL. A denied unsafe callback stays on this page.
  const redirectUrl = callback ? allowedConsentReturn(result.data.redirect_url, callback.uri) : null;
  if (decision === 'approve' && !redirectUrl) {
    logMcpEvent({ event: 'consent', outcome: 'invalid_redirect', userId: user.id, ...clientLogFields(details) });
    throw new ApiError(502, 'INVALID_REDIRECT', 'OAuth callback changed during authorization');
  }
  logMcpEvent({ event: 'consent', outcome: decision === 'approve' ? 'approved' : 'denied', userId: user.id, ...clientLogFields(details) });
  return ok({ redirectUrl }, { headers: { 'Cache-Control': 'no-store' } });
});
