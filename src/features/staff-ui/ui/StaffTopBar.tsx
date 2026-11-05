"use client";

import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { WorkspaceTheme } from "@/features/workspace-ui/theme";
import { scopeKey, type AdminScope, type AdminScopeOption } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import type { StaffNavigation } from "../navigation";
import { AttentionPopover } from "./AttentionPopover";
import { StaffBreadcrumbs } from "./StaffBreadcrumbs";
import { StaffCommandMenu } from "./StaffCommandMenu";

export type StaffTopBarProps = {
  workspace: StaffWorkspace;
  permissions: Permission[];
  entries: WorkspaceEntries;
  activeScope?: AdminScope;
  scopeOptions?: AdminScopeOption[];
  theme: WorkspaceTheme;
  pathname: string;
  navigation: StaffNavigation;
  /** Record title registered by the page for the last crumb. */
  currentTitle?: string;
  triggerRef?: Ref<HTMLButtonElement>;
};

/** Contents of the 56px banner: sidebar trigger, breadcrumbs, then search and attention on the right. Preferences live in Account. */
export function StaffTopBar({ workspace, permissions, entries, activeScope, scopeOptions, pathname, navigation, currentTitle, triggerRef }: StaffTopBarProps) {
  const common = useTranslations("common");
  const shell = useTranslations("staffUi.shell.core");
  const { isMobile, open } = useSidebar();
  const central = useTranslations("centralAdmin");
  const activeOption = activeScope ? scopeOptions?.find(option => scopeKey(option.scope) === scopeKey(activeScope)) : undefined;
  const scopeLabel = activeScope?.kind === "central" ? central("central") : activeOption?.label ?? (activeScope?.kind === "branch" ? activeScope.branchId : undefined);
  const showScope = Boolean(scopeLabel && (isMobile || !open));
  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-2">
      <SidebarTrigger
        ref={triggerRef}
        label={isMobile ? common("menu") : shell("toggleSidebar")}
        aria-haspopup={isMobile ? "dialog" : undefined}
        className="-ml-1 size-8 text-muted-foreground hover:text-foreground"
      />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="min-w-0 flex flex-col gap-0.5">
        <StaffBreadcrumbs pathname={pathname} navigation={navigation} currentTitle={currentTitle} />
        {showScope ? <p data-slot="active-write-scope" className="m-0 truncate text-xs leading-tight text-muted-foreground" title={`${central("scope")}: ${scopeLabel}`}><span className="sr-only">{central("scope")}: </span>{scopeLabel}</p> : null}
      </div>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        <StaffCommandMenu workspace={workspace} permissions={permissions} entries={entries} />
        <AttentionPopover workspace={workspace} permissions={permissions} activeScope={activeScope} />
      </div>
    </div>
  );
}
