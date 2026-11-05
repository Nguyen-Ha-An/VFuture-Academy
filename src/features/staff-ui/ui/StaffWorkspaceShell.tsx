"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import type { StaffChrome } from "@/features/staff-ui/types";
import { StaffTitleContext } from "@/features/workspace/ui/StaffTitleContext";
import { workspaceThemeAttribute } from "@/features/workspace-ui/theme";
import type { AdminScope, AdminScopeOption } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/ui-cn";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import { isCourseEditorRoute, isCourseWorkspacePage, useStaffNavigation } from "../navigation";
import { sidebarStateCookie } from "../sidebar-state";
import { StaffSidebar } from "./StaffSidebar";
import { StaffTopBar } from "./StaffTopBar";
import { CanvasProvider } from "@/features/canvas/ui/CanvasProvider";
import { DrawerLayout } from "@instructure/ui-drawer-layout/v11_7";
import { GlobalNavigation } from "@/features/canvas/ui/GlobalNavigation";
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
export function StaffWorkspaceShell({ workspace, chrome, permissions, scopeOptions, activeScope, entries, children }: StaffWorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const common = useTranslations("common");
  const navigation = useStaffNavigation(workspace, permissions);
  const mainId = `${workspace}-main`;
  const editor = isCourseEditorRoute(workspace, pathname) || workspace === "grading" && /^\/grading\/(assignments|exams)\/[^/]+/.test(pathname);
  const courseWorkspace = isCourseWorkspacePage(workspace, pathname);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <CanvasProvider theme={chrome.theme}><StaffTitleContext.Provider value={registerTitle}>
      <SidebarProvider
        open={editor ? editorOpen : compact ? compactOpen : preferredOpen}
        onOpenChange={onOpenChange}
        className="vf-staff vf-canvas bg-background text-foreground"
        data-theme={workspaceThemeAttribute(chrome.theme)}
        data-workspace={workspace}
      >
        <a
          href={`#${mainId}`}
          className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-primary px-4 py-2.5 text-sm font-medium leading-[1.4] text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {common("skipToContent")}
        </a>
        <GlobalNavigation studio={entries.studio} grading={entries.grading} admin={entries.admin} />
        <StaffDrawer compact={compact} label={navigation.label} navigation={<StaffSidebar
          workspace={workspace}
          navigation={navigation}
          entries={entries}
          scopeOptions={scopeOptions}
          activeScope={activeScope}
          identity={chrome.identity}
          theme={chrome.theme}
        />}>
        <SidebarInset className={cn(courseWorkspace && "vf-staff-course-editor")} data-editor={editor ? "" : undefined}>
          <header className="sticky top-0 z-20 box-content flex h-14 shrink-0 items-center border-b border-border bg-background px-4 leading-[1.4]">
            <StaffTopBar
              workspace={workspace}
              permissions={permissions}
              entries={entries}
              activeScope={activeScope}
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
              editor ? "px-3 py-3 sm:px-4 lg:px-6" : "mx-auto w-full max-w-[96rem] p-4 md:p-8",
            )}
          >
            {children}
          </main>
        </SidebarInset>
        </StaffDrawer>
        <ShellRouteEffects mainId={mainId} pathname={pathname} triggerRef={triggerRef} />
      </SidebarProvider>
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
  const focusHeading = useCallback(() => {
    const heading = document.querySelector<HTMLElement>(`#${mainId} h1`);
    if (heading) {
      heading.tabIndex = -1;
      // A programmatic target, not a control: no focus ring (see .vf-staff main h1 in shell.css).
      heading.focus({ preventScroll: true });
    }
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
function StaffDrawer({ label, navigation, children, compact }: { label: string; navigation: ReactNode; children: ReactNode; compact: boolean }) {
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const visible = isMobile ? openMobile : open;
  const overlay = compact || isMobile;
  return <div className="canvas-staff-drawer" style={{ display: 'grid', gridTemplateColumns: !overlay && visible ? '208px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
    {!overlay && visible && <div>{navigation}</div>}
    <div style={{ minWidth: 0 }}><DrawerLayout minWidth="44rem">
      <DrawerLayout.Tray label={label} open={overlay && visible} placement="start" onDismiss={() => isMobile ? setOpenMobile(false) : setOpen(false)} shouldContainFocus={overlay} shouldReturnFocus={overlay} shouldCloseOnEscape shouldCloseOnDocumentClick>{navigation}</DrawerLayout.Tray>
      <DrawerLayout.Content themeOverride={{ overflowY: 'visible' }} label={label}>{children}</DrawerLayout.Content>
    </DrawerLayout></div>
  </div>;
}
