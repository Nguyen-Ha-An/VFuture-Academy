'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuButton, MobileNavigationDrawer, type ShellNavItem } from '@/components/ShellPrimitives';
import { AccountTray, ACCOUNT_TRAY_ID, useAccountTrayController } from '@/features/canvas/ui/AccountTray';
import { routes } from '@/lib/routes';
import { useSectionShortcuts, type BenchNavItem } from '@/features/workspace-ui/learner/BenchBar';
import { requestNavigation } from '@/lib/navigation-guard';
import { LearnerCommandMenu } from '@/features/workspace-ui/learner/command/LearnerCommandMenu';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import { WorkspaceSurface } from '@/features/workspace-ui/ui/WorkspaceSurface';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';
import { GlobalNavigation } from '@/features/canvas/ui/GlobalNavigation';
import '@/features/workspace-ui/learner/learner.css';
import '@/features/canvas/canvas.css';

const SECTION_CODES: Record<string, string> = { learning: 'A1', courses: 'A2', explore: 'A3' };

export function AppShell({ children, canAccessStudio = false, studioDestination, gradingDestination, adminDestination, userName, initials, handle, theme = 'system', nonce }: { children: React.ReactNode; canAccessStudio?: boolean; studioDestination?: string | null; gradingDestination?: string | null; adminDestination?: string | null; userName?: string; initials?: string; handle?: string; theme?: WorkspaceTheme; nonce?: string }) {
  const learner = useTranslations('learner');
  const t = useTranslations('learner.focus');
  const common = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const account = useAccountTrayController(menuButtonRef);
  const accountHandoff = useRef<string | null>(null);
  const navigation = useMemo<ShellNavItem[]>(() => [
    { key: 'learning', href: routes.learner.dashboard(), label: t('learning') },
    { key: 'courses', href: routes.learner.courses(), label: t('courses') },
    { key: 'explore', href: routes.learner.explore(), label: t('explore') },
  ], [t]);

  useEffect(() => {
    setDrawerOpen(false);
    const main = document.getElementById('learner-main');
    if (!main) return;
    let focused = false;
    // Route changes move focus to the page h1 (or the hash target) once it has rendered; the
    // observer only waits for streamed content and stops after the first focus.
    const observer = new MutationObserver(() => updateDestination());
    const updateDestination = () => {
      if (focused) return;
      const heading = main.querySelector<HTMLElement>('h1');
      let hash = '';
      try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { /* Ignore malformed hash. */ }
      const target = hash ? document.getElementById(hash) : heading;
      if (!target || !main.contains(target)) return;
      // Focusability belongs to rendered markup, not a pre-hydration DOM mutation.
      const focusable = 'a[href], button, input, select, textarea, [tabindex]';
      const focusTarget = target.matches(focusable) ? target : heading?.matches(focusable) ? heading : main;
      focusTarget.focus({ preventScroll: true });
      if (hash) target.scrollIntoView?.({ block: 'start' });
      focused = true;
      observer.disconnect();
    };
    const onHashChange = () => { focused = false; updateDestination(); };
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    updateDestination();
    window.addEventListener('hashchange', onHashChange);
    return () => { observer.disconnect(); window.removeEventListener('hashchange', onHashChange); };
  }, [pathname]);

  const accountProps = { studioDestination: studioDestination ?? (canAccessStudio ? routes.studio.dashboard() : null), gradingDestination, adminDestination, userName, initials, handle };
  const isFocusRoute = /^\/app\/courses\/[^/]+\/items\/[^/]+(?:\/notebook)?$/.test(pathname);
  // The frame (learner.css): home draws the full-width trace, focus routes own their frame, the rest share the column.
  const layout = isFocusRoute ? 'focus' : pathname === routes.learner.dashboard() ? 'home' : undefined;
  const exploreSection = /^\/app\/(resources|opportunities|projects)(?:\/|$)/.test(pathname);
  // Resources, opportunities and projects belong to Explore in the nav; pages own their breadcrumbs.
  const navPath = exploreSection ? routes.learner.explore() : pathname;

  const benchItems = useMemo<BenchNavItem[]>(() => navigation.map(item => ({ ...item, code: SECTION_CODES[item.key] ?? '' })), [navigation]);
  const navigate = useCallback((href: string) => { void requestNavigation().then(allowed => { if (allowed) router.push(href); }); }, [router]);
  useSectionShortcuts(benchItems, navigate);
  return <CanvasProvider theme={theme} nonce={nonce}><WorkspaceSurface theme={theme} density="comfortable" className="vf-learner-refined vf-canvas">
    <div inert={drawerOpen || undefined} className="min-h-dvh canvas-learner-body">
      <a href="#learner-main" className="vf-l-skip">{learner('skipToContent')}</a>
      <GlobalNavigation studio={accountProps.studioDestination} grading={gradingDestination} admin={adminDestination} onAccount={account.onAccount} accountOpen={account.open} accountControls={ACCOUNT_TRAY_ID} />
      <CanvasLearnerHeader title={navigation.find(item => navPath === item.href || item.href !== '/app' && navPath.startsWith(`${item.href}/`))?.label ?? common('brand')} menuButton={<MenuButton ref={menuButtonRef} className="md:hidden" controls="learner-mobile-navigation" expanded={drawerOpen} onClick={() => setDrawerOpen(true)} />} search={<LearnerCommandMenu onOpenAccount={account.openAfterClose} destinations={{ studio: accountProps.studioDestination, grading: gradingDestination, admin: adminDestination }} />} />
      <MobileNavigationDrawer id="learner-mobile-navigation" open={drawerOpen} onOpenChange={setDrawerOpen} title={common('learnerNavigation')} returnFocusRef={menuButtonRef} themeClassName="vf-learner-refined" closeAt="(min-width: 48rem)" onAfterClose={() => {
        const requestedPath = accountHandoff.current;
        accountHandoff.current = null;
        if (requestedPath !== pathname) return false;
        account.openAfterClose(menuButtonRef.current);
        return true;
      }}>
        <GlobalNavigation studio={accountProps.studioDestination} grading={gradingDestination} admin={adminDestination} mobile onNavigate={() => setDrawerOpen(false)} onAccount={() => { accountHandoff.current = pathname; setDrawerOpen(false); }} accountOpen={account.open} accountControls={ACCOUNT_TRAY_ID} />
      </MobileNavigationDrawer>
      <main id="learner-main" tabIndex={-1} className="vf-l-main" data-layout={layout}>
        {children}
      </main>
    </div>
    <AccountTray open={account.open} onOpenChange={account.setOpen} restoreFocus={account.restoreFocus} identity={{ name: userName, initials, handle }} theme={theme} />
  </WorkspaceSurface></CanvasProvider>;
}

function CanvasLearnerHeader({ title, menuButton, search }: { title: string; menuButton: React.ReactNode; search: React.ReactNode }) {
  return <header className="canvas-learner-header">{menuButton}<span className="canvas-learner-header-title">{title}</span><div className="canvas-learner-header-actions">{search}</div></header>;
}
