import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

async function freshLimiter() {
  vi.resetModules();
  return import('@/features/marketing/public-http');
}

function cookiePair(setCookie: string | null) {
  return setCookie?.split(';', 1)[0] ?? '';
}

describe('public HTTP rate limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-session-signing-secret-with-enough-entropy';
    delete process.env.TRUSTED_PROXY;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.TRUSTED_PROXY;
  });

  it('issues and accepts only HMAC-signed anonymous session cookies', async () => {
    const { checkPublicRateLimit } = await freshLimiter();
    const issued = checkPublicRateLimit(new Request('https://academy.example/courses'));
    const cookie = cookiePair(issued.headers.get('set-cookie'));

    expect(cookie).toMatch(/^vf_public_session=[a-zA-Z0-9_-]{16,128}\.[a-zA-Z0-9_-]{32,128}$/);
    expect(checkPublicRateLimit(new Request('https://academy.example/courses', {
      headers: { Cookie: cookie },
    })).allowed).toBe(true);

    const unsigned = checkPublicRateLimit(new Request('https://academy.example/courses', {
      headers: { Cookie: 'vf_public_session=unsigned-session-value' },
    }));
    expect(unsigned.headers.get('set-cookie')).not.toContain('unsigned-session-value');
  });

  it('does not let rotating unsigned cookie values bypass one rate-limit bucket', async () => {
    const { checkPublicRateLimit } = await freshLimiter();
    const ceiling = 60 * 16;
    const decisions = Array.from({ length: ceiling + 1 }, (_, index) => checkPublicRateLimit(
      new Request('https://academy.example/verify/code', {
        headers: { Cookie: `vf_public_session=attacker-rotation-${index}` },
      }),
    ));

    expect(decisions.slice(0, ceiling).every(({ allowed }) => allowed)).toBe(true);
    expect(decisions[ceiling].allowed).toBe(false);
  });

  it('bounds the number of new anonymous session keys issued per minute', async () => {
    const { checkPublicRateLimit } = await freshLimiter();
    const decisions = Array.from({ length: 50 }, () => checkPublicRateLimit(
      new Request('https://academy.example/verify/code'),
    ));
    const issuedCookies = decisions.filter(({ headers }) => headers.has('set-cookie'));

    expect(issuedCookies.length).toBeGreaterThan(0);
    expect(issuedCookies.length).toBeLessThanOrEqual(32);
  });

  it('enforces the shared connection budget across rotated signed cookies', async () => {
    const { checkPublicRateLimit } = await freshLimiter();
    const cookies = Array.from({ length: 17 }, () => cookiePair(
      checkPublicRateLimit(new Request('https://academy.example/courses')).headers.get('set-cookie'),
    ));

    // Rotation is bounded by the 16 private buckets of 60 plus the shared fallback ceiling
    // of 60 x 16, so a client cycling cookies cannot outrun that aggregate.
    const ceiling = 16 * 60 + 60 * 16;
    const rotated = Array.from({ length: 3_000 }, (_, index) => checkPublicRateLimit(
      new Request('https://academy.example/courses', {
        headers: { Cookie: cookies[index % cookies.length] ?? '' },
      }),
    ));
    const allowed = rotated.filter(({ allowed: granted }) => granted).length;

    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(ceiling);
    expect(rotated.some(({ allowed: granted }) => !granted)).toBe(true);
  });

  it('does not let one anonymous client exhaust another signed visitor’s budget', async () => {
    const { checkPublicRateLimit } = await freshLimiter();
    const first = cookiePair(
      checkPublicRateLimit(new Request('https://academy.example/courses')).headers.get('set-cookie'),
    );
    const second = cookiePair(
      checkPublicRateLimit(new Request('https://academy.example/courses')).headers.get('set-cookie'),
    );
    expect(first).not.toBe(second);

    const heavy = Array.from({ length: 61 }, () => checkPublicRateLimit(
      new Request('https://academy.example/courses', { headers: { Cookie: first } }),
    ));

    expect(heavy.at(-1)?.allowed).toBe(false);
    expect(checkPublicRateLimit(new Request('https://academy.example/courses', {
      headers: { Cookie: second },
    })).allowed).toBe(true);
  });

  it('never marks a session-minting response publicly cacheable', async () => {
    const { applyPublicResponseHeaders, checkPublicRateLimit, PRIVATE_CACHE_CONTROL, PUBLIC_CACHE_CONTROL } =
      await freshLimiter();

    const minting = checkPublicRateLimit(new Request('https://academy.example/api/v1/public/courses'));
    expect(minting.headers.has('set-cookie')).toBe(true);
    const mintingResponse = applyPublicResponseHeaders(new Response('{}'), minting, { cache: true });
    expect(mintingResponse.headers.get('cache-control')).toBe(PRIVATE_CACHE_CONTROL);

    const cookie = cookiePair(minting.headers.get('set-cookie'));
    const returning = checkPublicRateLimit(new Request('https://academy.example/api/v1/public/courses', {
      headers: { Cookie: cookie },
    }));
    expect(returning.headers.has('set-cookie')).toBe(false);
    const cachedResponse = applyPublicResponseHeaders(new Response('{}'), returning, { cache: true });
    expect(cachedResponse.headers.get('cache-control')).toBe(PUBLIC_CACHE_CONTROL);
  });

  it('marks cookies secure for trusted forwarded HTTPS requests', async () => {
    process.env.TRUSTED_PROXY = '1';
    const { checkPublicRateLimit } = await freshLimiter();

    const decision = checkPublicRateLimit(new Request('http://academy.example/courses', {
      headers: { 'x-forwarded-proto': 'https' },
    }));

    expect(decision.headers.get('set-cookie')).toContain('; Secure');
  });

  it('evicts the least-recently-used bucket instead of locking out a new trusted-proxy client', async () => {
    process.env.TRUSTED_PROXY = '1';
    const { checkPublicRateLimit } = await freshLimiter();

    for (let index = 0; index < 1_001; index += 1) {
      const decision = checkPublicRateLimit(new Request('https://academy.example/verify/code', {
        headers: { 'x-real-ip': `198.51.${Math.floor(index / 255)}.${index % 255}` },
      }));
      expect(decision.allowed).toBe(true);
    }
  });
});
