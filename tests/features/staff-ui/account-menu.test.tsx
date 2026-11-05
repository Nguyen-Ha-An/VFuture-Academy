// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';
import { SidebarProvider } from '@/components/ui/sidebar';
import { registerNavigationGuard, type NavigationIntent } from '@/lib/navigation-guard';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';
import { applyStaffTheme } from '@/features/staff-ui/theme-client';
import type { StaffIdentity } from '@/features/staff-ui/types';
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
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/studio' }));

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
  vi.restoreAllMocks();
  document.cookie = 'vf-theme=; max-age=0; path=/';
  document.cookie = 'locale=; max-age=0; path=/';
  localStorage.clear();
  document.body.innerHTML = '';
});

const identity: StaffIdentity = { name: 'Nguyễn Minh Anh', email: 'minh.anh@vfuture.edu.vn', avatarUrl: null, initials: 'MA' };

function view({ who = identity, theme = 'system' as WorkspaceTheme, lang = 'en' as 'en' | 'vi' } = {}) {
  const base = lang === 'en' ? en : vi_;
  return render(
    <NextIntlClientProvider locale={lang} messages={staffUiTestMessages(base, lang)}>
      <CanvasProvider theme={theme}><SidebarProvider className="vf-staff">
        <StaffUserMenu identity={who} workspace="studio" theme={theme} entries={{ studio: '/studio', grading: null, admin: null }} />
      </SidebarProvider></CanvasProvider>
    </NextIntlClientProvider>,
  );
}

async function openAccount(label = 'Account') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  return screen.findByRole('dialog', { name: label });
}

