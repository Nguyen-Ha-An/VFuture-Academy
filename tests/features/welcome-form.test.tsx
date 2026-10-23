// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { initialOnboardingState, type OnboardingState } from '@/features/auth/onboarding-state';

const mocks = vi.hoisted(() => ({ completeOnboarding: vi.fn() }));
vi.mock('@/features/auth/onboarding-actions', () => ({ completeOnboarding: mocks.completeOnboarding }));
import { WelcomeForm } from '@/components/WelcomeForm';

function setup(next = '/app/profile?tab=skills', locale: 'en' | 'vi' = 'en') {
  const messages = locale === 'en' ? en : viMessages;
  render(<NextIntlClientProvider locale={locale} messages={messages}><WelcomeForm next={next} /></NextIntlClientProvider>);
  return { user: userEvent.setup(), copy: messages.auth };
}

async function fillProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en.auth.handle), 'future_builder');
  await user.type(screen.getByLabelText(en.auth.displayName), 'Future Builder');
}

function failure(error: OnboardingState['error'] = null, fieldErrors: OnboardingState['fieldErrors'] = {}): OnboardingState {
  return { values: { handle: 'future_builder', displayName: 'Future Builder' }, fieldErrors, error };
}

describe('onboarding form', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.completeOnboarding.mockResolvedValue(initialOnboardingState); });
  afterEach(cleanup);

  it('submits profile fields and the requested destination without a client-selected user ID', async () => {
    const { user } = setup();
    await fillProfile(user);
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1);
    const data = mocks.completeOnboarding.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data)).toEqual({ handle: 'future_builder', displayName: 'Future Builder', next: '/app/profile?tab=skills' });
    expect(screen.queryByLabelText(/branch/i)).not.toBeInTheDocument();
  });

  it('keeps a duplicate handle failure attached to the populated handle field', async () => {
    mocks.completeOnboarding.mockResolvedValue(failure(null, { handle: 'handleTaken' }));
    const { user } = setup();
    await fillProfile(user);
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect(await screen.findByText(en.auth.handleTaken)).toHaveAttribute('id', 'handle-error');
    expect(screen.getByLabelText(en.auth.handle)).toHaveFocus();
    expect(screen.getByLabelText(en.auth.handle)).toHaveValue('future_builder');
    expect(screen.getByLabelText(en.auth.displayName)).toHaveValue('Future Builder');
    await user.clear(screen.getByLabelText(en.auth.handle));
    await user.type(screen.getByLabelText(en.auth.handle), 'available_builder');
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect((mocks.completeOnboarding.mock.calls[1][1] as FormData).get('handle')).toBe('available_builder');
  });

  it.each(['profileUpdateError', 'profileLoadError'] as const)('preserves values after %s so the user can retry', async error => {
    mocks.completeOnboarding.mockResolvedValue(failure(error));
    const { user } = setup();
    await fillProfile(user);
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth[error]);
    expect(screen.getByLabelText(en.auth.handle)).toHaveValue('future_builder');
    expect(screen.getByLabelText(en.auth.displayName)).toHaveValue('Future Builder');
    expect(screen.getByRole('button', { name: en.auth.continue })).toBeEnabled();
  });

  it('focuses the name when the action returns a display-name validation error', async () => {
    mocks.completeOnboarding.mockResolvedValue(failure(null, { displayName: 'invalidDisplayName' }));
    const { user } = setup();
    await user.type(screen.getByLabelText(en.auth.handle), 'future_builder');
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.invalidDisplayName);
    expect(screen.getByLabelText(en.auth.displayName)).toHaveFocus();
  });

  it('keeps pending submissions disabled until the action finishes', async () => {
    let finish!: (state: OnboardingState) => void;
    mocks.completeOnboarding.mockReturnValue(new Promise<OnboardingState>(resolve => { finish = resolve; }));
    const { user } = setup();
    await fillProfile(user);
    await user.dblClick(screen.getByRole('button', { name: en.auth.continue }));
    expect(screen.getByRole('button', { name: 'Continuing…' })).toBeDisabled();
    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1);
    await act(async () => { finish(failure('profileUpdateError')); });
    await waitFor(() => expect(screen.getByRole('button', { name: en.auth.continue })).toBeEnabled());
    expect(screen.getByLabelText(en.auth.handle)).toHaveValue('future_builder');
  });

  it('uses the safe default for a hostile return URL', async () => {
    const { user } = setup('//attacker.example');
    await fillProfile(user);
    await user.click(screen.getByRole('button', { name: en.auth.continue }));
    expect((mocks.completeOnboarding.mock.calls[0][1] as FormData).get('next')).toBe('/app');
  });

  it('renders action errors in Vietnamese', async () => {
    mocks.completeOnboarding.mockResolvedValue(failure(null, { handle: 'handleTaken' }));
    const { user, copy } = setup('/app', 'vi');
    await user.type(screen.getByLabelText(copy.handle), 'future_builder');
    await user.type(screen.getByLabelText(copy.displayName), 'Nguyễn An');
    await user.click(screen.getByRole('button', { name: copy.continue }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.handleTaken);
    expect(screen.getByLabelText(copy.displayName)).toHaveValue('Nguyễn An');
  });
});
