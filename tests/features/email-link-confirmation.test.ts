import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ pageCookie: vi.fn(), supabaseUser: vi.fn(), popup: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.pageCookie }) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: 'en', messages: en, namespace: 'auth' }) }));
vi.mock('@/features/workspace-ui/auth/EntranceShell', () => ({ EntranceShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/identity/legacy-popup', () => ({ consumeLegacyPopup: mocks.popup }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/lib/env', () => ({ env: {
  NEXT_PUBLIC_APP_URL: 'https://academy.example', NEXT_PUBLIC_SUPABASE_URL: 'https://project.example',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-cookie-key',
} }));

import { GET as callback } from '@/app/auth/callback/route';
import { GET as recoveryCallback, POST as updatePassword } from '@/app/auth/recovery/route';
import ConfirmEmailPage from '@/app/auth/confirm-email/page';
import { POST as redeem } from '@/app/auth/confirm-email/redeem/route';
import { EMAIL_LINK_COOKIE } from '@/lib/identity/email-link';
import { recoveryCookieName } from '@/lib/identity/recovery-receipt';

const origin = 'https://academy.example';
const email = 'learner@example.test';
const tokenHash = 'fixture-email-grant';
const authCookie = 'sb-project-auth-token';
const provider = vi.fn<typeof fetch>();

// Use the installed SDK's real cookie serialization with an in-process transport.
function serveGrant({ profileName = 'Learner', noSession = false, accessToken = 'local-access-token' } = {}) {
  let used = false;
  provider.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/auth/v1/verify') {
      expect(JSON.parse(String(init?.body)).token_hash).toBe(tokenHash);
      if (used) return Response.json({ error_code: 'otp_expired', msg: 'Link expired' }, { status: 403 });
      used = true;
      if (noSession) return Response.json({ msg: 'Check the second mailbox' });
      return Response.json({
        access_token: accessToken, refresh_token: 'local-refresh-token', token_type: 'bearer', expires_in: 3600,
        user: { id: 'learner-id', email },
      });
    }
    if (url.pathname === '/rest/v1/profiles') {
      expect(url.searchParams.get('id')).toBe('eq.learner-id');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + accessToken);
      return Response.json([{ display_name: profileName, handle: 'STU-learner' }]);
    }
    throw new Error('Unexpected fixture request');
  });
}

async function openLink(type = 'magiclink', extra: Record<string, string> = {}) {
  const recovery = type === 'recovery';
  const url = new URL(recovery ? '/auth/recovery' : '/auth/callback', origin);
  url.search = new URLSearchParams({ type, token_hash: tokenHash, next: '/profile?tab=skills', ...extra }).toString();
  const response = await (recovery ? recoveryCallback : callback)(new Request(url));
  const cookie = response.cookies.get(EMAIL_LINK_COOKIE)!;
  mocks.pageCookie.mockReturnValue(cookie);
  const params = recovery ? { recovery: '1' } : {};
  const page = renderToStaticMarkup(await ConfirmEmailPage({ searchParams: Promise.resolve(params) }));
  const confirmation = /name="confirmation" value="([^"]+)"/.exec(page)![1];
  return { cookie: cookie.value, confirmation, purpose: recovery ? 'recovery' : 'sign-in', response, page };
}

type OpenLink = Awaited<ReturnType<typeof openLink>>;
function submit(
  link: OpenLink, fields: Record<string, string> = {}, requestOrigin: string | null = origin,
  cookie = link.cookie, site = 'same-origin',
) {
  const headers = new Headers({
    'sec-fetch-site': site,
    cookie: `${EMAIL_LINK_COOKIE}=${cookie}; ${authCookie}.0=old-session`,
  });
  if (requestOrigin !== null) headers.set('origin', requestOrigin);
  return redeem(new NextRequest(new URL('/auth/confirm-email/redeem', origin), {
    method: 'POST', headers, body: new URLSearchParams({
      confirmation: link.confirmation, purpose: link.purpose, decision: 'confirm', email, ...fields,
    }),
  }));
}

