// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  supabaseUser: vi.fn(),
  supabaseBrowser: vi.fn(),
  searchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/navigation', () => ({ useSearchParams: mocks.searchParams }));
vi.mock('@/lib/post-auth-navigation', () => ({ navigateAfterAuth: mocks.navigate }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: mocks.supabaseBrowser }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://academy.example' } }));

import { AuthForm } from '@/components/AuthForm';
import { ForgotPasswordForm, RESET_REQUEST_COOLDOWN_MS } from '@/components/ForgotPasswordForm';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';
import { GET as recovery } from '@/app/auth/recovery/route';
import { routes } from '@/lib/routes';

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
}

function recoveryClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      ...(overrides.auth as Record<string, unknown> | undefined),
    },
  };
}

describe('password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    cleanup();
  });

  it('exposes path-only recovery routes', () => {
    expect(routes.auth.forgotPassword()).toBe('/forgot-password');
    expect(routes.auth.resetPassword()).toBe('/reset-password');
    expect(routes.auth.recovery()).toBe('/auth/recovery');
    expect(routes.auth.forgotPassword({ error: 'expired' })).toBe('/forgot-password?error=expired');
  });

  it('offers a forgot-password link from login but not from signup', () => {
    mocks.supabaseBrowser.mockReturnValue(recoveryClient());

    render(<Provider><AuthForm mode="login" /></Provider>);
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password');

    cleanup();
    render(<Provider><AuthForm mode="signup" /></Provider>);
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).toBeNull();
  });

  it('rejects an invalid email before requesting a recovery email', async () => {
    const client = recoveryClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ForgotPasswordForm /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('requests a recovery email pointing at the absolute recovery route and applies a cooldown', async () => {
    const client = recoveryClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ForgotPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    const cooldown = vi.spyOn(window, 'setTimeout');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('learner@example.com', {
      redirectTo: `${window.location.origin}/auth/recovery`,
    });
    expect(screen.getByRole('status')).toHaveTextContent('If an account uses that email, a reset link is on its way.');
    expect(cooldown).toHaveBeenCalledWith(expect.any(Function), RESET_REQUEST_COOLDOWN_MS);
    expect(RESET_REQUEST_COOLDOWN_MS).toBe(3000);
  });

  it('reports the same neutral confirmation for an unknown address', async () => {
    const client = recoveryClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ForgotPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(screen.getByRole('status')).toHaveTextContent('If an account uses that email, a reset link is on its way.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a retryable error when the recovery request itself fails', async () => {
    const client = recoveryClient({ auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: new Error('rate limited') }) } });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ForgotPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not complete that request. Please try again.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains an expired recovery link on the request form', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('error=expired'));
    mocks.supabaseBrowser.mockReturnValue(recoveryClient());

    render(<Provider><ForgotPasswordForm /></Provider>);
    expect(screen.getByRole('alert')).toHaveTextContent('This reset link has expired or was already used.');
  });

  it('exchanges a recovery code and sends the visitor to the canonical reset page', async () => {
    vi.stubEnv('AUTH_REDIRECT_ORIGINS', 'https://vfuture-demo.an.net.vn');
    const client = recoveryClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await recovery(new Request('https://vfuture-demo.an.net.vn/auth/recovery?code=pkce'));

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://vfuture-demo.an.net.vn/reset-password');
  });

  it('verifies a server-readable recovery token hash from the email template', async () => {
    const client = recoveryClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await recovery(new Request('https://academy.example/auth/recovery?token_hash=hashed-token&type=recovery'));

    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hashed-token', type: 'recovery' });
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://academy.example/reset-password');
  });

  it.each([
    ['missing code', new Request('https://attacker.example/auth/recovery'), recoveryClient()],
    ['a failed exchange', new Request('https://attacker.example/auth/recovery?code=pkce'), recoveryClient({ auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error('otp_expired') }) } })],
    ['a provider error', new Request('https://attacker.example/auth/recovery?error_code=otp_expired', { headers: { 'x-forwarded-host': 'also-attacker.example' } }), recoveryClient()],
  ])('redirects %s back to the canonical recovery request form', async (_case, request, client) => {
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await recovery(request);

    expect(response.headers.get('location')).toBe('https://academy.example/forgot-password?error=expired');
  });

  it('rejects a short or mismatched new password before calling Supabase', async () => {
    const client = recoveryClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ResetPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Use a password with at least 8 characters.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery stapler');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();

    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password and continues into the learner app', async () => {
    const client = recoveryClient();
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ResetPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('New password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'correct horse battery staple' });
    expect(mocks.navigate).toHaveBeenCalledWith('/app');
  });

  it('distinguishes a consumed recovery session from a retryable update failure', async () => {
    const client = recoveryClient({ auth: { updateUser: vi.fn().mockResolvedValue({ error: new AuthSessionMissingError() }) } });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ResetPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('New password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your reset link is no longer valid. Request a new link and try again.');
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps a failed password update retryable', async () => {
    const client = recoveryClient({ auth: { updateUser: vi.fn().mockResolvedValue({ error: new Error('weak password') }) } });
    mocks.supabaseBrowser.mockReturnValue(client);
    const user = userEvent.setup();

    render(<Provider><ResetPasswordForm /></Provider>);
    await user.type(screen.getByLabelText('New password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your password could not be updated. Please try again.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
