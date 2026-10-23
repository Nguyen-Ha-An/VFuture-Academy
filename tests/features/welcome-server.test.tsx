// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
  requireUser: vi.fn(),
  supabaseUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/components/WelcomeForm', () => ({
  WelcomeForm: ({ next }: { next: string }) => (
    <div data-testid="welcome-form" data-next={next} />
  ),
}));

import WelcomePage from '@/app/(auth)/welcome/page';

function profileClient(result: { data: { handle: string | null } | null; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) })),
      })),
    })),
  };
}

describe('welcome page routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
  });

  afterEach(cleanup);

  it('returns an already complete profile to the exact validated destination', async () => {
    mocks.supabaseUser.mockResolvedValue(profileClient({ data: { handle: 'learner' }, error: null }));

    await expect(WelcomePage({
      searchParams: Promise.resolve({ next: '/courses/ai-foundations?enroll=1' }),
    })).rejects.toThrow('redirect:/courses/ai-foundations?enroll=1');

    expect(mocks.requireUser).toHaveBeenCalledWith('/courses/ai-foundations?enroll=1');
  });

  it('passes an incomplete profile and its destination to the onboarding form', async () => {
    mocks.supabaseUser.mockResolvedValue(profileClient({ data: { handle: null }, error: null }));

    render(await WelcomePage({
      searchParams: Promise.resolve({ next: '/app/projects/climate-lab?join=1' }),
    }));

    expect(mocks.requireUser).toHaveBeenCalledWith('/app/projects/climate-lab?join=1');
    expect(screen.getByTestId('welcome-form')).toHaveAttribute(
      'data-next',
      '/app/projects/climate-lab?join=1',
    );
  });

  it('shows a profile-specific retry state without losing next', async () => {
    mocks.supabaseUser.mockResolvedValue(profileClient({ data: null, error: new Error('RLS') }));

    render(await WelcomePage({
      searchParams: Promise.resolve({ next: '/opportunities/summer-lab' }),
    }));

    expect(screen.getByRole('alert')).toHaveTextContent('profileLoadError');
    expect(screen.getByRole('link', { name: 'tryAgain' })).toHaveAttribute(
      'href',
      '/welcome?next=%2Fopportunities%2Fsummer-lab',
    );
  });

  it('maps thrown profile reads to the same retryable state', async () => {
    mocks.supabaseUser.mockRejectedValue(new Error('database unavailable'));

    render(await WelcomePage({
      searchParams: Promise.resolve({ next: '/courses/ai-foundations' }),
    }));

    expect(screen.getByRole('alert')).toHaveTextContent('profileLoadError');
    expect(screen.getByRole('link', { name: 'tryAgain' })).toHaveAttribute(
      'href',
      '/welcome?next=%2Fcourses%2Fai-foundations',
    );
  });
});
