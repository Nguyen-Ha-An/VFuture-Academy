// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

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
import { AuthForm, LOGIN_COOLDOWN_MS } from '@/components/AuthForm';
import { GET as callback } from '@/app/auth/callback/route';
import { POST as signout } from '@/app/auth/signout/route';
import { profileState } from '@/lib/profile-state';

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
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

describe('authentication and onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in could not be completed. Please try again.');
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

  it('shows a generic retryable error instead of routing to welcome when the post-login profile read fails', async () => {
    const client = authenticatedClient({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('RLS') }) })) })),
      })),
    });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="login" /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile could not be loaded. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('offers an accessible Google sign-in flow with the PKCE callback destination', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('next=%2Fapp%2Fprofile%3Ftab%3Dskills'));
    const client = authenticatedClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><AuthForm mode="signup" /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fapp%2Fprofile%3Ftab%3Dskills` },
    });
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
    const client = authenticatedClient({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { handle: null }, error: null }) })) })),
      })),
    });
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
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { handle: null }, error: null }) })) })),
      })),
    });
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
    ['cancelled', 'Google sign-in was cancelled. You can try again.'],
    ['expired', 'This confirmation link has expired. Request a new link and try again.'],
    ['provider', 'Google sign-in could not be completed. Please try again.'],
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

});
