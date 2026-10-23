// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileSettings } from '@/features/learner/ui/ProfileSettings';
import en from '@/messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderAccount = () => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <ProfileSettings displayName="Future Builder" locale="en" initialAvatarUrl={null} />
  </NextIntlClientProvider>,
);

describe('profile account card', () => {
  it('renders the account as one card with vf-label labels and a vf-btn upload control', () => {
    const { container } = renderAccount();

    const card = screen.getByRole('region', { name: 'Account' });
    expect(card).toHaveClass('vf-card');
    expect(container.querySelector('.vf-card .vf-card')).toBeNull();
    expect(screen.getByText(en.learner.profile.displayName)).toHaveClass('vf-label');
    expect(screen.getByText(en.learner.profile.locale)).toHaveClass('vf-label');
    expect(screen.getByText('Future Builder')).toBeVisible();
    expect(screen.getByText(en.learner.profile.changeAvatar).closest('label')).toHaveClass('vf-btn');
  });

  it('reports a failed photo upload in a fault Notice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'X' } }), { status: 400 })));
    const { container } = renderAccount();

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    });

    const notice = (await screen.findByText(en.learner.profile.uploadError)).closest('.vf-notice');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveAttribute('data-tone', 'fault');
  });
});
