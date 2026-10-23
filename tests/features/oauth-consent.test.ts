import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasStudioConsentAccess, isConsentTester } from '@/features/oauth-consent/admission';
import { allowedConsentCallback, allowedConsentReturn } from '@/features/oauth-consent/redirect-allowlist';
import { ApiError } from '@/lib/api';

describe('OAuth consent admission', () => {
  it('requires both Studio admission and course READ authority', () => {
    expect(hasStudioConsentAccess({ userId: 'editor', roles: [{ role: 'editor', branchId: null }] })).toBe(true);
    expect(hasStudioConsentAccess({ userId: 'contributor', roles: [{ role: 'contributor', branchId: null }] })).toBe(false);
    expect(hasStudioConsentAccess({ userId: 'teacher', roles: [{ role: 'instructor', branchId: 'branch-a' }] })).toBe(false);
  });

  it('limits Phase 0 consent to configured tester IDs', () => {
    const one = '00000000-0000-4000-8000-000000000001';
    const two = '00000000-0000-4000-8000-000000000002';
    const three = '00000000-0000-4000-8000-000000000003';
    expect(isConsentTester(one, undefined)).toBe(true);
    expect(isConsentTester(one, `${two}, ${one}`)).toBe(true);
    expect(isConsentTester(one, `${two}, ${three}`)).toBe(false);
    expect(isConsentTester(one, '')).toBe(false);
    expect(isConsentTester(one, '  ,  ')).toBe(false);
    expect(isConsentTester(one, 'invalid-user-id')).toBe(false);
  });
});

describe('OAuth callback allowlist', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'claude.ai'],
    ['https://claude.com/api/mcp/auth_callback', 'claude.com'],
    ['https://chatgpt.com/connector_platform_oauth_redirect', 'chatgpt.com'],
    ['https://chatgpt.com/connector/oauth/AbCd1234EfGh', 'chatgpt.com'],
    ['http://localhost:58135/callback', 'localhost'],
    ['http://127.0.0.1:8080/callback', '127.0.0.1'],
  ])('accepts the exact callback %s', (uri, host) => {
    expect(allowedConsentCallback(uri)?.host).toBe(host);
  });

  it.each([
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://claude.ai@evil.example/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback/extra',
    'https://claude.ai/api/mcp/auth_callback?next=evil',
    'https://claude.ai/api/mcp/auth_callback#fragment',
    'http://localhost.evil.example:8080/callback',
    'http://localhost:8080/not-callback',
    'http://localhost/callback',
    'https://localhost:8080/callback',
    'http://192.168.0.1:8080/callback',
    'javascript:alert(1)',
  ])('rejects untrusted callback %s', (uri) => {
    expect(allowedConsentCallback(uri)).toBeNull();
  });

  it('checks the completed redirect against the original approved callback', () => {
    const callback = 'https://claude.ai/api/mcp/auth_callback';
    const completed = `${callback}?code=abc&state=123`;
    expect(allowedConsentReturn(completed, callback)).toBe(completed);
    expect(allowedConsentReturn('https://claude.com/api/mcp/auth_callback?code=abc', callback)).toBeNull();
    expect(allowedConsentReturn(`${callback}#code=abc`, callback)).toBeNull();
  });

  it('keeps a ChatGPT callback ID bound to the approved connection', () => {
    const callback = 'https://chatgpt.com/connector/oauth/AbCd1234EfGh';
    expect(allowedConsentReturn(`${callback}?code=abc&state=123`, callback)).toBe(`${callback}?code=abc&state=123`);
    expect(allowedConsentReturn('https://chatgpt.com/connector/oauth/other123?code=abc', callback)).toBeNull();
  });
});

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getStudioContext: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  logMcpEvent: vi.fn(),
  isMcpAccessBlocked: vi.fn(),
  enforceRateLimit: vi.fn(),
  userRateLimitKey: vi.fn((scope: string, userId: string) => `${scope}:user:${userId}`),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/features/workspace/context', () => ({ getStudioContext: mocks.getStudioContext }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: async () => ({ auth: { oauth: {
    getAuthorizationDetails: mocks.getAuthorizationDetails,
    approveAuthorization: mocks.approveAuthorization,
    denyAuthorization: mocks.denyAuthorization,
  } } }),
  supabaseService: () => ({ rpc: vi.fn() }),
}));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { mcpConsent: { limit: 10, windowSeconds: 60 } },
  enforceRateLimit: mocks.enforceRateLimit,
  userRateLimitKey: mocks.userRateLimitKey,
}));
vi.mock('@/features/studio-mcp/log', () => ({ logMcpEvent: mocks.logMcpEvent }));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ isMcpAccessBlocked: mocks.isMcpAccessBlocked }));

import { POST } from '@/app/api/v1/oauth/consent/route';

const callback = 'https://claude.ai/api/mcp/auth_callback';
const details = {
  authorization_id: 'authorization-1',
  redirect_uri: callback,
  client: { id: 'client-1', name: 'Quiz helper', uri: null, logo_uri: null },
  user: { id: 'editor', email: 'editor@example.com' },
  scope: 'openid email offline_access',
};

