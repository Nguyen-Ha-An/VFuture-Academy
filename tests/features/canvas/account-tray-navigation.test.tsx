// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const mocks = vi.hoisted(() => ({ push: vi.fn(), requestNavigation: vi.fn(), changeLocale: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: vi.fn() }));
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, usePathname: () => '/admin', useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/navigation-guard', () => ({ requestNavigation: mocks.requestNavigation }));
vi.mock('@/components/LocaleSwitcher', () => ({ useLocaleChange: () => ({ locale: 'en', changeLocale: mocks.changeLocale, isPending: false, error: null }) }));

// The contract under test is sequencing after the Tray's exit callback. Native Tray geometry,
// real focus containment and placement are checked on the production-shaped Next pages.
vi.mock('@instructure/ui-tray/v11_7', () => ({ Tray: function ExitBoundary({ open, label, onExited, children }: { open: boolean; label: string; onExited?: () => void; children: ReactNode }) {
  const previous = useRef(open);
  useEffect(() => { if (previous.current && !open) onExited?.(); previous.current = open; }, [open, onExited]);
  return open ? <div role="dialog" aria-label={label}>{children}</div> : null;
} }));

import { buildStaffIdentity } from '@/features/staff-ui/identity.server';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';
import { AccountTray, useAccountTrayController, type AccountIdentity } from '@/features/canvas/ui/AccountTray';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';

const defaultIdentity = buildStaffIdentity({ displayName: 'Avery Nguyen [VFU-LAB-EDITOR]', email: 'avery.nguyen@example.test' });

function Surface({ identity = defaultIdentity }: { identity?: AccountIdentity }) {
  const controller = useAccountTrayController();
  return <><button onClick={controller.onAccount}>Open account</button><AccountTray open={controller.open} onOpenChange={controller.setOpen} restoreFocus={controller.restoreFocus}
    identity={identity} theme="light" /></>;
}
function mount(identity?: AccountIdentity) {
  return render(<NextIntlClientProvider locale="en" messages={withBenchMessages(en, 'en')}><CanvasProvider theme="light"><Surface identity={identity} /></CanvasProvider></NextIntlClientProvider>);
}

beforeEach(() => {
  mocks.push.mockReset(); mocks.requestNavigation.mockReset().mockResolvedValue(true); mocks.changeLocale.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared account tray navigation contract', () => {
  it('uses native Avatar with name-derived initials while preserving the full displayed identity', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    const tray = screen.getByRole('dialog', { name: 'Account' });
    expect(within(tray).getByText('Avery Nguyen [VFU-LAB-EDITOR]')).toBeInTheDocument();
    expect(within(tray).getByText('AN', { exact: true })).toBeInTheDocument();
    expect(within(tray).queryByText('AV', { exact: true })).not.toBeInTheDocument();
    expect(within(tray).queryByText('XP', { exact: true })).not.toBeInTheDocument();
    expect(within(tray).queryByRole('link', { name: /open studio/i })).not.toBeInTheDocument();
    expect(within(tray).getAllByRole('combobox')).toHaveLength(2);
  });

  it('preserves canonical email-fallback initials in the actual native Avatar', () => {
    mount(buildStaffIdentity({ email: 'pat.lee@example.test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    const tray = screen.getByRole('dialog', { name: 'Account' });
    expect(within(tray).getByText('pat.lee', { exact: true })).toBeInTheDocument();
    expect(within(tray).getByText('PL', { exact: true })).toBeInTheDocument();
  });

  it('releases the tray before asking a navigation guard and never navigates after cancellation', async () => {
    mocks.requestNavigation.mockImplementation(async () => {
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
      return false;
    });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Profile' }));
    await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalledOnce());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('pushes the actual destination once only after the guard accepts', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'Certificates' });
    expect(link).toHaveAttribute('href', '/app/profile#certificates-heading');
    fireEvent.click(link);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/profile#certificates-heading'));
    expect(mocks.push).toHaveBeenCalledOnce();
  });

  it('ignores an old guard approval after a new account session opens', async () => {
    let resolveGuard!: (allowed: boolean) => void;
    mocks.requestNavigation.mockImplementation(() => new Promise<boolean>(resolve => { resolveGuard = resolve; }));
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Profile' }));
    await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    await act(async () => resolveGuard(true));
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('restores a visible trigger before a cancelled native sign-out and leaves recovery untouched', async () => {
    localStorage.removeItem(RECOVERY_SIGNED_OUT_KEY);
    mount();
    const trigger = screen.getByRole('button', { name: 'Open account' });
    const rect = new DOMRect(0, 0, 90, 44);
    vi.spyOn(trigger, 'getClientRects').mockReturnValue({ 0: rect, length: 1, item: index => index === 0 ? rect : null, [Symbol.iterator]: () => [rect][Symbol.iterator]() });
    let capturedFocus: Element | null = null;
    let cancelled = false;
    const stay = (event: Event) => {
      capturedFocus = document.activeElement;
      event.preventDefault();
      event.stopPropagation();
      cancelled = event.defaultPrevented;
    };
    document.addEventListener('submit', stay, true);
    try {
      fireEvent.click(trigger);
      const signOut = within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' });
      signOut.focus();
      fireEvent.click(signOut);
      await waitFor(() => expect(cancelled).toBe(true));
      expect(capturedFocus).toBe(trigger);
      expect(document.activeElement).toBe(trigger);
      expect(localStorage.getItem(RECOVERY_SIGNED_OUT_KEY)).toBeNull();
      expect(mocks.requestNavigation).not.toHaveBeenCalled();
    } finally { document.removeEventListener('submit', stay, true); }
  });

  it('submits sign-out through the existing native form after exit, without a second guard call', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement) {
      expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
      expect(this.getAttribute('action')).toBe('/auth/signout');
    });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
  });
});
