'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent, type RefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Tray } from '@instructure/ui-tray/v11_7';
import { Avatar } from '@instructure/ui-avatar/v11_7';
import { LogOut, X } from 'lucide-react';
import { CanvasButton, CanvasLink, CanvasSelect } from './controls';
import { useLocaleChange } from '@/components/LocaleSwitcher';
import { applyWorkspaceTheme } from '@/features/workspace-ui/ui/ThemeSwitcher';
import { WORKSPACE_THEME_EVENT, workspaceThemes, type WorkspaceTheme } from '@/features/workspace-ui/theme';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';
import { requestNavigation } from '@/lib/navigation-guard';
import { routes } from '@/lib/routes';
import { initials as initialsForName } from '@/lib/initials';
import type { AppLocale } from '@/i18n/request';
import './account-tray.css';

export type AccountIdentity = { name?: string; initials?: string; handle?: string; email?: string | null; avatarUrl?: string | null };
export function isRenderableAvatar(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
}

export const ACCOUNT_TRAY_ID = 'academy-account-tray';

/** One controller per shell; a mobile navigation drawer can hand off after it has fully closed. */
export function useAccountTrayController(fallbackFocus?: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const handoffFrame = useRef<number | null>(null);
  const pathname = usePathname();
  const latestPath = useRef(pathname);
  latestPath.current = pathname;
  useEffect(() => () => { if (handoffFrame.current !== null) cancelAnimationFrame(handoffFrame.current); }, []);
  const openFrom = useCallback((element: HTMLElement | null) => { trigger.current = element; setOpen(true); }, []);
  const openAfterClose = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
    const requestedPath = latestPath.current;
    if (handoffFrame.current !== null) cancelAnimationFrame(handoffFrame.current);
    handoffFrame.current = requestAnimationFrame(() => { handoffFrame.current = null; if (latestPath.current === requestedPath) setOpen(true); });
  }, []);
  const onAccount = useCallback((event: SyntheticEvent<unknown>) => { openFrom(event.currentTarget instanceof HTMLElement ? event.currentTarget : null); }, [openFrom]);
  const restoreFocus = useCallback(() => {
    const candidates = [trigger.current, fallbackFocus?.current, ...document.querySelectorAll<HTMLElement>(`button[aria-controls="${ACCOUNT_TRAY_ID}"]`)];
    const target = candidates.find(element => element?.isConnected && !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    target?.focus({ preventScroll: true });
  }, [fallbackFocus]);
  return { open, setOpen, onAccount, openFrom, openAfterClose, restoreFocus };
}


function subscribeToPhoneLayout(notify: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
function isPhoneLayout() { return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches; }

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
  identity: AccountIdentity;
  theme: WorkspaceTheme;
};
type ExitAction = { kind: 'navigate'; href: string } | { kind: 'signout' } | { kind: 'locale'; locale: AppLocale; controller: AbortController };