describe('email-link account confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ACADEMY_BACKEND', 'supabase');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'supabase');
    vi.stubEnv('SUPABASE_GATEWAY_KEY', '');
    vi.stubGlobal('fetch', provider);
    serveGrant();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it.each(['magiclink', 'signup', 'invite', 'email', 'email_change', 'recovery'])('stages %s without contacting the provider or changing a session', async (type) => {
    const { response, page, cookie } = await openLink(type, { email: 'ignored@example.test' });
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get(EMAIL_LINK_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('location')).not.toContain(tokenHash);
    expect(page).toContain(type === 'recovery' ? 'Confirm and choose a new password' : 'Confirm and sign in');
    expect(page).toContain('replaces any current sign-in');
    for (const sensitive of [tokenHash, cookie, 'ignored@example.test']) expect(page).not.toContain(sensitive);
    expect(provider).not.toHaveBeenCalled();
    expect(mocks.supabaseUser).not.toHaveBeenCalled();
  });

  it.each(['magiclink', 'recovery'])('installs the intended %s session only on confirmation and keeps the grant single-use', async (type) => {
    const link = await openLink(type);
    const response = await submit(link, { email: email.toUpperCase() });
    const location = new URL(response.headers.get('location')!);
    if (type === 'recovery') {
      expect(location.origin + location.pathname).toBe(origin + '/reset-password');
      expect(response.cookies.get(recoveryCookieName(location.searchParams.get('recovery')!))).toMatchObject({ httpOnly: true, maxAge: 600 });
    } else {
      expect(location.href).toBe(origin + '/profile?tab=skills');
    }
    expect(response.cookies.get(authCookie)?.value).toBeTruthy();
    expect(response.cookies.get(authCookie + '.0')?.maxAge).toBe(0);
    const again = await submit(link);
    expect(again.headers.get('location')).toContain('error=expired');
    expect(again.cookies.getAll()).toHaveLength(0);
  });

  it.each(['magiclink', 'recovery'])('keeps the previous browser session if the %s identity differs', async (type) => {
    const link = await openLink(type, { email: 'different@example.test' });
    const response = await submit(link, { email: 'different@example.test' });
    expect(response.headers.get('location')).toContain('result=account');
    expect(response.cookies.getAll()).toHaveLength(0);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(['/auth/callback', '/auth/recovery'])('keeps the SDK PKCE verifier requirement on %s without falling back to an email grant', async (path) => {
    const client = createServerClient('https://project.example', 'fixture-anon', {
      cookies: { getAll: () => [], setAll: vi.fn() },
    });
    mocks.supabaseUser.mockResolvedValue(client);
    const handler = path === '/auth/recovery' ? recoveryCallback : callback;
    const response = await handler(new Request(origin + path + '?code=fixture-code&token_hash=fixture-email-grant&type=recovery'));
    expect(response.headers.get('location')).toContain('error=');
    expect(response.cookies.getAll()).toHaveLength(0);
    expect(provider).not.toHaveBeenCalled();
  });

  it('requires the same origin and current form before accepting a decision', async () => {
    const link = await openLink();
    const other = await openLink();
    for (const res of [
      await submit(link, {}, null), await submit(link, {}, 'https://other.example'),
      await submit(link, {}, origin, link.cookie, 'same-site'),
    ]) expect(res.status).toBe(403);
    for (const cookie of ['', 'invalid', other.cookie]) {
      const response = await submit(link, {}, origin, cookie);
      expect(response.headers.get('location')).toContain('error=expired');
      expect(response.cookies.getAll()).toHaveLength(0);
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it('honors cancellation, rejects an invalid email and expires unsubmitted confirmation pages', async () => {
    const link = await openLink('recovery');
    expect((await submit(link, { decision: 'cancel', email: '' })).headers.get('location')).toBe(origin + '/forgot-password');
    expect((await submit(link, { email: '' })).headers.get('location')).toContain('error=email');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 601_000);
    expect((await submit(link)).headers.get('location')).toBe(origin + '/forgot-password?error=expired');
    expect(provider).not.toHaveBeenCalled();
  });

  it('preserves onboarding, validated popup completion and a partial secure email change', async () => {
    serveGrant({ profileName: '' });
    const signup = await submit(await openLink('signup'));
    expect(signup.headers.get('location')).toBe(origin + '/welcome?next=%2Fprofile%3Ftab%3Dskills');
    serveGrant();
    const attempt = 'a'.repeat(48);
    mocks.popup.mockResolvedValue(attempt);
    const popup = await submit(await openLink('magiclink', { popup_state: 'local-state' }));
    expect(popup.headers.get('location')).toBe(origin + '/auth/popup?attempt=' + attempt + '&status=success');
    serveGrant({ noSession: true });
    const partial = await submit(await openLink('email_change'));
    expect(partial.headers.get('location')).toBe(origin + '/auth/confirm-email?result=email-change');
    expect(partial.cookies.getAll()).toHaveLength(0);
  });
});

// An ordinary Auth fixture. getUser controls which provider identity owns each token.
function sessionToken(account: string, session: string, generation = 1) {
  const claims = Buffer.from(JSON.stringify({ sub: account, session_id: session, iat: generation })).toString('base64url');
  return ['local-header', claims, 'local-signature'].join('.');
}

function currentSession(token: string, verifiedUserId: string) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: verifiedUserId } }, error: null });
  mocks.supabaseUser.mockResolvedValue({ auth: {
    getSession: async () => ({ data: { session: { access_token: token } }, error: null }), getUser,
  } });
  return getUser;
}

async function recover(mode: 'email' | 'pkce', token: string) {
  serveGrant({ accessToken: token });
  mocks.supabaseUser.mockResolvedValue({ auth: { exchangeCodeForSession: async () => ({
    data: { redirectType: 'PASSWORD_RECOVERY', session: { access_token: token, user: { id: 'learner-id' } } }, error: null,
  }) } });
  const response = mode === 'email'
    ? await submit(await openLink('recovery'))
    : await recoveryCallback(new Request(origin + '/auth/recovery?code=local-pkce-code'));
  const attempt = new URL(response.headers.get('location')!).searchParams.get('recovery')!;
  return { attempt, cookie: response.cookies.get(recoveryCookieName(attempt))!.value };
}

