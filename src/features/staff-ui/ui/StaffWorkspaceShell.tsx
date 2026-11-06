"use client";

import { createPortal } from "react-dom";
import { useScopeChange } from "@/features/workspace/useScopeChange";
import type { ScopeChange } from "@/features/workspace/useScopeChange";
import { StaffScopeTransitionContext } from "./StaffScopeTransitionContext";
import { ScopeSwitchingOverlay } from "@/features/admin/components/AdminScopeSelector";
import { useWorkspaceSurfaceTheme } from "@/components/ui/workspace-surface-context";
import { usePathname, useRouter } from "next/navigation";
import { requestNavigation } from "@/lib/navigation-guard";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import type { StaffChrome } from "@/features/staff-ui/types";
import { StaffTitleContext } from "@/features/workspace/ui/StaffTitleContext";
import { workspaceThemeAttribute } from "@/features/workspace-ui/theme";
import { scopeKey, type AdminScope, type AdminScopeOption } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/ui-cn";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import { isCourseEditorRoute, isCourseWorkspacePage, useStaffNavigation } from "../navigation";
import { sidebarStateCookie } from "../sidebar-state";
import { StaffSidebar } from "./StaffSidebar";
import { StaffTopBar } from "./StaffTopBar";
import { CanvasProvider } from "@/features/canvas/ui/CanvasProvider";
import { Tray } from "@instructure/ui-tray/v11_7";
import { GlobalNavigation } from "@/features/canvas/ui/GlobalNavigation";
import { AccountTray, ACCOUNT_TRAY_ID, useAccountTrayController } from "@/features/canvas/ui/AccountTray";
import { CoursesTray, COURSES_TRAY_ID } from "@/features/canvas/ui/CoursesTray";
import "../staff-tokens.css";
import "../shell.css";
import "@/features/canvas/canvas.css";

export type StaffWorkspaceShellProps = {
  workspace: StaffWorkspace;
  chrome: StaffChrome;
  permissions: Permission[];
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  entries: WorkspaceEntries;
  children: ReactNode;
  nonce?: string;
};

/** Read back on the server by `readStaffChrome()`; "false" means collapsed, anything else open. */
function persistSidebarState(open: boolean) {
  document.cookie = sidebarStateCookie(open, window.location.protocol === "https:");
}

/**
 * Authenticated Canvas staff shell. The root carries the scoped workspace tokens and
 * server-rendered theme; the global rail and collapsible contextual navigation preserve
 * the existing permission-filtered destinations and navigation focus behavior.
 */