/** A transient account/preferences surface, not an ARIA Menu or a second workspace navigator. */
export function AccountTray({ open, onOpenChange, restoreFocus, identity, theme: initialTheme }: Props) {
  const common = useTranslations('common');
  const focus = useTranslations('learner.focus');
  const themeT = useTranslations('bench.shared.theme');
  const localeT = useTranslations('locale');
  const vi = useLocale() === 'vi';
  const pathname = usePathname();
  const router = useRouter();
  const { locale, changeLocale, isPending: localePending, error: localeError } = useLocaleChange();
  const [theme, setTheme] = useState(initialTheme);
  const closeRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const phone = useSyncExternalStore(subscribeToPhoneLayout, isPhoneLayout, () => false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const exitAction = useRef<ExitAction | null>(null);
  const exitFrame = useRef<number | null>(null);
  const mounted = useRef(true);
  const localeIntent = useRef<{ controller: AbortController; stage: 'queued' | 'saving'; locale: AppLocale } | null>(null);
  const cancelLocale = () => { localeIntent.current?.controller.abort(); localeIntent.current = null; };
  const previousPath = useRef(pathname);
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const generation = useRef(0);
  const name = identity.name || focus('account');
  const identityInitials = identity.initials?.trim() || initialsForName(identity.name, identity.email) || initialsForName(name);
  const links = [
    { href: routes.learner.profile(), label: focus('profile') },
    { href: `${routes.learner.profile()}#profile-settings-heading`, label: common('accountSettings') },
    { href: `${routes.learner.profile()}#certificates-heading`, label: focus('certificates') },
    { href: routes.learner.leaderboard(), label: focus('leaderboard') },
  ];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; localeIntent.current?.controller.abort(); if (exitFrame.current !== null) cancelAnimationFrame(exitFrame.current); };
  }, []);
  useEffect(() => {
    if (open) {
      if (localeIntent.current?.stage === 'queued') { localeIntent.current.controller.abort(); localeIntent.current = null; }
      generation.current += 1;
      exitAction.current = null;
      if (exitFrame.current !== null) { cancelAnimationFrame(exitFrame.current); exitFrame.current = null; }
    }
  }, [open]);
  useEffect(() => {
    if (previousPath.current !== pathname) { previousPath.current = pathname; localeIntent.current?.controller.abort(); localeIntent.current = null; generation.current += 1; exitAction.current = null; onOpenChange(false); }
  }, [pathname, onOpenChange]);
  useEffect(() => { setTheme(initialTheme); }, [initialTheme]);
  useEffect(() => {
    const sync = (event: Event) => {
      const value = (event as CustomEvent<WorkspaceTheme>).detail;
      if (workspaceThemes.includes(value)) setTheme(value);
    };
    window.addEventListener(WORKSPACE_THEME_EVENT, sync);
    window.addEventListener('vf-staff-theme', sync);
    return () => { window.removeEventListener(WORKSPACE_THEME_EVENT, sync); window.removeEventListener('vf-staff-theme', sync); };
  }, []);

  const dismiss = () => { cancelLocale(); exitAction.current = null; onOpenChange(false); };
  const navigate = (event: SyntheticEvent<unknown>, href: string) => {
    if ('button' in event && event.button !== 0) return;
    if (('metaKey' in event && event.metaKey) || ('ctrlKey' in event && event.ctrlKey) || ('shiftKey' in event && event.shiftKey) || ('altKey' in event && event.altKey)) return;
    event.preventDefault();
    cancelLocale();
    exitAction.current = { kind: 'navigate', href };
    onOpenChange(false);
  };
  const finishExit = () => {
    const exitGeneration = generation.current;
    // InstUI calls onExited in the same commit that removes the focus region. Do not
    // open a dirty-confirmation dialog until that region has been released.
    if (exitFrame.current !== null) cancelAnimationFrame(exitFrame.current);
    exitFrame.current = requestAnimationFrame(() => {
      exitFrame.current = null;
      if (latestOpen.current || generation.current !== exitGeneration || !mounted.current) return;
      const action = exitAction.current;
      exitAction.current = null;
      if (!action) { restoreFocus(); return; }
      if (action.kind === 'signout') { restoreFocus(); formRef.current?.requestSubmit(); return; }
      if (action.kind === 'locale') {
        const { controller } = action;
        void requestNavigation({ kind: 'document', signal: controller.signal }).then(allowed => {
          if (!mounted.current || latestOpen.current || generation.current !== exitGeneration || controller.signal.aborted) { controller.abort(); return; }
          if (!allowed) { controller.abort(); if (localeIntent.current?.controller === controller) localeIntent.current = null; restoreFocus(); return; }
          localeIntent.current = { controller, stage: 'saving', locale: action.locale };
          // The guard releases its confirmation focus region before approval resolves.
          onOpenChange(true);
          changeLocale(action.locale, { signal: controller.signal, onFailure: () => {
            controller.abort();
            if (localeIntent.current?.controller === controller) localeIntent.current = null;
          } });
        });
        return;
      }
      const destination = new URL(action.href, window.location.href);
      const samePage = destination.pathname === window.location.pathname && destination.search === window.location.search;
      void (samePage ? Promise.resolve(true) : requestNavigation()).then(allowed => {
        if (!mounted.current || latestOpen.current || generation.current !== exitGeneration) return;
        if (!allowed) { restoreFocus(); return; }
        router.push(action.href);
        if (samePage) requestAnimationFrame(() => {
          if (!mounted.current || latestOpen.current || generation.current !== exitGeneration) return;
          let id = '';
          try { id = decodeURIComponent(destination.hash.slice(1)); } catch { /* A malformed fragment falls back to the page heading. */ }
          const target = id ? document.getElementById(id) : document.querySelector<HTMLElement>('main h1');
          if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }); }
        });
      });
    });
  };

  return <>
    <form ref={formRef} action={routes.auth.signout()} method="post" hidden onSubmit={() => {
      try { localStorage.setItem(RECOVERY_SIGNED_OUT_KEY, String(Date.now())); } catch { /* Server sign-out remains authoritative. */ }
    }} />
    <div ref={mountRef} className="canvas-account-mount" data-open={open || undefined} />
    <Tray label={focus('account')} mountNode={() => mountRef.current}
      open={open} placement={phone ? 'bottom' : 'start'} size="small" themeOverride={{ widthSm: '370px', padding: '0' }}
      defaultFocusElement={() => closeRef.current} shouldContainFocus shouldReturnFocus={false}
      shouldCloseOnDocumentClick onDismiss={dismiss} onExited={finishExit} border={false}>
      <div id={ACCOUNT_TRAY_ID} className="canvas-account-panel">
        <header className="canvas-account-heading">
          <CanvasButton ref={closeRef} variant="ghost" size="icon" aria-label={common('close')} onClick={dismiss}><X size={21} aria-hidden="true" /></CanvasButton>
          <h2>{focus('account')}</h2>
        </header>
        <div className="canvas-account-scroll">
          <section className="canvas-account-identity" aria-label={focus('account')}>
            <span className="canvas-account-avatar" aria-hidden="true"><Avatar name={name} size="small" src={isRenderableAvatar(identity.avatarUrl) ? identity.avatarUrl : undefined} showBorder="never" renderIcon={<span>{identityInitials}</span>} /></span>
            <div><h3>{name}</h3>{identity.email ? <p>{identity.email}</p> : identity.handle ? <p>@{identity.handle}</p> : null}</div>
          </section>
          <CanvasButton variant="outline" renderIcon={<LogOut size={16} aria-hidden="true" />} onClick={() => { cancelLocale(); exitAction.current = { kind: 'signout' }; onOpenChange(false); }}>{common('signOut')}</CanvasButton>
          <nav aria-label={focus('account')} className="canvas-account-links"><ul>{links.map(link => <li key={link.href}>
            <CanvasLink href={link.href} data-academy-managed-navigation="true" onClick={event => navigate(event, link.href)}>{link.label}</CanvasLink>
          </li>)}</ul></nav>
          <section className="canvas-account-preferences" aria-labelledby="account-preferences-heading">
            <h3 id="account-preferences-heading">{vi ? 'Tùy chọn' : 'Preferences'}</h3>
            <CanvasSelect label={common('language')} value={localePending ? localeIntent.current?.locale ?? locale : locale} disabled={localePending}
              options={[{ value: 'vi', label: localeT('vi') }, { value: 'en', label: localeT('en') }]}
              messages={localeError ? [{ type: 'error', text: localeError }] : []}
              onChange={value => {
                if (localePending || value === locale || (value !== 'vi' && value !== 'en')) return;
                cancelLocale();
                const controller = new AbortController();
                localeIntent.current = { controller, stage: 'queued', locale: value };
                exitAction.current = { kind: 'locale', locale: value, controller };
                onOpenChange(false);
              }} />
            {localePending ? <p role="status" className="canvas-account-status">{vi ? 'Đang lưu ngôn ngữ…' : 'Saving language…'}</p> : null}
            <CanvasSelect label={themeT('label')} value={theme} options={workspaceThemes.map(value => ({ value, label: themeT(value) }))}
              onChange={value => { const next = value as WorkspaceTheme; setTheme(next); applyWorkspaceTheme(next); }} />
          </section>
        </div>
      </div>
    </Tray>
  </>;
}
