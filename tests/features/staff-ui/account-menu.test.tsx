// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';
import { applyStaffTheme } from '@/features/staff-ui/theme-client';
import type { StaffIdentity } from '@/features/staff-ui/types';
import { StaffThemeMenu } from '@/features/staff-ui/ui/StaffThemeMenu';
import { StaffUserMenu, isRenderableAvatar } from '@/features/staff-ui/ui/StaffUserMenu';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const locale = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock('@/components/LocaleSwitcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/LocaleSwitcher')>();
  return { ...actual, useLocaleChange: () => { locale.spy(); return actual.useLocaleChange(); } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/studio' }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.cookie = 'vf-theme=; max-age=0; path=/';
  localStorage.clear();
  document.body.innerHTML = '';
});

const identity: StaffIdentity = { name: 'Nguyễn Minh Anh', email: 'minh.anh@vfuture.edu.vn', avatarUrl: null, initials: 'MA' };

function view({ who = identity, theme = 'system' as WorkspaceTheme, lang = 'en' as 'en' | 'vi', withThemeMenu = false } = {}) {
  const base = lang === 'en' ? en : vi_;
  return render(
    <NextIntlClientProvider locale={lang} messages={staffUiTestMessages(base, lang)}>
      <SidebarProvider className="vf-staff">
        {withThemeMenu ? <StaffThemeMenu theme={theme} /> : null}
        <StaffUserMenu identity={who} workspace="studio" theme={theme} entries={{ studio: '/studio', grading: null, admin: null }} />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

function openUserMenu(name: RegExp | string = /Nguyễn Minh Anh/) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false });
  return screen.getByRole('menu');
}

describe('StaffUserMenu', () => {
  it('shows initials, name and email in the footer button', () => {
    view();
    const trigger = screen.getByRole('button', { name: /Nguyễn Minh Anh/ });
    expect(trigger).toHaveTextContent('MA');
    expect(trigger).toHaveTextContent('minh.anh@vfuture.edu.vn');
    expect(trigger).toHaveAttribute('data-size', 'lg');
  });

  it('uses the localized fallback name when the identity has none', () => {
    view({ who: { name: '', email: null, avatarUrl: null, initials: '' }, lang: 'vi' });
    expect(screen.getByRole('button', { name: /Tài khoản/ })).toBeInTheDocument();
  });

  it('lists Learning workspace, Account settings, language, theme and sign out', () => {
    view();
    const menu = openUserMenu();
    expect(within(menu).getByRole('menuitem', { name: en.common.openLearning })).toHaveAttribute('href', '/app');
    expect(within(menu).getByRole('menuitem', { name: en.common.accountSettings })).toHaveAttribute('href', '/app/profile');
    expect(within(menu).getByRole('menuitemradio', { name: en.locale.vi })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByRole('menuitemradio', { name: en.locale.en })).toHaveAttribute('aria-checked', 'true');
    for (const option of ['System', 'Light', 'Dark']) expect(within(menu).getByRole('menuitemradio', { name: option })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitem', { name: en.common.signOut })).toBeInTheDocument();
  });

  it('signs out through a real POST form and flags Studio draft recovery first', () => {
    view();
    const menu = openUserMenu();
    const button = within(menu).getByRole('menuitem', { name: en.common.signOut }) as HTMLButtonElement;
    expect(button).toHaveAttribute('type', 'submit');
    const form = button.form;
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('action', '/auth/signout');
    expect(form).toHaveAttribute('method', 'post');
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    fireEvent.submit(form!);
    expect(localStorage.getItem(RECOVERY_SIGNED_OUT_KEY)).toBe('1234');
  });

  it('changes the language through the shared locale hook', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    expect(locale.spy).toHaveBeenCalled();
    const menu = openUserMenu();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: en.locale.vi }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/profile/locale', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale: 'vi' }) })));
    expect(await within(screen.getByRole('menu')).findByRole('alert')).toHaveTextContent(en.locale.updateError);
  });

  it('does nothing when the current language is chosen again', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    view();
    fireEvent.click(within(openUserMenu()).getByRole('menuitemradio', { name: en.locale.en }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the chosen theme to the shell and the cookie', () => {
    const { container } = view();
    const shell = container.querySelector<HTMLElement>('.vf-staff')!;
    fireEvent.click(within(openUserMenu()).getByRole('menuitemradio', { name: 'Dark' }));
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(document.cookie).toContain('vf-theme=dark');
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('StaffThemeMenu', () => {
  it('is an icon button with a localized screen-reader label', () => {
    view({ withThemeMenu: true, lang: 'vi' });
    expect(screen.getByRole('button', { name: 'Giao diện' })).toBeInTheDocument();
  });

  it('offers the same radio and keeps the user menu in step', () => {
    const { container } = view({ withThemeMenu: true, theme: 'dark' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Theme' }), { button: 0, ctrlKey: false });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Light' }));
    expect(container.querySelector('.vf-staff')).toHaveAttribute('data-theme', 'light');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(within(openUserMenu()).getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('applyStaffTheme', () => {
  it('sets data-theme for dark and light, removes it for system, and writes the cookie each time', () => {
    const shell = document.createElement('div');
    shell.className = 'vf-staff';
    document.body.append(shell);
    applyStaffTheme('dark');
    expect(shell.dataset.theme).toBe('dark');
    expect(document.cookie).toContain('vf-theme=dark');
    applyStaffTheme('light');
    expect(shell.dataset.theme).toBe('light');
    expect(document.cookie).toContain('vf-theme=light');
    applyStaffTheme('system');
    expect(shell).not.toHaveAttribute('data-theme');
    expect(document.cookie).toContain('vf-theme=system');
  });
});

describe('isRenderableAvatar', () => {
  it('allows same-origin paths and data images only, since the notebook route blocks cross-origin images', () => {
    expect(isRenderableAvatar('/api/v1/media/abc')).toBe(true);
    expect(isRenderableAvatar('data:image/png;base64,AAAA')).toBe(true);
    expect(isRenderableAvatar('https://cdn.example.com/a.png')).toBe(false);
    expect(isRenderableAvatar('//cdn.example.com/a.png')).toBe(false);
    expect(isRenderableAvatar('javascript:alert(1)')).toBe(false);
    expect(isRenderableAvatar(null)).toBe(false);
  });
});
