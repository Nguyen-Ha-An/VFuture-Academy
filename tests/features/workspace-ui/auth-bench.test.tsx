// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({}) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: vi.fn() }));

import AuthLayout from '@/app/(auth)/layout';
import LoginPage from '@/app/(auth)/login/page';
import SignupPage from '@/app/(auth)/signup/page';
import { EntranceShell } from '@/features/workspace-ui/auth/EntranceShell';

const messages = withBenchMessages(en, 'en');
afterEach(cleanup);

it('uses the shared entrance shell regardless of the old rollout flag', () => {
  expect((AuthLayout({ children: <p>child</p> }) as { type: unknown }).type).toBe(EntranceShell);
});

it.each([['login', LoginPage], ['signup', SignupPage]])('renders %s with a single main and shared legal links', async (_name, Page) => {
  const shell = await EntranceShell({ children: Page() });
  render(<NextIntlClientProvider locale="en" messages={messages}>{shell}</NextIntlClientProvider>);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy?lang=en');
  expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms?lang=en');
});