function consentRequest(decision: 'approve' | 'deny', origin = 'https://academy.example') {
  return new Request('https://academy.example/api/v1/oauth/consent', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ authorizationId: 'authorization-1', decision }),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STUDIO_MCP_ENABLED', '1');
  mocks.requireApiUser.mockReset().mockResolvedValue({ id: 'editor' });
  mocks.getStudioContext.mockReset().mockResolvedValue({ actor: { userId: 'editor', roles: [{ role: 'editor', branchId: null }] } });
  mocks.getAuthorizationDetails.mockReset().mockResolvedValue({ data: details, error: null });
  mocks.approveAuthorization.mockReset().mockResolvedValue({ data: { redirect_url: `${callback}?code=abc&state=123` }, error: null });
  mocks.denyAuthorization.mockReset().mockResolvedValue({ data: { redirect_url: `${callback}?error=access_denied&state=123` }, error: null });
  mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
  mocks.logMcpEvent.mockReset();
  mocks.userRateLimitKey.mockClear();
});

describe('POST /api/v1/oauth/consent', () => {
  it('blocks approval before requesting OAuth authorization details for a blocked user', async () => {
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'MCP_ACCESS_BLOCKED' } });
    expect(mocks.isMcpAccessBlocked).toHaveBeenCalledWith('editor', expect.anything());
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('does not release an existing grant redirect while the user is blocked', async () => {
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=old` }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('fails closed before OAuth approval when the block lookup fails', async () => {
    mocks.isMcpAccessBlocked.mockRejectedValue(new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access status is unavailable'));
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'MCP_ACCESS_UNAVAILABLE' } });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('blocks approval when the MCP kill switch is off before contacting Supabase Auth', async () => {
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(404);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('does not return an existing grant redirect when the MCP kill switch is off', async () => {
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=old` }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(404);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin POST before touching auth', async () => {
    const response = await POST(consentRequest('approve', 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('rejects a missing Origin header to prevent CSRF', async () => {
    const request = consentRequest('approve');
    request.headers.delete('origin');
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('refuses approval for a Studio contributor without course READ access', async () => {
    mocks.getStudioContext.mockResolvedValue({ actor: { userId: 'editor', roles: [{ role: 'contributor', branchId: null }] } });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('refuses approval for a signed-in non-tester during Phase 0', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', 'someone-else');
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('refuses consent when a tester list is configured but blank', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', '  ');
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('uses the fail-closed consent rate limit before reading authorization details', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests'));
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(429);
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('refuses an unsafe registered callback before approval', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: 'https://evil.example/callback' }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('can deny an unsafe request without navigating to its callback', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: 'https://evil.example/callback' }, error: null });
    mocks.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'https://evil.example/callback?error=access_denied' }, error: null });
    const response = await POST(consentRequest('deny'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { redirectUrl: null } });
    expect(mocks.denyAuthorization).toHaveBeenCalledWith('authorization-1', { skipBrowserRedirect: true });
  });

  it('never redirects after denying an unsafe request even if Auth returns a trusted host', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: 'https://evil.example/callback' }, error: null });
    const response = await POST(consentRequest('deny'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { redirectUrl: null } });
  });

  it('approves an allowed callback and returns only the verified completion URL', async () => {
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { redirectUrl: `${callback}?code=abc&state=123` } });
    expect(mocks.approveAuthorization).toHaveBeenCalledWith('authorization-1', { skipBrowserRedirect: true });
    expect(mocks.logMcpEvent).toHaveBeenCalledWith({
      event: 'consent', outcome: 'approved', userId: 'editor', clientId: 'client-1', clientName: 'Quiz helper',
    });
  });

  it('approves a registered ChatGPT callback ID and returns its exact completion URL', async () => {
    const chatgptCallback = 'https://chatgpt.com/connector/oauth/AbCd1234EfGh';
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: chatgptCallback }, error: null });
    mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: `${chatgptCallback}?code=abc&state=123` }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { redirectUrl: `${chatgptCallback}?code=abc&state=123` } });
  });

  it('rejects a completion URL that differs from the checked callback', async () => {
    mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://chatgpt.com/connector_platform_oauth_redirect?code=abc' }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(502);
  });

  it('validates an existing grant redirect before returning it', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=old` }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { redirectUrl: `${callback}?code=old` } });
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('logs client metadata from an existing-grant response when Supabase supplies it', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: {
      redirect_url: `${callback}?code=old`,
      client: { id: 'client-1', name: 'Trợ lý khóa học' },
    }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(200);
    expect(mocks.logMcpEvent).toHaveBeenCalledWith({
      event: 'consent', outcome: 'already_approved', userId: 'editor', clientId: 'client-1', clientName: 'Trợ lý khóa học',
    });
  });

  it('rejects an authorization issued to a different signed-in user', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, user: { id: 'someone-else', email: 'other@example.com' } }, error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(403);
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it('fails cleanly on a malformed Auth response instead of approving', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: 'unexpected', error: null });
    const response = await POST(consentRequest('approve'));
    expect(response.status).toBe(503);
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
  });
});
