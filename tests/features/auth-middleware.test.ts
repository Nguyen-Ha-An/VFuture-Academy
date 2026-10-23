import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getUser: vi.fn() }));

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('@/lib/env-client', () => ({ publicEnv: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' } }));

import { updateSession } from '@/lib/supabase/middleware';
import { config, middleware } from '@/middleware';

describe('Supabase session middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('verifies the session and persists rotated cookies to both request and response', async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([{ name: 'sb-auth-token', value: 'rotated-token', options: { httpOnly: true, sameSite: 'lax', path: '/' } }]);
      return { auth: { getUser: mocks.getUser } };
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const request = new NextRequest('https://academy.example/home', { headers: { cookie: 'sb-auth-token=expired-token' } });

    const response = await updateSession(request);

    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(request.cookies.get('sb-auth-token')?.value).toBe('rotated-token');
    expect(response.cookies.get('sb-auth-token')?.value).toBe('rotated-token');
  });

  it('persists a supported lang query as the locale cookie before rendering', async () => {
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const request = new NextRequest('https://academy.example/courses?lang=en');

    const response = await middleware(request);

    expect(request.cookies.get('locale')?.value).toBe('en');
    expect(response.cookies.get('locale')?.value).toBe('en');
  });

  it.each(['/academy', '/academy/unknown', '/privacy', '/terms', '/contact', '/missing-public-page'])('honors locale on public pages and their not-found state: %s', async (pathname) => {
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const request = new NextRequest(`https://academy.example${pathname}?lang=en`, { headers: { cookie: 'locale=vi' } });
    const response = await middleware(request);
    expect(request.cookies.get('locale')?.value).toBe('en');
    expect(response.cookies.get('locale')?.value).toBe('en');
  });

  it.each(['/api/v1/public/courses', '/auth/callback', '/app/courses', '/account/connected-apps', '/studio', '/admin', '/grading', '/login', '/u/student', '/verify/certificate'])('does not change private or utility locale behavior: %s', async (pathname) => {
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const request = new NextRequest(`https://academy.example${pathname}?lang=en`, { headers: { cookie: 'locale=vi' } });
    const response = await middleware(request);
    expect(request.cookies.get('locale')?.value).toBe('vi');
    expect(response.cookies.get('locale')).toBeUndefined();
  });

  it('overwrites an untrusted requested-path header with the real path and query', async () => {
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const request = new NextRequest('https://academy.example/app/courses/course-1?step=2', {
      headers: { 'x-vfuture-request-path': '//evil.example/steal' },
    });

    const response = await middleware(request);

    expect(request.headers.get('x-vfuture-request-path')).toBe('/app/courses/course-1?step=2');
    expect(response.headers.get('x-middleware-request-x-vfuture-request-path'))
      .toBe('/app/courses/course-1?step=2');
  });

  it('forwards a unique production CSP nonce to Next and the browser on every request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const first = await middleware(new NextRequest('https://academy.example/courses'));
    const second = await middleware(new NextRequest('https://academy.example/courses'));
    const firstNonce = first.headers.get('x-middleware-request-x-nonce');
    const firstCsp = first.headers.get('content-security-policy');

    expect(firstNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(second.headers.get('x-middleware-request-x-nonce')).not.toBe(firstNonce);
    expect(firstCsp).toContain(`'nonce-${firstNonce}'`);
    const scriptSources = firstCsp?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('script-src '));
    expect(scriptSources).not.toContain("'unsafe-inline'");
    expect([...first.headers.keys()].filter((key) => key.toLowerCase() === 'content-security-policy'))
      .toHaveLength(1);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(firstCsp);
  });

  it('creates the nonce with Edge Web APIs when Node Buffer is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('Buffer', undefined);
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await middleware(new NextRequest('https://academy.example/courses'));

    expect(response.headers.get('x-middleware-request-x-nonce')).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('excludes every sandboxed static asset source from document middleware', () => {
    expect(config.matcher).toEqual([
      '/((?!api/mcp(?:/|$)|\\.well-known/oauth-protected-resource(?:/|$)|studio-workers/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
    ]);
  });
});
