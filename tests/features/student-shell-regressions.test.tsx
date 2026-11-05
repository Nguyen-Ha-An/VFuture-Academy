// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { ShellBreadcrumbs } from '@/components/ShellPrimitives';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';

const location = vi.hoisted(() => ({ pathname: '/app', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, usePathname: () => location.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: location.push }) }));
const wrap = (children: React.ReactNode) => <NextIntlClientProvider locale="en" messages={withBenchMessages(en, 'en')}>{children}</NextIntlClientProvider>;

afterEach(() => { cleanup(); location.pathname = '/app'; location.push.mockReset(); window.history.replaceState(null, '', '/');
  localStorage.removeItem(RECOVERY_SIGNED_OUT_KEY); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('student navigation regressions', () => {
  it('keeps the native sign-out form on cancel and submits it after the Account tray exits with the recovery signal', async () => {
    render(wrap(<AppShell><h1>Learning</h1></AppShell>));
    localStorage.removeItem(RECOVERY_SIGNED_OUT_KEY);
    const form = document.querySelector<HTMLFormElement>('form[action="/auth/signout"]')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('hidden');
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement) {
      expect(this).toBe(form);
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
      fireEvent.submit(this);
    });
    const trigger = screen.getByRole('button', { name: 'Account' });
    // JSDOM has no layout. Give only the actual trigger a visible rect for the restoration branch.
    vi.spyOn(trigger, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList);
    fireEvent.click(trigger);
    let tray = await screen.findByRole('dialog', { name: 'Account' });
    fireEvent.click(within(tray).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(form).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECOVERY_SIGNED_OUT_KEY)).toBeNull();
    fireEvent.click(trigger);
    tray = await screen.findByRole('dialog', { name: 'Account' });
    const signout = within(tray).getByRole('button', { name: 'Sign out' });
    expect(signout.tagName).toBe('BUTTON');
    fireEvent.click(signout);
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(localStorage.getItem(RECOVERY_SIGNED_OUT_KEY)).toBeTruthy();
  });

  it('closes mobile navigation on desktop resize and does not focus its hidden trigger', async () => {
    let onChange: ((event: { matches: boolean }) => void) | undefined;
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: (_: string, listener: typeof onChange) => { onChange = listener; }, removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', matchMedia);
    render(wrap(<AppShell><h1>Learning</h1></AppShell>));
    const trigger = screen.getByRole('button', { name: en.common.menu });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    act(() => onChange?.({ matches: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).not.toHaveFocus();
  });

  it('prioritizes profile hash focus and waits for streamed destination headings', async () => {
    location.pathname = '/app/profile';
    window.history.replaceState(null, '', '/app/profile#xp-heading');
    const { rerender } = render(wrap(<AppShell><h1 tabIndex={-1}>Profile</h1><h2 id="xp-heading" tabIndex={-1}>XP</h2></AppShell>));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'XP' })).toHaveFocus());
    window.history.replaceState(null, '', '/app/courses'); location.pathname = '/app/courses';
    rerender(wrap(<AppShell><p>Loading</p></AppShell>));
    rerender(wrap(<AppShell><h1 tabIndex={-1}>Courses loaded</h1></AppShell>));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Courses loaded' })).toHaveFocus());
  });

  it('closes the Account tray and focuses the exact same-page settings destination, including a repeated hash', async () => {
    location.pathname = '/app/profile';
    window.history.replaceState(null, '', '/app/profile');
    location.push.mockImplementation((href: string) => window.history.pushState(null, '', href));
    render(wrap(<AppShell><h1 tabIndex={-1}>Profile</h1><h2 id="profile-settings-heading" tabIndex={-1}>Account settings</h2></AppShell>));
    const settings = screen.getByRole('heading', { name: 'Account settings' });
    // Browsers implement this API; JSDOM needs a local observable equivalent.
    const scrollIntoView = vi.fn();
    Object.defineProperty(settings, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: 'Account' }));
      const tray = await screen.findByRole('dialog', { name: 'Account' });
      const link = within(tray).getByRole('link', { name: 'Account settings' });
      expect(link).toHaveAttribute('href', '/app/profile#profile-settings-heading');
      fireEvent.click(link);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument());
      await waitFor(() => expect(location.push).toHaveBeenCalledTimes(attempt + 1));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(attempt + 1));
      expect(settings).toHaveFocus();
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' });
      expect(window.location.hash).toBe('#profile-settings-heading');
    }
    await waitFor(() => expect(location.push).toHaveBeenCalledTimes(2));
    expect(location.push).toHaveBeenLastCalledWith('/app/profile#profile-settings-heading');
  });

  it('allows an explicit breadcrumb title without changing parent links', () => {
    render(wrap(<ShellBreadcrumbs pathname="/studio/courses/course-123" items={[{ key: 'courses', href: '/studio/courses', label: 'Courses' }]} currentLabel="AI foundations" />));
    expect(screen.getByText('AI foundations')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/studio/courses');
    expect(screen.queryByText('course 123')).not.toBeInTheDocument();
  });
});
