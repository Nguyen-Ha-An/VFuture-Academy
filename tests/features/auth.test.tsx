// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  replace: vi.fn(),
  navigate: vi.fn(),
  push: vi.fn(),
  supabaseUser: vi.fn(),
  supabaseBrowser: vi.fn(),
  searchParams: vi.fn(() => new URLSearchParams()),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: mocks.searchParams,
}));
vi.mock('@/lib/post-auth-navigation', () => ({ navigateAfterAuth: mocks.navigate }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: mocks.supabaseBrowser }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://academy.example' } }));

import { getSessionUser, requireApiUser, requireUser } from '@/lib/auth';
import { AuthForm, LOGIN_COOLDOWN_MS, PROFILE_STATE_TIMEOUT_MS } from '@/components/AuthForm';
import { GET as callback } from '@/app/auth/callback/route';
import { POST as signout } from '@/app/auth/signout/route';
import { profileState } from '@/lib/profile-state';

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={withBenchMessages(en, 'en')}>{children}</NextIntlClientProvider>;
}

function authenticatedClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'learner@example.com' } }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { handle: 'learner' }, error: null }) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'user-1', handle: 'future_builder' }, error: null }) })) })) })),
    })),
    ...overrides,
  };
}

function profileStateResponse(state: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ data: { state } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** AuthForm learns the destination from the authenticated same-origin endpoint, not a browser REST read. */
function stubProfileState(respond: () => Response | Promise<Response>) {
  mocks.fetch.mockReset().mockImplementation(async () => respond());
}

async function signInAsLearner(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'learner@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('authentication and onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams.mockReturnValue(new URLSearchParams());
    stubProfileState(() => profileStateResponse('complete'));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it('returns the verified cookie-bound user and redirects missing sessions to login', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    await expect(getSessionUser()).resolves.toMatchObject({ id: 'user-1' });

    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toThrow('redirect:/login?next=%2Fapp');
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fapp');
  });

  it('throws an API-safe 401 instead of redirecting a missing session', async () => {
    const client = authenticatedClient();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.supabaseUser.mockResolvedValue(client);

    await expect(requireApiUser()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('treats AuthSessionMissingError as an anonymous session', async () => {
    const client = authenticatedClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    mocks.supabaseUser.mockResolvedValue(client);

    await expect(getSessionUser()).resolves.toBeNull();
  });

  it('propagates non-session authentication failures with a generic error', async () => {
    const client = authenticatedClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('token=private-value'),
    });
    mocks.supabaseUser.mockResolvedValue(client);

    await expect(getSessionUser()).rejects.toThrow('Unable to authenticate user');
    await expect(getSessionUser()).rejects.not.toThrow('private-value');
  });

  it('exchanges PKCE codes and rejects external callback destinations', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://academy.example/auth/callback?code=pkce&next=https://evil.example'));

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce');
    expect(response.headers.get('location')).toBe('https://academy.example/app');
  });

  it('verifies server-readable magic-link token hashes from email templates', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://academy.example/auth/callback?token_hash=hashed-token&type=magiclink'));

    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hashed-token', type: 'magiclink' });
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://academy.example/app');
  });

  it('keeps the callback on the origin that received the host-bound session cookies', async () => {
    vi.stubEnv('AUTH_REDIRECT_ORIGINS', 'https://vfuture-demo.an.net.vn');
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://vfuture-demo.an.net.vn/auth/callback?code=pkce&next=/profile', { headers: { 'x-forwarded-host': 'also-attacker.example' } }));

    expect(response.headers.get('location')).toBe('https://vfuture-demo.an.net.vn/profile');
  });

  it('ignores a forged forwarded host when choosing the callback origin', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://academy.example/auth/callback?code=pkce&next=/profile', {
      headers: { 'x-forwarded-host': 'attacker.example' },
    }));

    expect(response.headers.get('location')).toBe('https://academy.example/profile');
  });

  it('rejects same-origin paths outside the authenticated destination allow-list', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://academy.example/auth/callback?code=pkce&next=/api/v1/profile'));

    expect(response.headers.get('location')).toBe('https://academy.example/app');
  });

  it('sends incomplete profiles to the one-time welcome screen after PKCE exchange', async () => {
    const client = authenticatedClient({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { handle: null }, error: null }) })) })),
      })),
    });
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request('https://academy.example/auth/callback?code=pkce&next=/profile'));

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce');
    expect(response.headers.get('location')).toBe('https://academy.example/welcome?next=%2Fprofile');
  });

  it.each([
    ['missing code', new Request('https://attacker.example/auth/callback'), authenticatedClient()],
    ['exchange failure', new Request('https://attacker.example/auth/callback?code=pkce'), authenticatedClient({ auth: { ...authenticatedClient().auth, exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error('failed') }) } })],
    ['missing verified user', new Request('https://attacker.example/auth/callback?code=pkce'), authenticatedClient({ auth: { ...authenticatedClient().auth, getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } })],
  ])('redirects %s to the canonical generic login error', async (_case, request, client) => {
    mocks.supabaseUser.mockResolvedValue(client);
    const response = await callback(request);
    expect(response.headers.get('location')).toBe('https://academy.example/login?error=provider&next=%2Fapp');
  });

  it('treats missing or failed profile reads as a retryable auth failure rather than onboarding', async () => {
    expect(profileState({ data: null, error: null })).toBe('unavailable');
    expect(profileState({ data: null, error: new Error('RLS') })).toBe('unavailable');
    expect(profileState({ data: { handle: null }, error: null })).toBe('incomplete');
    expect(profileState({ data: { handle: 'learner' }, error: null })).toBe('complete');
  });

  it('signs out through the cookie-bound client and returns to login', async () => {
    const client = authenticatedClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await signout(new Request('https://attacker.example/auth/signout', { method: 'POST', headers: { 'x-forwarded-host': 'also-attacker.example' } }));

    expect(client.auth.signOut).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe('https://academy.example/login');
  });

  it('validates email credentials, omits branch selection, and applies a three-second submit cooldown', async () => {
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/branch/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    const cooldown = vi.spyOn(window, 'setTimeout');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'learner@example.com', password: 'correct horse battery staple' });
    expect(mocks.navigate).toHaveBeenCalledWith('/app');
    expect(cooldown).toHaveBeenCalledWith(expect.any(Function), LOGIN_COOLDOWN_MS);
    expect(LOGIN_COOLDOWN_MS).toBe(3000);
  });

  it('keeps the cooldown active after a slow sign-in attempt completes', async () => {
    let finishSignIn: ((value: { error: null }) => void) | undefined;
    const client = authenticatedClient();
    client.auth.signInWithPassword.mockReturnValue(new Promise((resolve) => {
      finishSignIn = resolve;
    }));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    const timerCallbacks: Array<() => void> = [];
    vi.spyOn(window, 'setTimeout').mockImplementation((handler) => {
      timerCallbacks.push(() => handler(undefined));
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => { await Promise.resolve(); });
    expect(client.auth.signInWithPassword).toHaveBeenCalledOnce();

    act(() => timerCallbacks.forEach((callback) => callback()));
    await act(async () => {
      finishSignIn?.({ error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('maps callback errors to a generic live alert and attaches validation errors to their own fields', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('error=auth'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be completed. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(email).toHaveAttribute('aria-errormessage', 'auth-email-error');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-errormessage', 'auth-password-error');
    expect(password).not.toHaveAttribute('aria-describedby', 'auth-email-error');
    await waitFor(() => expect(document.activeElement).toBe(email));
  });

  it('shows a generic retryable error instead of routing to welcome when the post-login profile state is unavailable', async () => {
    const client = authenticatedClient();
    stubProfileState(() => profileStateResponse('unavailable'));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile could not be loaded. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'login', bench: false, provider: 'google', label: 'Continue with Google' },
    { mode: 'signup', bench: false, provider: 'google', label: 'Continue with Google' },
    { mode: 'login', bench: true, provider: 'google', label: 'Continue with Google' },
    { mode: 'signup', bench: true, provider: 'google', label: 'Continue with Google' },
    { mode: 'login', bench: false, provider: 'azure', label: 'Continue with Microsoft' },
    { mode: 'signup', bench: false, provider: 'azure', label: 'Continue with Microsoft' },
    { mode: 'login', bench: true, provider: 'azure', label: 'Continue with Microsoft' },
    { mode: 'signup', bench: true, provider: 'azure', label: 'Continue with Microsoft' },
  ] as const)('starts $provider $mode with the PKCE destination (bench: $bench)', async ({ mode, bench, provider, label }) => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprofile%3Ftab%3Dskills'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode={mode} bench={bench} /></Provider>);
    await user.click(screen.getByRole('button', { name: label }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=%2Fapp%2Fprofile%3Ftab%3Dskills`,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
  });

  it('rejects an external next path before starting Microsoft sign-in', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=https%3A%2F%2Fevil.example%2Fsteal'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Continue with Microsoft' }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fapp`, scopes: 'email' },
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(['returned', 'thrown'] as const)('shows a retryable provider error for a %s Microsoft failure without exposing details', async (failure) => {
    const client = authenticatedClient();
    if (failure === 'returned') client.auth.signInWithOAuth.mockResolvedValue({ error: new Error('private-provider-detail') });
    else client.auth.signInWithOAuth.mockRejectedValue(new Error('private-provider-detail'));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Continue with Microsoft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not be completed. Please try again.');
    expect(screen.queryByText(/private-provider-detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('blocks other sign-in methods while Microsoft sign-in is pending', async () => {
    let finish: ((value: { error: null }) => void) | undefined;
    const client = authenticatedClient();
    client.auth.signInWithOAuth.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Continue with Microsoft' }));

    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(client.auth.signInWithOAuth).toHaveBeenCalledOnce();

    await act(async () => { finish?.({ error: null }); });
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeEnabled();
  });

  it('sends existing users a magic sign-in link that preserves the requested destination', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprofile%3Ftab%3Dskills'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'learner@example.com',
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fapp%2Fprofile%3Ftab%3Dskills`,
        shouldCreateUser: false,
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Check your email for a sign-in link.');
  });

  it('preserves a query-bearing next path through password sign-in and login/signup cross-links', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprofile%3Ftab%3Dskills'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup?next=%2Fapp%2Fprofile%3Ftab%3Dskills');
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/app/profile?tab=skills');
  });

  it('preserves the same next path when password sign-in requires onboarding', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprofile%3Ftab%3Dskills'));
    const client = authenticatedClient();
    stubProfileState(() => profileStateResponse('incomplete'));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/welcome?next=%2Fapp%2Fprofile%3Ftab%3Dskills');
  });

  it('falls back from unsafe next values before constructing links or redirects', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=https%3A%2F%2Fevil.example%2Fsteal'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup?next=%2Fapp');
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/app');
  });

  it('carries next through signup confirmation and the signup/login cross-link', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fcourses%2Fai-foundations%3Fintent%3Denroll'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="signup" /></Provider>);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fcourses%2Fai-foundations%3Fintent%3Denroll');
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'correct horse battery staple',
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fcourses%2Fai-foundations%3Fintent%3Denroll` },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Check your email to confirm your account');
  });

  it('continues an immediate signup session into onboarding with next intact', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprojects%3Fstatus%3Dopen'));
    const client = authenticatedClient({
      auth: {
        ...authenticatedClient().auth,
        signUp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'session' }, user: { id: 'user-1' } }, error: null }),
      },
    });
    stubProfileState(() => profileStateResponse('incomplete'));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="signup" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/welcome?next=%2Fapp%2Fprojects%3Fstatus%3Dopen');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['cancelled', 'Sign-in was cancelled. You can try again.'],
    ['expired', 'This confirmation link has expired. Request a new link and try again.'],
    ['provider', 'Sign-in could not be completed. Please try again.'],
    ['profile', 'Your profile could not be loaded. Please try again.'],
  ])('shows a distinct %s callback failure', (reason, message) => {
    mocks.searchParams.mockReturnValue(new URLSearchParams(`error=${reason}&next=%2Fapp`));
    render(<Provider><AuthForm mode="login" /></Provider>);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('shows invalid credentials separately from provider and profile failures', async () => {
    const client = authenticatedClient();
    client.auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.');
  });

  it('reads the post-login profile state from the same-origin endpoint and never queries profiles from the browser', async () => {
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await signInAsLearner(user);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/app'));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/profile-state');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('continues an immediate signup session with the endpoint state and no browser profile query', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprojects%3Fstatus%3Dopen'));
    const client = authenticatedClient({
      auth: {
        ...authenticatedClient().auth,
        signUp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'session' }, user: { id: 'user-1' } }, error: null }),
      },
    });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="signup" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/app/projects?status=open'));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ['an unauthenticated response', () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), { status: 401, headers: { 'content-type': 'application/json' } })],
    ['a server error', () => new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal error' } }), { status: 500, headers: { 'content-type': 'application/json' } })],
    ['a gateway error page', () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })],
    ['a malformed JSON body', () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['a body without a state', () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['an unknown state', () => profileStateResponse('suspended')],
    ['a non-object body', () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('shows the retryable profile error instead of navigating after %s', async (_case, respond) => {
    const client = authenticatedClient();
    stubProfileState(respond);
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await signInAsLearner(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile could not be loaded. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows the retryable profile error when the profile-state request fails at the network', async () => {
    const client = authenticatedClient();
    mocks.fetch.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await signInAsLearner(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile could not be loaded. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('aborts a hung profile-state request after the bounded timeout and reports the profile error', async () => {
    const client = authenticatedClient();
    mocks.fetch.mockReset().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    const realSetTimeout = window.setTimeout.bind(window);
    let fireTimeout: (() => void) | undefined;
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === PROFILE_STATE_TIMEOUT_MS) {
        fireTimeout = () => (handler as () => void)();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(fireTimeout).toBeDefined());
    expect(PROFILE_STATE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(PROFILE_STATE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => fireTimeout?.());

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile could not be loaded. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

});