function changePassword(form: { attempt: string; cookie: string }, options: { cookieAttempt?: string; origin?: string } = {}) {
  return updatePassword(new NextRequest(origin + '/auth/recovery', {
    method: 'POST', headers: {
      origin: options.origin ?? origin, 'content-type': 'application/json',
      cookie: recoveryCookieName(options.cookieAttempt ?? form.attempt) + '=' + form.cookie,
    }, body: JSON.stringify({ attempt: form.attempt, password: 'local-test-password' }),
  }));
}

describe('recovery password mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ACADEMY_BACKEND', 'supabase');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'supabase');
    vi.stubEnv('SUPABASE_GATEWAY_KEY', '');
    vi.stubGlobal('fetch', provider);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it.each(['email', 'pkce'] as const)('allows the verified %s recovery session to change its own password after a token refresh', async mode => {
    const first = sessionToken('learner-id', 'recovered-session');
    const refreshed = sessionToken('learner-id', 'recovered-session', 2);
    const form = await recover(mode, first);
    const check = currentSession(refreshed, 'learner-id');
    provider.mockReset().mockResolvedValue(Response.json({ id: 'learner-id' }));
    const response = await changePassword(form);
    expect(check).toHaveBeenCalledWith(refreshed);
    expect(provider).toHaveBeenCalledOnce();
    const [url, request] = provider.mock.calls[0];
    expect(String(url)).toBe('https://project.example/auth/v1/user');
    expect(request?.method).toBe('PUT');
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer ' + refreshed);
    expect(JSON.parse(String(request?.body))).toEqual({ password: 'local-test-password' });
    expect(response.status).toBe(204);
    expect(response.cookies.get(recoveryCookieName(form.attempt))?.maxAge).toBe(0);
  });

  it.each(['email', 'pkce'] as const)('leaves both accounts untouched if the browser changes identities after %s recovery', async mode => {
    const form = await recover(mode, sessionToken('learner-id', 'recovered-session'));
    provider.mockClear();
    currentSession(sessionToken('other-user', 'other-session'), 'other-user');
    expect((await changePassword(form)).status).toBe(410);
    currentSession(sessionToken('learner-id', 'separate-sign-in'), 'learner-id');
    expect((await changePassword(form)).status).toBe(410);
    expect(provider).not.toHaveBeenCalled();
  });

  it('requires the same recovery form, origin, and unexpired receipt', async () => {
    const token = sessionToken('learner-id', 'recovered-session');
    const first = await recover('email', token);
    const second = await recover('pkce', token);
    currentSession(token, 'learner-id');
    provider.mockClear();
    expect((await changePassword(first, { cookieAttempt: second.attempt })).status).toBe(410);
    expect((await changePassword({ ...first, cookie: second.cookie })).status).toBe(410);
    expect((await changePassword(first, { origin: 'https://other.example' })).status).toBe(403);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 601_000);
    expect((await changePassword(first)).status).toBe(410);
    expect(provider).not.toHaveBeenCalled();
  });

  it('requires a recovery PKCE initiation before issuing a password form', async () => {
    mocks.supabaseUser.mockResolvedValue({ auth: { exchangeCodeForSession: async () => ({
      data: { redirectType: null, session: { user: { id: 'learner-id' }, access_token: 'regular-sign-in' } }, error: null,
    }) } });
    const response = await recoveryCallback(new Request(origin + '/auth/recovery?code=local-pkce-code'));
    expect(response.headers.get('location')).toBe(origin + '/forgot-password?error=expired');
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it('accepts the actual PKCE recovery marker written by the installed SDK', async () => {
    const cookieJar = new Map<string, string>();
    const sdk = createServerClient('https://project.example', 'fixture-anon', {
      cookies: {
        getAll: () => Array.from(cookieJar, ([name, value]) => ({ name, value })),
        setAll: updates => { for (const { name, value } of updates) cookieJar.set(name, value); },
      },
    });
    provider.mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/auth/v1/recover') return Response.json({});
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
        expect(JSON.parse(String(init?.body)).code_verifier).toBeTruthy();
        return Response.json({
          access_token: 'local-pkce-access', refresh_token: 'local-pkce-refresh', token_type: 'bearer',
          expires_in: 3600, user: { id: 'learner-id', email },
        });
      }
      throw new Error('Unexpected fixture request');
    });
    expect((await sdk.auth.resetPasswordForEmail(email, { redirectTo: origin + '/auth/recovery' })).error).toBeNull();
    mocks.supabaseUser.mockResolvedValue(sdk);
    const response = await recoveryCallback(new Request(origin + '/auth/recovery?code=local-pkce-code'));
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/reset-password');
    expect(response.cookies.get(recoveryCookieName(location.searchParams.get('recovery')!))?.httpOnly).toBe(true);
  });
});
