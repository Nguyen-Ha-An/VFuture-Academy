// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CanvasProvider } from '@/features/canvas/ui';
import messages from '@/messages/en.json';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { SchoolScopeContinue, SchoolScopeLink } from '@/features/admin/components/SchoolScopeNavigation';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, useRouter: () => nav }));

const memberId = '00000000-0000-4000-8000-000000000101';
const navigation = {
  actorId: 'operator',
  workspace: 'admin' as const,
  activeScope: { kind: 'branch' as const, branchId: 'school-a' },
  savedScopeKey: 'branch:school-a',
  targetScope: { kind: 'branch' as const, branchId: 'school-b' },
  schoolName: 'School B',
  destination: `/admin/users/${memberId}`,
  href: `/account/school-context?branchId=school-b&target=member&userId=${memberId}`,
};

function view(children: ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={messages}><CanvasProvider theme="light">{children}</CanvasProvider></NextIntlClientProvider>);
}

function enabledSchoolLink() {
  const link = screen.getByRole('link', { name: 'Member B' });
  expect(link).not.toHaveAttribute('aria-disabled');
  expect(link).toHaveAttribute('href', navigation.href);
  return link;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); nav.push.mockReset(); });

describe('guarded school navigation', () => {
  it('uses a read-only scope entry href for modified clicks and marks one guard owner', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const guard = vi.fn(async () => true);
    const unregister = registerNavigationGuard(guard);
    try {
      view(<SchoolScopeLink navigation={navigation}>Member B</SchoolScopeLink>);
      const link = screen.getByRole('link', { name: 'Member B' });
      expect(link).toHaveAttribute('href', navigation.href);
      expect(link).toHaveAttribute('data-academy-managed-navigation', 'true');
      fireEvent.click(link, { button: 0, metaKey: true });
      fireEvent.click(link, { button: 0, ctrlKey: true });
      expect(guard).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(nav.push).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it('waits for the dirty guard and Stay cancels both cookie POST and destination navigation', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    let settle!: (allow: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const unregister = registerNavigationGuard(guard);
    try {
      view(<SchoolScopeLink navigation={navigation}>Member B</SchoolScopeLink>);
      // jsdom 30 incorrectly matches InstUI's legacy :-webkit-any(a)[aria-disabled]
      // selector on enabled links. Test guard semantics here; real Next browser
      // coverage must exercise ordinary pointer clicks without forcing them.
      fireEvent.click(enabledSchoolLink());
      expect(guard).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      await act(async () => { settle(false); });
      expect(request).not.toHaveBeenCalled();
      expect(nav.push).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
      expect(nav.refresh).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it('posts the authorized target only after the guard, then pushes the exact record into history', async () => {
    const order: string[] = [];
    const request = vi.fn(async () => { order.push('post'); return new Response('{}', { status: 200 }); });
    vi.stubGlobal('fetch', request);
    nav.push.mockImplementation(() => { order.push('push'); });
    const guard = vi.fn(async () => { order.push('guard'); return true; });
    const unregister = registerNavigationGuard(guard);
    try {
      view(<SchoolScopeLink navigation={navigation}>Member B</SchoolScopeLink>);
      fireEvent.click(enabledSchoolLink());
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith(navigation.destination));
      expect(guard).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/api/v1/admin/scope?actorId=operator&scope=branch%3Aschool-a', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ scope: 'branch:school-b' }),
        headers: expect.objectContaining({ 'x-vfuture-expected-saved-scope': 'branch:school-a' }),
      }));
      expect(order).toEqual(['guard', 'post', 'push']);
      expect(nav.replace).not.toHaveBeenCalled();
      expect(nav.refresh).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it('still navigates within the active school without a redundant cookie write', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const guard = vi.fn(async () => true);
    const unregister = registerNavigationGuard(guard);
    try {
      view(<SchoolScopeLink navigation={{ ...navigation, activeScope: navigation.targetScope, savedScopeKey: 'branch:school-b' }}>Member B</SchoolScopeLink>);
      fireEvent.click(enabledSchoolLink());
      // The entry rechecks the cookie server-side before redirecting the canonical
      // member route, so a different tab cannot silently change the viewed school.
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith(navigation.href));
      expect(guard).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it('persists an explicitly confirmed school when the context only fell back to it', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', request);
    view(<SchoolScopeContinue navigation={{ ...navigation, activeScope: navigation.targetScope }} label="Continue to School B" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue to School B' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(navigation.destination));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/v1/admin/scope?actorId=operator&scope=branch%3Aschool-b', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ scope: 'branch:school-b' }),
    }));
  });

  it.each([403, 409])('keeps the current record and scope visible when the POST rejects with %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    view(<SchoolScopeContinue navigation={navigation} label="Continue to School B" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue to School B' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('does not silently switch schools merely because the continuation page mounted', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    view(<SchoolScopeContinue navigation={navigation} label="Continue to School B" />);
    expect(screen.getByRole('button', { name: 'Continue to School B' })).toBeEnabled();
    expect(request).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
