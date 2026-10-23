"use client";

import { StaffShell } from "@/features/workspace/ui/StaffShell";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccountActions,
  BrandLink,
  MenuButton,
  MobileNavigationDrawer,
  NavigationList,
  ShellBreadcrumbs,
  type ShellNavItem,
} from "@/components/ShellPrimitives";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import { AdminScopeSelector } from "@/features/admin/components/AdminScopeSelector";
import type { AdminScope, AdminScopeOption } from "@/lib/admin-scope";
import { studioNavigation } from "@/lib/studio-navigation";
import { shellNavigation } from "@/lib/workspace-navigation";

function LegacyStudioShell({
  children,
  permissions,
  userName,
  scopeOptions,
  activeScope,
  entries,
}: {
  children: React.ReactNode;
  permissions: Permission[];
  userName?: string;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  entries?: WorkspaceEntries;
}) {
  const t = useTranslations("studioNav");
  const common = useTranslations("common");
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigation = useMemo<ShellNavItem[]>(
    () =>
      shellNavigation(
        studioNavigation.filter(
          (item) =>
            item.available &&
            item.permissions.some((permission) =>
              permissions.includes(permission),
            ),
        ),
        (key) => t(key),
      ),
    [permissions, t],
  );
  const switcher = (stacked = false) => entries
    ? <WorkspaceSwitcher entries={entries} active="studio" stacked={stacked} onNavigate={() => setDrawerOpen(false)} />
    : null;
  const scopePicker =
    activeScope && scopeOptions ? (
      <AdminScopeSelector options={scopeOptions} active={activeScope} endpoint="/api/v1/studio/scope" destination={routes.studio.dashboard()} />
    ) : null;
  const isCourseWorkspace = /^\/studio\/courses\/[^/]+/.test(pathname);

  useEffect(() => {
    setDrawerOpen(false);
    const heading = document.querySelector<HTMLElement>("#studio-main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pathname]);

  const accountActions = (stacked = false) => (
    <AccountActions
      profileHref={routes.learner.profile()}
      workspaceHref={routes.learner.dashboard()}
      workspaceLabel={common("openLearning")}
      userName={userName}
      onNavigate={() => setDrawerOpen(false)}
      stacked={stacked}
    />
  );

  return (
    <div
      className={
        isCourseWorkspace
          ? "min-h-screen bg-background text-foreground"
          : "min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]"
      }
    >
      <a
        href="#studio-main"
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        {common("skipToContent")}
      </a>
      <aside
        className={
          isCourseWorkspace
            ? "hidden"
            : "hidden min-h-screen border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col"
        }
      >
        <div className="flex min-h-16 items-center border-b border-border px-5">
          <BrandLink href={routes.studio.dashboard()} />
        </div>
        {entries ? <div className="border-b border-border px-2 py-3">{switcher(true)}</div> : null}
        {scopePicker ? <div className="px-3 pt-4">{scopePicker}</div> : null}
        <nav
          aria-label={common("studioNavigation")}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
        >
          <NavigationList items={navigation} pathname={pathname} vertical />
        </nav>
        <div className="px-3 pb-5">{accountActions(true)}</div>
      </aside>
      <div className="min-w-0">
        <header
          className={
            isCourseWorkspace
              ? "sticky top-0 z-40 flex min-h-16 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6"
              : "sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6 lg:hidden"
          }
        >
          <BrandLink href={routes.studio.dashboard()} />
          <nav
            aria-label={common("studioNavigation")}
            className={isCourseWorkspace ? "hidden lg:block" : "hidden"}
          >
            <NavigationList items={navigation} pathname={pathname} />
          </nav>
          {isCourseWorkspace && scopePicker ? <div className="hidden w-48 shrink-0 xl:block">{scopePicker}</div> : null}
          <div className={isCourseWorkspace ? "hidden lg:block" : "hidden"}>
            {accountActions()}
          </div>
          <MenuButton
            ref={menuButtonRef}
            controls="studio-mobile-navigation"
            onClick={() => setDrawerOpen(true)}
          />
        </header>
        <MobileNavigationDrawer
          id="studio-mobile-navigation"
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={common("studioNavigation")}
          returnFocusRef={menuButtonRef}
        >
          <nav aria-label={common("studioNavigation")}>
            <NavigationList
              items={navigation}
              pathname={pathname}
              vertical
              onNavigate={() => setDrawerOpen(false)}
            />
          </nav>
          {entries ? <div className="mt-4 border-t border-border pt-4">{switcher(true)}</div> : null}
          {accountActions(true)}
        </MobileNavigationDrawer>
        {scopePicker ? <div className={isCourseWorkspace ? "border-b border-border px-4 py-3 xl:hidden" : "border-b border-border px-4 py-3 lg:hidden"}>
          {scopePicker}
        </div> : null}
        <main
          id="studio-main"
          className={
            isCourseWorkspace
              ? "min-w-0 px-3 py-3 sm:px-4 sm:py-4 lg:px-6"
              : "min-w-0 px-4 py-7 sm:px-6 lg:px-10 lg:py-10"
          }
        >
          {!isCourseWorkspace ? (
            <ShellBreadcrumbs pathname={pathname} items={navigation} />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Presentation rollout is selected on the server; permissions stay unchanged. */
export function StudioShell({ redesigned = false, ...props }: Parameters<typeof LegacyStudioShell>[0] & { redesigned?: boolean }) {
  return redesigned ? <StaffShell workspace="studio" {...props} /> : <LegacyStudioShell {...props} />;
}