async function choose(control: HTMLElement, label: string) {
  const user = userEvent.setup();
  await user.click(control);
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('StaffUserMenu account tray entrypoint', () => {
  it('keeps the trigger concise and places initials, full name and email inside the tray', async () => {
    view();
    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveTextContent(identity.email!);
    const tray = await openAccount();
    expect(within(tray).getByRole('heading', { name: identity.name })).toBeInTheDocument();
    expect(within(tray).getByText(identity.email!)).toBeInTheDocument();
    expect(tray.querySelector('.canvas-account-avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(tray.querySelector('.canvas-account-avatar')).toHaveTextContent('MA');
  });

  it('uses the localized fallback name when the identity has none', async () => {
    view({ who: { name: '', email: null, avatarUrl: null, initials: '' }, lang: 'vi' });
    const tray = await openAccount('Tài khoản');
    expect(within(tray).getByRole('heading', { level: 3, name: 'Tài khoản' })).toBeInTheDocument();
  });

  it('offers the short account links and two native preference comboboxes without duplicate workspace navigation', async () => {
    view();
    const tray = await openAccount();
    expect(within(tray).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/app/profile', '/app/profile#profile-settings-heading', '/app/profile#certificates-heading', '/app/leaderboard',
    ]);
    expect(within(tray).getByRole('link', { name: en.common.accountSettings })).toHaveAttribute('href', '/app/profile#profile-settings-heading');
    expect(within(tray).queryByRole('link', { name: en.common.openLearning })).not.toBeInTheDocument();
    expect(within(tray).queryByRole('link', { name: 'XP' })).not.toBeInTheDocument();
    expect(within(tray).getAllByRole('combobox')).toHaveLength(2);
    expect(within(tray).getByRole('combobox', { name: en.common.language })).toHaveValue(en.locale.en);
    expect(within(tray).getByRole('combobox', { name: 'Theme' })).toHaveValue('Auto');
    expect(within(tray).getByRole('button', { name: en.common.signOut })).toHaveAttribute('type', 'button');
  });

  it('dispatches the real native POST form after tray exit and flags Studio recovery before leaving', async () => {
    view();
    const tray = await openAccount();
    const form = document.querySelector<HTMLFormElement>('form[action="/auth/signout"]')!;
    expect(form).toHaveAttribute('method', 'post');
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    const startedAt = Date.now();
    fireEvent.click(within(tray).getByRole('button', { name: en.common.signOut }));
    await waitFor(() => expect(submitted).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
    const markedAt = localStorage.getItem(RECOVERY_SIGNED_OUT_KEY);
    expect(markedAt).toMatch(/^\d+$/);
    expect(Number(markedAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Number(markedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('preserves cancellation of the native sign-out submit before recovery is marked', async () => {
    view();
    const tray = await openAccount();
    const cancel = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); });
    document.addEventListener('submit', cancel, true);
    try {
      fireEvent.click(within(tray).getByRole('button', { name: en.common.signOut }));
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(localStorage.getItem(RECOVERY_SIGNED_OUT_KEY)).toBeNull();
      expect(cancel.mock.calls[0][0].defaultPrevented).toBe(true);
    } finally { document.removeEventListener('submit', cancel, true); }
  });

  it('uses the real document guard and locale hook, then retains pending and failure state in the reopened tray', async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(resolve => { finish = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);
    const allow = vi.fn(async (intent?: NavigationIntent) => {
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
      expect(intent?.kind).toBe('document');
      return true;
    });
    const unregister = registerNavigationGuard(allow);
    try {
      view();
      expect(locale.spy).toHaveBeenCalled();
      const tray = await openAccount();
      await choose(within(tray).getByRole('combobox', { name: en.common.language }), en.locale.vi);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/profile/locale', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale: 'vi' }) })));
      expect(allow).toHaveBeenCalledOnce();
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
      const pendingLanguage = await screen.findByRole('combobox', { name: en.common.language });
      await waitFor(() => expect(pendingLanguage).toBeDisabled());
      expect(pendingLanguage).toHaveValue(en.locale.vi);
      expect(screen.getByText('Saving language…').closest('[role="status"]')).not.toBeNull();
      await act(async () => finish(new Response(null, { status: 500 })));
      const reopened = await screen.findByRole('dialog', { name: 'Account' });
      expect(await within(reopened).findByText(en.locale.updateError)).toBeVisible();
      const language = within(reopened).getByRole('combobox', { name: en.common.language });
      expect(language).toHaveAttribute('aria-invalid', 'true');
      expect(language).toHaveAccessibleDescription(new RegExp("^\\s*" + en.locale.updateError.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&") + "\\s*$"));
      expect(language).toBeEnabled();
      expect(language).toHaveValue(en.locale.en);
      expect(signal?.aborted).toBe(true);
    } finally { unregister(); }
  });

  it('sends no locale PATCH when the real document navigation guard refuses', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const stay = vi.fn(async (intent?: NavigationIntent) => {
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
      expect(intent?.kind).toBe('document');
      return false;
    });
    const unregister = registerNavigationGuard(stay);
    try {
      view();
      const tray = await openAccount();
      await choose(within(tray).getByRole('combobox', { name: en.common.language }), en.locale.vi);
      await waitFor(() => expect(stay).toHaveBeenCalledOnce());
      await act(async () => { await Promise.resolve(); });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
    } finally { unregister(); }
  });

  it.each(['dismiss', 'unmount'] as const)('cancels a pending locale request on %s without writing the locale cookie', async (exit) => {
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const mounted = view();
    const tray = await openAccount();
    await choose(within(tray).getByRole('combobox', { name: en.common.language }), en.locale.vi);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const reopened = await screen.findByRole('dialog', { name: 'Account' });
    await waitFor(() => expect(within(reopened).getByRole('combobox', { name: en.common.language })).toBeDisabled());
    if (exit === 'dismiss') fireEvent.click(within(reopened).getByRole('button', { name: en.common.close }));
    else mounted.unmount();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(document.cookie).not.toContain('locale=vi');
  });

  it('does not save when the current language is chosen again', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    view();
    const tray = await openAccount();
    await choose(within(tray).getByRole('combobox', { name: en.common.language }), en.locale.en);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the chosen theme to the shell and cookie through the native combobox', async () => {
    const { container } = view();
    const tray = await openAccount();
    const theme = within(tray).getByRole('combobox', { name: 'Theme' });
    await choose(theme, 'Dark');
    expect(container.querySelector('.vf-staff')).toHaveAttribute('data-theme', 'dark');
    expect(document.cookie).toContain('vf-theme=dark');
    expect(theme).toHaveValue('Dark');
  });
});

describe('account tray theme synchronization', () => {
  it('uses localized labels for both native preferences', async () => {
    view({ lang: 'vi' });
    const tray = await openAccount('Tài khoản');
    expect(within(tray).getByRole('combobox', { name: 'Giao diện' })).toBeInTheDocument();
    expect(within(tray).getByRole('combobox', { name: vi_.common.language })).toHaveValue(vi_.locale.vi);
    expect(within(tray).getAllByRole('combobox')).toHaveLength(2);
  });

  it('responds to the existing staff theme event and can return to system through the native control', async () => {
    const { container } = view({ theme: 'dark' });
    const tray = await openAccount();
    const theme = within(tray).getByRole('combobox', { name: 'Theme' });
    expect(theme).toHaveValue('Dark');
    act(() => applyStaffTheme('light'));
    expect(theme).toHaveValue('Light');
    expect(container.querySelector('.vf-staff')).toHaveAttribute('data-theme', 'light');
    expect(document.cookie).toContain('vf-theme=light');
    await choose(theme, 'Auto');
    expect(theme).toHaveValue('Auto');
    expect(container.querySelector('.vf-staff')).not.toHaveAttribute('data-theme');
    expect(document.cookie).toContain('vf-theme=system');
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
