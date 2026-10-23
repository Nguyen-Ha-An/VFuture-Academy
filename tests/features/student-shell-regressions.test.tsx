// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { ShellBreadcrumbs } from '@/components/ShellPrimitives';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const location = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
const wrap = (children: React.ReactNode) => <NextIntlClientProvider locale="en" messages={withBenchMessages(en, 'en')}>{children}</NextIntlClientProvider>;

afterEach(() => { cleanup(); location.pathname = '/app'; window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });

describe('student navigation regressions', () => {
  it('uses a native submit menu item associated with the persistent sign-out form', () => {
    render(wrap(<AppShell><h1>Learning</h1></AppShell>));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
    const signout = screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement;
    expect(signout.tagName).toBe('BUTTON');
    expect(signout.type).toBe('submit');
    expect(signout.form).toHaveAttribute('action', '/auth/signout');
    expect(signout.form).toHaveAttribute('method', 'post');
    const form = signout.form;
    fireEvent.keyDown(signout, { key: 'Escape' });
    expect(form).toBeInTheDocument();
  });

  it('closes mobile navigation on desktop resize and does not focus its hidden trigger', async () => {
    let onChange: ((event: { matches: boolean }) => void) | undefined;
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: (_: string, listener: typeof onChange) => { onChange = listener; }, removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', matchMedia);
    render(wrap(<AppShell><h1>Learning</h1></AppShell>));
    const trigger = screen.getByRole('button', { name: en.common.menu });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 47.5rem)');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    act(() => onChange?.({ matches: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).not.toHaveFocus();
  });

  it('prioritizes profile hash focus and waits for streamed destination headings', async () => {
    location.pathname = '/app/profile';
    window.history.replaceState(null, '', '/app/profile#xp-heading');
    const { rerender } = render(wrap(<AppShell><h1>Profile</h1><h2 id="xp-heading">XP</h2></AppShell>));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'XP' })).toHaveFocus());
    window.history.replaceState(null, '', '/app/courses'); location.pathname = '/app/courses';
    rerender(wrap(<AppShell><p>Loading</p></AppShell>));
    rerender(wrap(<AppShell><h1>Courses loaded</h1></AppShell>));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Courses loaded' })).toHaveFocus());
  });

  it('closes the account menu and focuses a same-page XP destination', async () => {
    location.pathname = '/app/profile';
    window.history.replaceState(null, '', '/app/profile');
    render(wrap(<AppShell><h1>Profile</h1><h2 id="xp-heading">XP</h2></AppShell>));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'XP' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'XP' })).toHaveFocus());
    expect(window.location.hash).toBe('#xp-heading');
  });

  it('allows an explicit breadcrumb title without changing parent links', () => {
    render(wrap(<ShellBreadcrumbs pathname="/studio/courses/course-123" items={[{ key: 'courses', href: '/studio/courses', label: 'Courses' }]} currentLabel="AI foundations" />));
    expect(screen.getByText('AI foundations')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/studio/courses');
    expect(screen.queryByText('course 123')).not.toBeInTheDocument();
  });
});
