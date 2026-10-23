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
import { AdminScopeSelector } from "@/features/admin/components/AdminScopeSelector";
import type { AdminScope, AdminScopeOption } from "@/lib/admin-scope";
import { gradingNavigation } from "@/lib/grading-navigation";
import { shellNavigation } from "@/lib/workspace-navigation";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";

/** Shell for `Khảo thí & đánh giá` — assessments, grading queues and reports. */
function LegacyGradingShell({
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
  const t = useTranslations("gradingNav");
  const common = useTranslations("common");
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigation = useMemo<ShellNavItem[]>(
    () =>
      shellNavigation(
        gradingNavigation.filter(
          (item) =>
            item.available &&
            item.permissions.some((permission) => permissions.includes(permission)),
        ),
        (key) => t(key),
      ),
    [permissions, t],
  );
  const switcher = (stacked = false) => entries
    ? <WorkspaceSwitcher entries={entries} active="grading" stacked={stacked} onNavigate={() => setDrawerOpen(false)} />
    : null;
  const scopePicker =
    activeScope && scopeOptions ? (
      <AdminScopeSelector
        options={scopeOptions}
        active={activeScope}
        endpoint="/api/v1/grading/scope"
        destination={routes.grading.dashboard()}
      />
    ) : null;

  useEffect(() => {
    setDrawerOpen(false);
    const heading = document.querySelector<HTMLElement>("#grading-main h1");
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
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#grading-main"
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        {common("skipToContent")}
      </a>
      <aside className="hidden min-h-screen border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex min-h-16 items-center border-b border-border px-5">
          <BrandLink href={routes.grading.dashboard()} />
        </div>
        {entries ? <div className="border-b border-border px-2 py-3">{switcher(true)}</div> : null}
        {scopePicker ? <div className="px-3 pt-4">{scopePicker}</div> : null}
        <nav
          aria-label={common("gradingNavigation")}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
        >
          <NavigationList items={navigation} pathname={pathname} vertical />
        </nav>
        <div className="px-3 pb-5">{accountActions(true)}</div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6 lg:hidden">
          <BrandLink href={routes.grading.dashboard()} />
          <MenuButton
            ref={menuButtonRef}
            controls="grading-mobile-navigation"
            onClick={() => setDrawerOpen(true)}
          />
        </header>
        <MobileNavigationDrawer
          id="grading-mobile-navigation"
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={common("gradingNavigation")}
          returnFocusRef={menuButtonRef}
        >
          <nav aria-label={common("gradingNavigation")}>
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
        {scopePicker ? (
          <div className="border-b border-border px-4 py-3 lg:hidden">{scopePicker}</div>
        ) : null}
        <main id="grading-main" className="min-w-0 px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          <ShellBreadcrumbs pathname={pathname} items={navigation} />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Presentation rollout is selected on the server; permissions stay unchanged. */
export function GradingShell({ redesigned = false, ...props }: Parameters<typeof LegacyGradingShell>[0] & { redesigned?: boolean }) {
  return redesigned ? <StaffShell workspace="grading" {...props} /> : <LegacyGradingShell {...props} />;
}
