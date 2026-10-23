"use client";

import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { WorkspaceTheme } from "@/features/workspace-ui/theme";
import type { AdminScope } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import type { StaffNavigation } from "../navigation";
import { AttentionPopover } from "./AttentionPopover";
import { StaffBreadcrumbs } from "./StaffBreadcrumbs";
import { StaffCommandMenu } from "./StaffCommandMenu";
import { StaffThemeMenu } from "./StaffThemeMenu";

export type StaffTopBarProps = {
  workspace: StaffWorkspace;
  permissions: Permission[];
  entries: WorkspaceEntries;
  activeScope?: AdminScope;
  theme: WorkspaceTheme;
  pathname: string;
  navigation: StaffNavigation;
  /** Record title registered by the page for the last crumb. */
  currentTitle?: string;
  triggerRef?: Ref<HTMLButtonElement>;
};

/** Contents of the 56px banner: sidebar trigger, breadcrumbs, then search, attention and theme on the right. */
export function StaffTopBar({ workspace, permissions, entries, activeScope, theme, pathname, navigation, currentTitle, triggerRef }: StaffTopBarProps) {
  const common = useTranslations("common");
  const shell = useTranslations("staffUi.shell.core");
  const { isMobile } = useSidebar();
  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-2">
      <SidebarTrigger
        ref={triggerRef}
        label={isMobile ? common("menu") : shell("toggleSidebar")}
        aria-haspopup={isMobile ? "dialog" : undefined}
        className="-ml-1 size-8 text-muted-foreground hover:text-foreground"
      />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <StaffBreadcrumbs pathname={pathname} navigation={navigation} currentTitle={currentTitle} />
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        <StaffCommandMenu workspace={workspace} permissions={permissions} entries={entries} />
        <AttentionPopover workspace={workspace} permissions={permissions} activeScope={activeScope} />
        <StaffThemeMenu theme={theme} />
      </div>
    </div>
  );
}
