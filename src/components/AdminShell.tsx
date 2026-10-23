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
import { adminGroups, adminNavigation } from "@/lib/admin-navigation";
import type { AdminScope, AdminScopeOption } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";

type Props = {
  children: React.ReactNode;
  permissions: Permission[];
  userName?: string;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  entries?: WorkspaceEntries;
};

function LegacyAdminShell({
  children,
  permissions,
  userName,
  scopeOptions,
  activeScope,
  entries,
}: Props) {
  const t = useTranslations("adminNav");
  const common = useTranslations("common");
  const central = useTranslations("centralAdmin");
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigation = useMemo(
    () =>
      adminNavigation.filter(
        (item) =>
          item.key === "overview" ||
          (item.key === "users" && activeScope ? permissions.includes("member.read")
            : item.permissions.some((permission) =>
                (permissions as readonly string[]).includes(permission),
              )),
      ),
    [permissions, activeScope],
  );
  const items = useMemo<ShellNavItem[]>(
    () =>
      navigation.map((item) => ({
        key: item.key,
        href: item.href,
        label: t(item.key),
      })),
    [navigation, t],
  );
  useEffect(() => {
    setDrawerOpen(false);
    const heading = document.querySelector<HTMLElement>("#admin-main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [pathname]);
  const switcher = (stacked = false) => entries
    ? <WorkspaceSwitcher entries={entries} active="admin" stacked={stacked} onNavigate={() => setDrawerOpen(false)} />
    : null;
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
  const scopes = scopeOptions?.map((option) =>
    option.scope.kind === "central"
      ? { ...option, label: central("central") }
      : option,
  );
  const scopePicker =
    activeScope && scopes ? (
      <AdminScopeSelector options={scopes} active={activeScope} />
    ) : null;
  const navigationGroups = () =>
    adminGroups.map((group) => {
      const groupItems = items.filter(
        (item) =>
          adminNavigation.find((candidate) => candidate.key === item.key)
            ?.group === group,
      );
      return groupItems.length ? (
        <section key={group} className="mb-5 last:mb-0">
          <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t(group)}
          </h2>
          <NavigationList
            items={groupItems}
            pathname={pathname}
            vertical
            onNavigate={() => setDrawerOpen(false)}
          />
        </section>
      ) : null;
    });
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#admin-main"
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background focus:translate-y-0"
      >
        {common("skipToContent")}
      </a>
      <aside className="hidden min-h-screen border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex min-h-16 items-center border-b border-border px-5">
          <BrandLink href={routes.admin.dashboard()} />
        </div>
        {entries ? <div className="border-b border-border px-2 py-3">{switcher(true)}</div> : null}
        <div className="border-b border-border p-4">{scopePicker}</div>
        <nav
          aria-label={t("navigation")}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
        >
          {navigationGroups()}
        </nav>
        <div className="px-3 pb-5">{accountActions(true)}</div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:hidden">
          <BrandLink href={routes.admin.dashboard()} />
          <MenuButton
            ref={menuButtonRef}
            controls="admin-mobile-navigation"
            onClick={() => setDrawerOpen(true)}
          />
        </header>
        <div className="border-b border-border px-4 py-3 lg:hidden">
          {scopePicker}
        </div>
        <MobileNavigationDrawer
          id="admin-mobile-navigation"
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={t("navigation")}
          returnFocusRef={menuButtonRef}
        >
          <nav aria-label={t("navigation")}>{navigationGroups()}</nav>
          {entries ? <div className="mt-4 border-t border-border pt-4">{switcher(true)}</div> : null}
          {accountActions(true)}
        </MobileNavigationDrawer>
        <main
          id="admin-main"
          className="min-w-0 px-4 py-7 sm:px-6 lg:px-10 lg:py-10"
        >
          <ShellBreadcrumbs pathname={pathname} items={items} />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Presentation rollout is selected on the server; permissions stay unchanged. */
export function AdminShell({ redesigned = false, ...props }: Parameters<typeof LegacyAdminShell>[0] & { redesigned?: boolean }) {
  return redesigned ? <StaffShell workspace="admin" {...props} /> : <LegacyAdminShell {...props} />;
}
