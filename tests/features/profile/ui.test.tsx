// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileSettings } from '@/features/profile/ui/ProfileSettings';
import { PublicProfileView } from '@/features/profile/ui/PublicProfileView';
import en from '@/messages/en.json';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile UI', () => {
  it('renders public achievements with verify and project output links', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PublicProfileView locale="en" profile={{
          handle: 'future_builder',
          displayName: 'Future Builder',
          avatarUrl: null,
          branch: { name: 'VinSMC' },
          completedCourses: [{ id: 'course-1', title: { vi: 'Khóa học', en: 'Course one' }, completedAt: '2026-09-01T00:00:00Z' }],
          skills: [{ id: 'ai-literacy', name: 'AI literacy', category: 'ai', level: 'demonstrated', evidenceCount: 3 }],
          certificates: [{ courseId: 'course-1', title: 'Course one', issuedAt: '2026-09-02T00:00:00Z', verificationCode: 'verify-1', href: '/verify/verify-1' }],
          projects: [{ id: 'project-1', title: 'Project one', summary: 'A useful project', outputLinks: [{ url: 'https://example.com/demo', label: 'Live demo' }] }],
        }} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Future Builder' })).toBeVisible();
    expect(screen.getByText('VinSMC')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Verify Course one certificate' })).toHaveAttribute('href', '/verify/verify-1');
    expect(screen.getByRole('link', { name: 'Live demo' }))
      .toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Open Project one' })).toHaveAttribute('href', '/projects/project-1');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Skills', 'Completed courses', 'Showcased projects', 'Certificates']);
  });

  it('provides labelled handle and visibility settings', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProfileSettings initial={{ handle: 'future_builder', displayName: 'Future Builder', profilePublic: false }} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Public handle' })).toHaveValue('future_builder');
    expect(screen.getByRole('checkbox', { name: 'Make my profile public' })).not.toBeChecked();
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2);
  });

  it('renders the public profile settings as one card with vf-label labels and vf-btn buttons', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProfileSettings initial={{ handle: 'future_builder', displayName: 'Future Builder', profilePublic: true }} />
      </NextIntlClientProvider>,
    );

    const card = screen.getByRole('region', { name: 'Public profile settings' });
    expect(card).toHaveClass('vf-card');
    expect(container.querySelector('.vf-card .vf-card')).toBeNull();
    expect(screen.getByText('Public handle')).toHaveClass('vf-label');
    for (const button of screen.getAllByRole('button', { name: 'Save' })) expect(button).toHaveClass('vf-btn', 'vf-btn-primary');
    expect(container.querySelector('[class*="rounded-md"]')).toBeNull();
  });

  it('confirms a saved handle with a Notice and broadcasts it to the profile head', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const saved = vi.fn();
    window.addEventListener('profile-handle-saved', saved);
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProfileSettings initial={{ handle: 'future_builder', displayName: 'Future Builder', profilePublic: false }} />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    const notice = (await screen.findByText('Saved.')).closest('.vf-notice');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveAttribute('data-tone', 'signal');
    // The status Notice mounts inside a persistent polite region, so its insertion is announced.
    expect(notice?.parentElement).toHaveAttribute('id', 'profile-handle-status');
    expect(notice?.parentElement).toHaveAttribute('aria-live', 'polite');
    expect(saved).toHaveBeenCalledOnce();
    window.removeEventListener('profile-handle-saved', saved);
  });

  it.each([
    [409, 'That handle is already in use.'],
    [429, 'You have reached the handle-change limit. Try again later.'],
  ])('announces a specific %s handle error and marks the field invalid', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProfileSettings initial={{ handle: 'future_builder', displayName: 'Future Builder', profilePublic: false }} />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    const notice = (await screen.findByText(message)).closest('.vf-notice');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveAttribute('data-tone', 'fault');
    expect(notice?.closest('#profile-handle-status')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Public handle' })).toHaveAttribute('aria-invalid', 'true');
  });
});
