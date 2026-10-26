import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({ rpc: mocks.rpc }) }));
import { applyPublicResponseHeaders, checkPublicRateLimit, resetPublicRateLimitForTests } from '@/features/marketing/public-http';
import { createSignedPublicSessionCookie } from '@/lib/rate-limit';
import { publicRoute } from '@/features/marketing/public-route';

describe('self-hosted shared public rate limiting', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', 'test-gateway-key');
    vi.stubEnv('TRUSTED_PROXY', '1');
    resetPublicRateLimitForTests();
    mocks.rpc.mockReset().mockResolvedValue({ data: { allowed: true, issueSession: true }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('claims the shared database for every request and preserves 25 signed learners behind one school IP', async () => {
    for (let i = 0; i < 25; i++) {
      const cookie = createSignedPublicSessionCookie();
      const decision = await checkPublicRateLimit(new Request('https://example.test', {
        headers: { 'x-real-ip': '203.0.113.10', cookie: `vf_public_session=${cookie}` },
      }));
      expect(decision.allowed).toBe(true);
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(25);
    const calls = mocks.rpc.mock.calls;
    expect(calls.every(([name, args]) => name === 'public_rate_limit' && /^[a-f0-9]{64}$/.test(args.p_session))).toBe(true);
    expect(new Set(calls.map(([, args]) => args.p_connection)).size).toBe(1);
    expect(new Set(calls.map(([, args]) => args.p_session)).size).toBe(25);
  });
  it.each([
    { data: null, error: { message: 'offline' } },
    { data: true, error: null },
    { data: { allowed: true }, error: null },
  ])('fails closed with 503 for unavailable or malformed shared responses', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    const response = await publicRoute(async () => ({ secret: 'must not run' }))(new Request('https://example.test'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('fails closed when the database transport rejects and does not invoke the handler', async () => {
    mocks.rpc.mockRejectedValue(new Error('connection unavailable'));
    const handler = vi.fn();
    const response = await publicRoute(handler)(new Request('https://example.test'));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(handler).not.toHaveBeenCalled();
  });
  it('retains the hosted limiter without a gateway setting', async () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', '');
    expect((await checkPublicRateLimit(new Request('https://example.test'))).allowed).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps denied shared admission to 429 and never mints unapproved cookies', async () => {
    mocks.rpc.mockResolvedValue({ data: { allowed: false, issueSession: false }, error: null });
    const response = await publicRoute(async () => ({}))(new Request('https://example.test'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('ignores unsigned cookies and untrusted forwarded identity headers', async () => {
    vi.stubEnv('TRUSTED_PROXY', '0');
    for (const ip of ['203.0.113.1', '203.0.113.2']) {
      await checkPublicRateLimit(new Request('https://example.test', { headers: {
        'x-real-ip': ip, 'x-forwarded-for': ip, cookie: `vf_public_session=${ip}`,
      } }));
    }
    expect(mocks.rpc.mock.calls[0][1].p_session).toBeNull();
    expect(mocks.rpc.mock.calls[0][1].p_connection).toBe(mocks.rpc.mock.calls[1][1].p_connection);
  });
  it('keeps shared-approved session cookies private and no-store', async () => {
    const decision = await checkPublicRateLimit(new Request('https://example.test'));
    const response = applyPublicResponseHeaders(new Response('{}'), decision, { cache: true });
    expect(response.headers.get('set-cookie')).toContain('vf_public_session=');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
