import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  listGrants: vi.fn(),
  revokeGrant: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: async () => ({ auth: { oauth: { listGrants: mocks.listGrants, revokeGrant: mocks.revokeGrant } } }),
  supabaseService: () => ({ rpc: mocks.rpc }),
}));

import { POST } from '@/app/api/v1/account/oauth-grants/route';

const clientId = '00000000-0000-4000-8000-000000000123';
const endpoint = 'https://academy.example/api/v1/account/oauth-grants';

function request(id: unknown = clientId, origin: string | null = 'https://academy.example') {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (origin !== null) headers.set('origin', origin);
  return new Request(endpoint, { method: 'POST', headers, body: JSON.stringify({ clientId: id }) });
}

beforeEach(() => {
  mocks.requireApiUser.mockReset().mockResolvedValue({ id: 'former-studio-editor' });
  mocks.listGrants.mockReset().mockResolvedValue({
    data: [{ client: { id: clientId, name: 'Course helper', uri: 'javascript:alert(1)', logo_uri: 'https://evil.example/logo' }, scopes: ['openid'], granted_at: '2026-09-20T00:00:00Z' }],
    error: null,
  });
  mocks.revokeGrant.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe('POST /api/v1/account/oauth-grants', () => {
  it('revokes a listed grant with the signed-in user client without Studio admission', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { revoked: true } });
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('rate_limit', {
      key: 'oauth:grant-revoke:user:former-studio-editor', limit: 10, window_seconds: 60,
    });
    expect(mocks.revokeGrant).toHaveBeenCalledExactlyOnceWith({ clientId });
  });

  it.each([null, 'https://evil.example'])('rejects Origin %s before authentication', async (origin) => {
    const response = await POST(request(clientId, origin));
    expect(response.status).toBe(403);
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it('requires a live account session', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it.each(['', 'short', 'x'.repeat(256), '00000000-0000-4000-8000-000000000123/other'])('rejects an invalid client ID %s', async (id) => {
    const response = await POST(request(id));
    expect(response.status).toBe(400);
    expect(mocks.listGrants).not.toHaveBeenCalled();
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it('rejects a grant that is absent from this account', async () => {
    mocks.listGrants.mockResolvedValue({ data: [], error: null });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it('fails closed when the grant list is unavailable', async () => {
    mocks.listGrants.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it('does not report success when Auth rejects revocation', async () => {
    mocks.revokeGrant.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'GRANT_REVOKE_UNAVAILABLE', message: 'Unable to remove this authorization. Try again later.' } });
  });

  it('fails closed when the per-account rate limiter denies the request', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(mocks.listGrants).not.toHaveBeenCalled();
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });
});
