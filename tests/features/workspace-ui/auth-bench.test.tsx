// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { withBenchMessages } from '@/messages/bench';

const messages = withBenchMessages(en, 'en');

const mocks = vi.hoisted(() => ({
  searchParams: vi.fn(() => new URLSearchParams()),
  supabaseBrowser: vi.fn(),
  completeOnboarding: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: mocks.searchParams,
  redirect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: vi.fn(async () => 'dark') }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never })),
}));
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: mocks.supabaseBrowser }));
vi.mock('@/lib/post-auth-navigation', () => ({ navigateAfterAuth: vi.fn() }));
vi.mock('@/features/auth/onboarding-actions', () => ({ completeOnboarding: mocks.completeOnboarding }));

import AuthLayout from '@/app/(auth)/layout';
import LoginPage from '@/app/(auth)/login/page';
import SignupPage from '@/app/(auth)/signup/page';
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page';
import ResetPasswordPage from '@/app/(auth)/reset-password/page';
import { WelcomeForm } from '@/components/WelcomeForm';
import { AuthBenchShell } from '@/features/workspace-ui/auth/AuthBenchShell';
import { AuthMain } from '@/features/workspace-ui/auth/AuthMain';
import { formatIctClock } from '@/features/workspace-ui/auth/LocalClock';
import authCatalog from '@/messages/bench/auth.json';

const bench = messages.bench.auth;

async function renderBench(page: ReactNode) {
  const shell = await AuthBenchShell({ children: page });
  return render(<NextIntlClientProvider locale="en" messages={messages}>{shell}</NextIntlClientProvider>);
}

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

function expectOneMainAndHeading() {
  expect(document.querySelectorAll('main')).toHaveLength(1);
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  expect(document.querySelector('main h1')).not.toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams.mockReturnValue(new URLSearchParams());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  cleanup();
});

describe('auth bench rollout', () => {
  it('returns children untouched and keeps the legacy page markup when the flag is off', () => {
    vi.stubEnv('UI_V2_SURFACES', 'learner');
    const child = <p>child</p>;
    expect(AuthLayout({ children: child })).toBe(child);

    render(<NextIntlClientProvider locale="en" messages={messages}>{LoginPage()}</NextIntlClientProvider>);
    expect(document.querySelector('.vf-workspace')).toBeNull();
    expect(document.querySelector('main')).toHaveClass('flex', 'min-h-screen', 'items-center', 'px-4', 'py-8');
    expect(document.querySelector('section')).toHaveClass('rounded-lg', 'border', 'bg-card');
    expect(screen.queryByText(bench.kicker.login)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy?lang=en');
  });

  it('wraps the auth family in the bench shell when UI_V2_SURFACES lists auth', () => {
    vi.stubEnv('UI_V2_SURFACES', 'learner, auth');
    const layout = AuthLayout({ children: <p>child</p> }) as { type: unknown };
    expect(layout.type).toBe(AuthBenchShell);
  });

  it('keeps bench auth strings in step between Vietnamese and English', () => {
    expect(keysOf(authCatalog.vi).sort()).toEqual(keysOf(authCatalog.en).sort());
    expect(withBenchMessages(vi_, 'vi').bench.auth.side.statement).not.toBe(bench.side.statement);
  });

  it('formats the bench clock in Vietnam time', () => {
    expect(formatIctClock(new Date('2026-09-24T14:14:08Z'))).toBe('21:14:08');
  });
});

describe('bench login', () => {
  beforeEach(() => vi.stubEnv('UI_V2_SURFACES', 'auth'));

  it('renders one main and one h1, with the bench panel as an aside', async () => {
    await renderBench(LoginPage());
    expectOneMainAndHeading();
    expect(document.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    const aside = screen.getByRole('complementary', { name: bench.side.label });
    expect(aside).toHaveClass('vf-auth-side', 'vf-grid-bg');
    expect(within(aside).getByText(bench.side.statement)).toBeInTheDocument();
    expect(within(aside).getByText(bench.side.benchValue)).toBeInTheDocument();
    expect(aside.querySelector('time')?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(aside.querySelector('main')).toBeNull();
    expect(screen.getByRole('main').closest('.vf-auth-panel')).not.toBeNull();
    expect(screen.getByText(bench.kicker.login)).toHaveClass('vf-kicker');
  });

  it('keeps the form contracts and puts the policy and locale links in the footer once', async () => {
    await renderBench(LoginPage());
    const submit = document.querySelector('main form button[type="submit"]');
    expect(submit).toHaveTextContent('Sign in');
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password');
    expect(document.querySelectorAll('a[href^="/signup"]')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Privacy notice' })).not.toBeInTheDocument();

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: bench.foot.privacy })).toHaveAttribute('href', '/privacy?lang=en');
    expect(within(footer).getByRole('link', { name: bench.foot.terms })).toHaveAttribute('href', '/terms?lang=en');
    expect(within(footer).getByRole('navigation', { name: en.common.language })).toBeInTheDocument();
    expect(within(footer).getByText(`${bench.side.bench} · ${bench.side.benchValue}`)).toBeInTheDocument();
  });

  it('keeps the callback alert inside main and marks an expired link in the kicker', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('error=expired'));
    await renderBench(LoginPage());
    expect(document.querySelector('main [role="alert"]')).toHaveTextContent('This confirmation link has expired.');
    expect(screen.getByText(bench.kicker.linkExpired)).toHaveClass('vf-kicker');
  });

  it('shows a pending label and disables the button while signing in', async () => {
    let finish: ((value: { error: null }) => void) | undefined;
    mocks.supabaseBrowser.mockReturnValue({
      auth: {
        signInWithPassword: vi.fn(() => new Promise(resolve => { finish = resolve; })),
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    const user = userEvent.setup();
    await renderBench(LoginPage());
    await user.type(screen.getByLabelText('Email'), 'learner@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: bench.pending.signIn })).toBeDisabled();
    await act(async () => { finish?.({ error: null }); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(document.querySelector('main [role="alert"]')).toBeInTheDocument();
  });

  it.each([
    ['signup', SignupPage, 'Create account', bench.kicker.signup],
    ['forgot-password', ForgotPasswordPage, 'Send reset link', bench.kicker.forgot],
    ['reset-password', ResetPasswordPage, 'Update password', bench.kicker.reset],
  ])('renders %s with one main, one h1 and its submit contract', async (_route, Page, submitLabel, kicker) => {
    await renderBench(Page());
    expectOneMainAndHeading();
    expect(screen.getByRole('complementary', { name: bench.side.label })).toBeInTheDocument();
    expect(document.querySelector('main form button[type="submit"]')).toHaveTextContent(submitLabel);
    expect(screen.getByText(kicker)).toHaveClass('vf-kicker');
  });

  it('renders the welcome form inside the bench panel', async () => {
    await renderBench(<AuthMain bench><WelcomeForm next="/app" bench /></AuthMain>);
    expectOneMainAndHeading();
    expect(document.querySelector('main form button[type="submit"]')).toHaveTextContent(en.auth.continue);
    expect(screen.getByText(bench.kicker.welcome)).toHaveClass('vf-kicker');
  });
});
