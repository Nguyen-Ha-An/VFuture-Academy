"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { StaffChrome } from "@/features/staff-ui/types";
import type { WorkspaceTheme } from "@/features/workspace-ui/theme";
import type { AdminScope, AdminScopeOption } from "@/lib/admin-scope";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import type { StaffNavigation } from "../navigation";
import { StaffUserMenu } from "./StaffUserMenu";
import { WorkspaceScopeSwitcher } from "./WorkspaceScopeSwitcher";

export type StaffSidebarProps = {
  workspace: StaffWorkspace;
  navigation: StaffNavigation;
  entries: WorkspaceEntries;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  identity: StaffChrome["identity"];
  theme: WorkspaceTheme;
};

/**
 * Contextual navigation content inside the native DrawerLayout.
 * Scope stays at the head, permission-filtered destinations in the middle, account at the foot.
 */
export function StaffSidebar({ workspace, navigation, entries, scopeOptions, activeScope, identity, theme }: StaffSidebarProps) {
  const common = useTranslations("common");
  const { isMobile, setOpenMobile, setOpen } = useSidebar();
  return (
    <Sidebar collapsible="none" className="canvas-context-navigation">
      <SidebarHeader className="box-content h-14 flex-row items-center gap-1 border-b border-sidebar-border py-0">
        <div className="min-w-0 flex-1">
          <WorkspaceScopeSwitcher workspace={workspace} entries={entries} scopeOptions={scopeOptions} activeScope={activeScope} />
        </div>
        {(
          <button type="button" onClick={() => isMobile ? setOpenMobile(false) : setOpen(false)}
            aria-label={common("close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
          >
            <XIcon aria-hidden="true" />
          </button>
        )}
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={navigation.label}>
          {navigation.groups.map((group) => (
            <SidebarGroup key={group.key}>
              {group.label ? <SidebarGroupLabel className="leading-[1.4]">{group.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton asChild isActive={item.active} tooltip={item.label} className="leading-[1.4] md:h-7">
                          <Link href={item.href} aria-current={item.active ? "page" : undefined} onClick={() => { if (isMobile) setOpenMobile(false); else if (window.innerWidth < 1024) setOpen(false); }}>
                            <Icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <StaffUserMenu identity={identity} workspace={workspace} theme={theme} entries={entries} />
      </SidebarFooter>
    </Sidebar>
  );
}
