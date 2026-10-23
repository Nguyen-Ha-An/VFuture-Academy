import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  RATE_LIMITS,
  SHARED_IDENTITY_LIMIT_MULTIPLIER,
  createSignedPublicSessionCookie,
  enforceRateLimit,
  enforceRequestRateLimit,
  requestRateLimitIdentity,
  requestRateLimitKey,
  sharedIdentityPolicy,
  trackedRateLimitConnectionsForTests,
  userRateLimitKey,
} from '@/lib/rate-limit';
import {
  checkPublicRateLimit,
  resetPublicRateLimitForTests,
} from '@/features/marketing/public-http';

describe('shared PostgreSQL rate limiter', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_COOKIE_SECRET', 'test-rate-limit-cookie-secret-with-32-bytes');
    vi.stubEnv('TRUSTED_PROXY', '');
    resetPublicRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPublicRateLimitForTests();
  });

  it('claims a fixed-window slot through the canonical RPC arguments', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(enforceRateLimit({ rpc }, 'studio:import:user:user-1', RATE_LIMITS.import))
      .resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('rate_limit', {
      key: 'studio:import:user:user-1',
      limit: RATE_LIMITS.import.limit,
      window_seconds: RATE_LIMITS.import.windowSeconds,
    });
  });

  it('fails closed with a standard 429 and retry delay after the database rejects a claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(enforceRateLimit({ rpc }, 'schema:ip:hash', RATE_LIMITS.validation))
      .rejects.toMatchObject({
        status: 429,
        code: 'RATE_LIMITED',
        headers: { 'Retry-After': String(RATE_LIMITS.validation.windowSeconds) },
      });
  });

  it('reports unavailable or malformed limiter responses without allowing the request', async () => {
    await expect(enforceRateLimit({
      rpc: vi.fn().mockResolvedValue({ data: true, error: { message: 'private database error' } }),
    }, 'analytics:ip:hash', RATE_LIMITS.analytics)).rejects.toMatchObject({
      status: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });

    await expect(enforceRateLimit({
      rpc: vi.fn().mockResolvedValue({ data: 'yes', error: null }),
    }, 'analytics:ip:hash', RATE_LIMITS.analytics)).rejects.toMatchObject({
      status: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('builds namespaced user keys and hashes anonymous request identities', () => {
    expect(userRateLimitKey('studio:import', 'user-1')).toBe('studio:import:user:user-1');

    const first = requestRateLimitKey('schema:validate', new Request('https://academy.example/api', {
      headers: { cookie: 'vf_public_session=public-session-123456' },
    }));
    const second = requestRateLimitKey('schema:validate', new Request('https://academy.example/api', {
      headers: { cookie: 'vf_public_session=public-session-123456' },
    }));

    expect(first).toBe(second);
    expect(first).toMatch(/^schema:validate:request:[a-f0-9]{64}$/);
    expect(first).not.toContain('public-session');
  });

  it('rejects forged cookies and falls back to connection identity', () => {
    const firstRequest = new Request('https://academy.example/api', {
      headers: { cookie: 'vf_public_session=forged-session-0001' },
    });
    const secondRequest = new Request('https://academy.example/api', {
      headers: { cookie: 'vf_public_session=forged-session-0002' },
    });
    Object.defineProperty(firstRequest, 'ip', { value: '203.0.113.10' });
    Object.defineProperty(secondRequest, 'ip', { value: '203.0.113.10' });

    expect(requestRateLimitKey('schema:validate', firstRequest))
      .toBe(requestRateLimitKey('schema:validate', secondRequest));
  });

  it('resolves valid signed sessions alongside their connection identity', () => {
    const firstCookie = createSignedPublicSessionCookie();
    const secondCookie = createSignedPublicSessionCookie();
    if (!firstCookie || !secondCookie) throw new Error('Expected signed public session cookies');
    const request = (cookie: string) => {
      const value = new Request('https://academy.example/api', {
        headers: { cookie: `vf_public_session=${cookie}` },
      });
      Object.defineProperty(value, 'ip', { value: '203.0.113.10' });
      return value;
    };

    expect(requestRateLimitIdentity(request(firstCookie))).toMatchObject({
      connection: 'connection:203.0.113.10',
      session: expect.stringMatching(/^session:/),
    });
    expect(requestRateLimitKey('schema:validate', request(firstCookie)))
      .not.toBe(requestRateLimitKey('schema:validate', request(secondCookie)));
  });

  it('honours proxy identity only when the deployment explicitly trusts its proxy', () => {
    const request = (ip: string, cookie: string) => new Request('https://academy.example/api', {
      headers: { 'x-forwarded-for': ip, cookie: `vf_public_session=${cookie}` },
    });

    const ignoredA = requestRateLimitKey('schema:validate', request('198.51.100.1', 'forged-session-0001'));
    const ignoredB = requestRateLimitKey('schema:validate', request('198.51.100.2', 'forged-session-0002'));
    expect(ignoredA).toBe(ignoredB);

    vi.stubEnv('TRUSTED_PROXY', '1');
    const trustedA = requestRateLimitKey('schema:validate', request('198.51.100.1', 'forged-session-0001'));
    const trustedB = requestRateLimitKey('schema:validate', request('198.51.100.2', 'forged-session-0002'));
    expect(trustedA).not.toBe(trustedB);
    expect(requestRateLimitKey('schema:validate', request('198.51.100.1', 'forged-session-0002')))
      .toBe(trustedA);
  });

  it('issues HMAC-signed session cookies and rejects a tampered signature', () => {
    const decision = checkPublicRateLimit(new Request('https://academy.example/api'));
    const cookie = decision.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toMatch(/^vf_public_session=[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43}$/);
    if (!cookie) throw new Error('Expected a signed public session cookie');

    const validRequest = new Request('https://academy.example/api', { headers: { cookie } });
    const validKey = requestRateLimitKey('schema:validate', validRequest);
    const tamperedCookie = cookie?.replace(/.$/, (last) => last === 'A' ? 'B' : 'A');
    const tamperedKey = requestRateLimitKey('schema:validate', new Request('https://academy.example/api', {
      headers: { cookie: tamperedCookie },
    }));
    const anonymousKey = requestRateLimitKey('schema:validate', new Request('https://academy.example/api'));

    expect(validKey).not.toBe(anonymousKey);
    expect(tamperedKey).toBe(anonymousKey);
  });

  it('bounds distinct signed-session buckets for connection-less anonymous traffic', () => {
    const identities = Array.from({ length: 17 }, () => {
      const cookie = createSignedPublicSessionCookie();
      if (!cookie) throw new Error('Expected a signed public session cookie');
      return requestRateLimitIdentity(new Request('https://academy.example/api', {
        headers: { cookie: `vf_public_session=${cookie}` },
      }));
    });

    expect(new Set(identities.slice(0, 16).map(({ session }) => session))).toHaveLength(16);
    expect(identities[16]).toEqual({ connection: 'anonymous', session: 'anonymous' });
  });

  it('bounds signed-session churn when a connection identity is available', () => {
    const identities = Array.from({ length: 17 }, () => {
      const cookie = createSignedPublicSessionCookie();
      if (!cookie) throw new Error('Expected a signed public session cookie');
      const request = new Request('https://academy.example/api', {
        headers: { cookie: `vf_public_session=${cookie}` },
      });
      Object.defineProperty(request, 'ip', { value: '203.0.113.20' });
      return requestRateLimitIdentity(request).session;
    });

    expect(new Set(identities.slice(0, 16))).toHaveLength(16);
    expect(identities[16]).toBe('connection:203.0.113.20');
  });

  it('rejects signed session cookies after their 24 hour TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));
    const cookie = createSignedPublicSessionCookie();
    if (!cookie) throw new Error('Expected a signed public session cookie');

    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);
    const identity = requestRateLimitIdentity(new Request('https://academy.example/api', {
      headers: { cookie: `vf_public_session=${cookie}` },
    }));

    expect(identity).toEqual({ connection: 'anonymous', session: 'anonymous' });
    vi.useRealTimers();
  });

  it('enforces both session and connection buckets and rejects when either is exhausted', async () => {
    const cookie = createSignedPublicSessionCookie();
    if (!cookie) throw new Error('Expected a signed public session cookie');
    const request = new Request('https://academy.example/api', {
      headers: { cookie: `vf_public_session=${cookie}` },
    });
    Object.defineProperty(request, 'ip', { value: '203.0.113.30' });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(enforceRequestRateLimit(
      { rpc },
      'schema:validate',
      request,
      RATE_LIMITS.validation,
    )).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => args.key)).toEqual([
      expect.stringMatching(/^schema:validate:request:[a-f0-9]{64}$/),
      expect.stringMatching(/^schema:validate:request:[a-f0-9]{64}$/),
    ]);
    expect(rpc.mock.calls[0]?.[1].key).not.toBe(rpc.mock.calls[1]?.[1].key);
    expect(rpc.mock.calls.every(([, args]) => args.limit === RATE_LIMITS.validation.limit)).toBe(true);
  });

  it('never charges the shared fallback bucket for a client holding a private session', async () => {
    const cookie = createSignedPublicSessionCookie();
    if (!cookie) throw new Error('Expected a signed public session cookie');
    const request = new Request('https://academy.example/api', {
      headers: { cookie: `vf_public_session=${cookie}` },
    });
    const sharedKey = requestRateLimitKey(
      'schema:validate',
      new Request('https://academy.example/api'),
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(enforceRequestRateLimit(
      { rpc },
      'schema:validate',
      request,
      RATE_LIMITS.validation,
    )).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      key: requestRateLimitKey('schema:validate', request),
      limit: RATE_LIMITS.validation.limit,
    });
    expect(rpc.mock.calls[0]?.[1].key).not.toBe(sharedKey);
  });

  it('claims the shared fallback bucket at its scaled aggregate ceiling', async () => {
    const request = new Request('https://academy.example/api');
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(enforceRequestRateLimit(
      { rpc },
      'schema:validate',
      request,
      RATE_LIMITS.validation,
    )).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      key: requestRateLimitKey('schema:validate', request),
      limit: RATE_LIMITS.validation.limit * SHARED_IDENTITY_LIMIT_MULTIPLIER,
      window_seconds: RATE_LIMITS.validation.windowSeconds,
    });
    expect(sharedIdentityPolicy(RATE_LIMITS.validation)).toEqual({
      limit: RATE_LIMITS.validation.limit * SHARED_IDENTITY_LIMIT_MULTIPLIER,
      windowSeconds: RATE_LIMITS.validation.windowSeconds,
    });
  });

  it('keeps identity bookkeeping bounded across many trusted-proxy connections', () => {
    vi.stubEnv('TRUSTED_PROXY', '1');
    for (let index = 0; index < 1_200; index += 1) {
      const cookie = createSignedPublicSessionCookie();
      if (!cookie) throw new Error('Expected a signed public session cookie');
      const identity = requestRateLimitIdentity(new Request('https://academy.example/api', {
        headers: {
          'x-real-ip': `198.51.${Math.floor(index / 255)}.${index % 255}`,
          cookie: `vf_public_session=${cookie}`,
        },
      }));
      expect(identity.session).toMatch(/^session:/);
    }

    expect(trackedRateLimitConnectionsForTests()).toBeLessThanOrEqual(1_000);
  });
});