export function StaffWorkspaceShell({ workspace, chrome, permissions, scopeOptions, activeScope, entries, children, nonce }: StaffWorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const common = useTranslations("common");
  const navigation = useStaffNavigation(workspace, permissions);
  const mainId = `${workspace}-main`;
  const reviewWorkbench = workspace === 'studio' && /^\/studio\/reviews\/[^/]+\/?$/.test(pathname);
  const editor = isCourseEditorRoute(workspace, pathname) || workspace === "grading" && /^\/grading\/(assignments|exams)\/[^/]+/.test(pathname);
  const courseWorkspace = isCourseWorkspacePage(workspace, pathname);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const account = useAccountTrayController(triggerRef);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const coursesTrigger = useRef<HTMLElement | null>(null);
  const openCourses = useCallback((event: SyntheticEvent<unknown>) => {
    coursesTrigger.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : triggerRef.current;
    setCoursesOpen(true);
  }, []);
  const restoreCoursesFocus = useCallback(() => {
    const selector = `button[aria-controls="${COURSES_TRAY_ID}"]`;
    const candidates = [coursesTrigger.current?.matches(selector) ? coursesTrigger.current : null, ...document.querySelectorAll<HTMLElement>(selector), triggerRef.current];
    candidates.find(element => element?.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')?.focus({ preventScroll: true });
  }, []);
  const { openAfterClose } = account;
  const drawerHandoff = useRef<{ kind: 'account'; identity: string } | { kind: 'courses'; identity: string } | { kind: 'scope'; identity: string; scope: string } | { kind: 'navigation'; identity: string; href: string; token: number } | null>(null);
  const navigationToken = useRef(0);
  const scopeIdentity = workspace + ':' + (activeScope ? scopeKey(activeScope) : 'none') + ':' + pathname;
  const latestScopeIdentity = useRef(scopeIdentity);
  latestScopeIdentity.current = scopeIdentity;
  const scopeLease = useRef<string | null>(null);
  const scopeFrame = useRef<number | null>(null);
  const drawerVisible = useRef(false);
  const [scopeQueued, setScopeQueued] = useState(false);
  const queuedRef = useRef(false);
  const live = useRef(true);
  const isScopeCurrent = useCallback(() => live.current && scopeLease.current === latestScopeIdentity.current, []);
  const scopeState = useScopeChange(workspace, { active: activeScope ?? { kind: 'central' }, isCurrent: isScopeCurrent });
  const { changeScope, pending: scopePending } = scopeState;
  const cancelScopeHandoff = useCallback(() => {
    if (drawerHandoff.current?.kind === 'scope') drawerHandoff.current = null;
    scopeLease.current = null;
    queuedRef.current = false;
    setScopeQueued(false);
    if (scopeFrame.current !== null) { cancelAnimationFrame(scopeFrame.current); scopeFrame.current = null; }
  }, []);
  useEffect(() => { navigationToken.current += 1; cancelScopeHandoff(); drawerHandoff.current = null; setCoursesOpen(false); }, [scopeIdentity, cancelScopeHandoff]);
  useEffect(() => { live.current = true; return () => { live.current = false; scopeLease.current = null; if (scopeFrame.current !== null) cancelAnimationFrame(scopeFrame.current); }; }, []);
  const requestScope = useCallback((next: string, closeOverlay?: () => void) => {
    if (!activeScope || scopePending || queuedRef.current || scopeKey(activeScope) === next
      || !scopeOptions?.some(option => scopeKey(option.scope) === next)) return;
    scopeLease.current = latestScopeIdentity.current;
    if (closeOverlay) {
      queuedRef.current = true;
      setScopeQueued(true);
      drawerHandoff.current = { kind: 'scope', identity: scopeLease.current, scope: next };
      closeOverlay();
      return;
    }
    triggerRef.current?.focus({ preventScroll: true });
    void changeScope(next);
  }, [activeScope, scopeOptions, changeScope, scopePending]);
  const navigateAfterClose = useCallback(async (action: { identity: string; href: string; token: number }) => {
    const current = () => live.current && action.identity === latestScopeIdentity.current && action.token === navigationToken.current;
    if (!current()) return;
    triggerRef.current?.focus({ preventScroll: true });
    if (await requestNavigation() && current()) router.push(action.href);
  }, [router]);
  const requestSidebarNavigation = useCallback((href: string, closeOverlay?: () => void) => {
    if (scopePending || queuedRef.current || drawerHandoff.current) return;
    const action = { kind: 'navigation' as const, identity: latestScopeIdentity.current, href, token: ++navigationToken.current };
    if (closeOverlay) { drawerHandoff.current = action; closeOverlay(); }
    else void navigateAfterClose(action);
  }, [scopePending, navigateAfterClose]);
  const drawerOpened = useCallback(() => {
    navigationToken.current += 1;
    drawerHandoff.current = null;
    cancelScopeHandoff();
  }, [cancelScopeHandoff]);
  const finishDrawerHandoff = useCallback(() => {
    const action = drawerHandoff.current;
    drawerHandoff.current = null;
    if (!action) return;
    if (action.identity !== latestScopeIdentity.current || !live.current) { cancelScopeHandoff(); return; }
    if (action.kind === 'account') { openAfterClose(triggerRef.current); return; }
    if (action.kind === 'courses') {
      scopeFrame.current = requestAnimationFrame(() => {
        scopeFrame.current = null;
        if (action.identity !== latestScopeIdentity.current || !live.current || drawerVisible.current) return;
        coursesTrigger.current = triggerRef.current;
        setCoursesOpen(true);
      });
      return;
    }
    if (action.kind === 'navigation') {
      // Native onExited runs before its portal-removal commit. Let that commit
      // release the old focus region before opening a dirty-work confirmation.
      scopeFrame.current = requestAnimationFrame(() => {
        scopeFrame.current = null;
        if (!drawerVisible.current) void navigateAfterClose(action);
      });
      return;
    }
    scopeFrame.current = requestAnimationFrame(() => {
      scopeFrame.current = null;
      if (!isScopeCurrent() || drawerVisible.current) { cancelScopeHandoff(); return; }
      queuedRef.current = false;
      setScopeQueued(false);
      triggerRef.current?.focus({ preventScroll: true });
      void changeScope(action.scope);
    });
  }, [openAfterClose, cancelScopeHandoff, isScopeCurrent, changeScope, navigateAfterClose]);

  // Same registration contract as StaffShell: a page names its record for the last crumb.
  const [recordTitle, setRecordTitle] = useState<{ pathname: string; title: string; token: object } | null>(null);
  const registerTitle = useCallback((title: string) => {
    const token = {};
    setRecordTitle({ pathname, title, token });
    return () => setRecordTitle((current) => (current?.token === token ? null : current));
  }, [pathname]);

  // The editor forces the icon rail for as long as the author stays in it; toggling there
  // is temporary and never touches the saved preference (cookie).
  const [preferredOpen, setPreferredOpen] = useState(chrome.sidebarOpen);
  const [compact, setCompact] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => { setCompact(media.matches); setCompactOpen(false); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [editorOpen, setEditorOpen] = useState(false);
  const [wasEditor, setWasEditor] = useState(editor);
  if (wasEditor !== editor) {
    setWasEditor(editor);
    if (editor) setEditorOpen(false);
  }
  const onOpenChange = useCallback((next: boolean) => {
    if (editor) {
      setEditorOpen(next);
      return;
    }
    if (compact) { setCompactOpen(next); return; }
    setPreferredOpen(next);
    persistSidebarState(next);
  }, [editor, compact]);

  if (reviewWorkbench) return <CanvasProvider theme={chrome.theme} nonce={nonce}>
    <StaffTitleContext.Provider value={registerTitle}>
      <div className="vf-staff vf-canvas canvas-review-shell" data-workspace={workspace} data-theme={workspaceThemeAttribute(chrome.theme)}>
        <main id={mainId} tabIndex={-1} className="min-w-0 outline-none">{children}</main>
      </div>
    </StaffTitleContext.Provider>
  </CanvasProvider>;

  return (
    <CanvasProvider theme={chrome.theme} nonce={nonce}><StaffTitleContext.Provider value={registerTitle}>
      <StaffScopeTransitionContext.Provider value={{ state: scopeState, queued: scopeQueued, compact, request: requestScope }}><SidebarProvider
        open={editor ? editorOpen : compact ? compactOpen : preferredOpen}
        onOpenChange={onOpenChange}
        className="vf-staff vf-canvas bg-background text-foreground"
        data-theme={workspaceThemeAttribute(chrome.theme)}
        data-workspace={workspace}
        inert={scopeState.switching || undefined}
      >
        <a
          href={`#${mainId}`}
          className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-primary px-4 py-2.5 text-sm font-medium leading-[1.4] text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {common("skipToContent")}
        </a>
        <GlobalNavigation studio={entries.studio} grading={entries.grading} admin={entries.admin} onAccount={account.onAccount} accountOpen={account.open} accountControls={ACCOUNT_TRAY_ID} onCourses={openCourses} coursesOpen={coursesOpen} coursesControls={COURSES_TRAY_ID} />
        <StaffDrawer compact={compact} label={navigation.label} visibilityRef={drawerVisible} onOpened={drawerOpened} onClosed={finishDrawerHandoff} navigation={<StaffSidebar
          workspace={workspace}
          navigation={navigation}
          entries={entries}
          scopeOptions={scopeOptions}
          activeScope={activeScope}
          identity={chrome.identity}
          theme={chrome.theme}
          onAccount={() => { if (!scopeState.pending && !scopeQueued) drawerHandoff.current = { kind: 'account', identity: latestScopeIdentity.current }; }}
          accountOpen={account.open}
          onCourses={() => { if (!scopeState.pending && !scopeQueued) drawerHandoff.current = { kind: 'courses', identity: latestScopeIdentity.current }; }}
          coursesOpen={coursesOpen}
          onNavigateRequest={requestSidebarNavigation}
        />}>
        <SidebarInset className={cn(courseWorkspace && "vf-staff-course-editor")} data-editor={editor ? "" : undefined}>
          <header className="sticky top-0 z-20 box-content flex h-14 shrink-0 items-center border-b border-border bg-background px-4 leading-[1.4]">
            <StaffTopBar
              workspace={workspace}
              permissions={permissions}
              entries={entries}
              activeScope={activeScope}
              scopeOptions={scopeOptions}
              theme={chrome.theme}
              pathname={pathname}
              navigation={navigation}
              currentTitle={recordTitle?.pathname === pathname ? recordTitle.title : undefined}
              triggerRef={triggerRef}
            />
          </header>
          <main
            id={mainId}
            tabIndex={-1}
            className={cn(
              "min-w-0 flex-1 scroll-mt-[57px] outline-none",
              editor ? "px-3 py-3 sm:px-4 lg:px-6" : "w-full p-4 md:p-6",
            )}
          >
            {children}
          </main>
        </SidebarInset>
        </StaffDrawer>
        <AccountTray open={account.open} onOpenChange={account.setOpen} restoreFocus={account.restoreFocus} identity={chrome.identity} theme={chrome.theme} />
        <CoursesTray open={coursesOpen} onOpenChange={setCoursesOpen} restoreFocus={restoreCoursesFocus} />
        <StaffScopeEffects state={scopeState} />
        <ShellRouteEffects mainId={mainId} pathname={pathname} triggerRef={triggerRef} />
      </SidebarProvider></StaffScopeTransitionContext.Provider>
    </StaffTitleContext.Provider></CanvasProvider>
  );
}

/**
 * Route change: close the mobile drawer and move focus to the page's h1 (StaffShell's logic).
 * The first render is not a route change: a fresh load keeps the browser's own start (skip link
 * first in the tab order) and draws no focus ring around the heading.
 * A drawer dismissed any other way (Escape, overlay, close button) hands focus back to the
 * trigger, which the sidebar Sheet can't do itself because it isn't opened by a Dialog trigger.
 */
function ShellRouteEffects({ mainId, pathname, triggerRef }: { mainId: string; pathname: string; triggerRef: RefObject<HTMLButtonElement | null> }) {
  const { openMobile, setOpenMobile } = useSidebar();
  const openRef = useRef(openMobile);
  const navigating = useRef(false);
  // Compared by value, so StrictMode's repeated mount effect doesn't count as a navigation.
  const lastPathname = useRef(pathname);
  const headingObserver = useRef<MutationObserver | null>(null);
  useEffect(() => () => { headingObserver.current?.disconnect(); headingObserver.current = null; }, []);
  const focusHeading = useCallback(() => {
    headingObserver.current?.disconnect();
    const main = document.getElementById(mainId);
    if (!main) return;
    // A route pathname can commit before its streamed page. Observe only that
    // destination until its declared heading accepts focus, then stop entirely.
    const observer = new MutationObserver(focusDestination);
    headingObserver.current = observer;
    function focusDestination() {
      if (headingObserver.current !== observer) return;
      const heading = main?.querySelector<HTMLElement>('h1[tabindex="-1"]');
      if (!heading?.isConnected || heading.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      heading.focus({ preventScroll: true });
      if (document.activeElement === heading) { observer.disconnect(); headingObserver.current = null; }
    }
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    focusDestination();
  }, [mainId]);

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    // With the drawer open its focus trap would pull focus back, so the heading waits for the close.
    if (openRef.current) {
      navigating.current = true;
      setOpenMobile(false);
      return;
    }
    focusHeading();
  }, [pathname, focusHeading, setOpenMobile]);

  useEffect(() => {
    const wasOpen = openRef.current;
    openRef.current = openMobile;
    if (openMobile || !wasOpen) return;
    const navigated = navigating.current;
    navigating.current = false;
    const timer = window.setTimeout(() => {
      if (navigated) {
        focusHeading();
        return;
      }
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || active.closest('[data-mobile="true"]') !== null;
      if (lost) triggerRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openMobile, focusHeading, triggerRef]);

  return null;
}

/** Desktop navigation is static: native DrawerTray always autofocuses its Dialog.
 * Keep that focus region for overlay navigation and retain the content subtree on resize. */
function StaffDrawer({ label, navigation, children, compact, onClosed, onOpened, visibilityRef }: { label: string; navigation: ReactNode; children: ReactNode; compact: boolean; onClosed?: () => void; onOpened?: () => void; visibilityRef: RefObject<boolean> }) {
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const visible = isMobile ? openMobile : open;
  const overlay = compact || isMobile;
  visibilityRef.current = visible;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const wasVisible = useRef(visible);
  useEffect(() => { if (visible && !wasVisible.current) onOpened?.(); wasVisible.current = visible; }, [onOpened, visible]);
  return <div className="canvas-staff-drawer" style={{ display: 'grid', gridTemplateColumns: !overlay && visible ? '208px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
    {!overlay && visible && <div>{navigation}</div>}
    <div ref={mountRef} className="canvas-staff-overlay-mount" data-open={overlay && visible || undefined} />
    {/* Keep the overlay's portal lifecycle independent of DrawerLayout's measured
        inline/overlay context. Moving an already-mounted native DrawerTray
        between those contexts can retain its exited transition after resize. */}
    <Tray key={overlay ? 'overlay' : 'inline'} mountNode={() => mountRef.current} label={label} open={overlay && visible} placement="start" size="small" border={false} themeOverride={{ widthSm: '208px', padding: '0' }} onDismiss={() => isMobile ? setOpenMobile(false) : setOpen(false)} shouldContainFocus shouldReturnFocus shouldCloseOnDocumentClick onExited={onClosed}>{navigation}</Tray>
    <div style={{ minWidth: 0 }}>{children}</div>
  </div>;
}


/** Persistent scope operation: never owned by the disposable navigation drawer. */
function StaffScopeEffects({ state }: { state: ScopeChange }) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const surface = useWorkspaceSurfaceTheme();
  const failureShown = useRef(false);
  useEffect(() => {
    if (!state.error) { failureShown.current = false; return; }
    if (!state.pending && !failureShown.current) {
      failureShown.current = true;
      if (isMobile) setOpenMobile(true); else setOpen(true);
    }
  }, [isMobile, setOpen, setOpenMobile, state.error, state.pending]);
  useEffect(() => {
    if (!state.switching) return;
    const block = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if ((event.metaKey || event.ctrlKey) && ['k', 'b'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const stopTraversal = (event: Event) => {
      // App-owned replace/refresh must commit the authorized scope. Only user
      // history traversal can abandon the in-flight operation underneath it.
      if ('navigationType' in event && event.navigationType === 'traverse' && event.cancelable) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    window.addEventListener('keyup', block, true);
    navigation?.addEventListener('navigate', stopTraversal, true);
    return () => { window.removeEventListener('keydown', block, true); window.removeEventListener('keyup', block, true); navigation?.removeEventListener('navigate', stopTraversal, true); };
  }, [state.switching]);
  return state.switching && typeof document !== 'undefined'
    ? createPortal(<div data-canvas-surface={surface ?? undefined}><ScopeSwitchingOverlay /></div>, document.body) : null;
}
