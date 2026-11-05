"use client";

import { XIcon } from "lucide-react";
import type { SyntheticEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
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
import { GlobalNavigation } from "@/features/canvas/ui/GlobalNavigation";
import { ACCOUNT_TRAY_ID } from "@/features/canvas/ui/AccountTray";
import { WorkspaceScopeSwitcher } from "./WorkspaceScopeSwitcher";

export type StaffSidebarProps = {
  workspace: StaffWorkspace;
  navigation: StaffNavigation;
  entries: WorkspaceEntries;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  identity: StaffChrome["identity"];
  theme: WorkspaceTheme;
  onAccount?: () => void;
  accountOpen?: boolean;
  onNavigateRequest?: (href: string, closeOverlay?: () => void) => void;
};

/**
 * Contextual navigation content inside the native DrawerLayout.
 * Scope stays at the head; global workspace/account access appears here only when the rail is hidden.
 */
export function StaffSidebar({ workspace, navigation, entries, scopeOptions, activeScope, onAccount, accountOpen, onNavigateRequest }: StaffSidebarProps) {
  const common = useTranslations("common");
  const { isMobile, setOpenMobile, setOpen } = useSidebar();
  const navigate = (event: SyntheticEvent<unknown>, href: string) => {
    // Preserve native modified/new-tab navigation and the dirty original tab.
    if (event.defaultPrevented || ('button' in event && event.button !== 0)
      || ('metaKey' in event && event.metaKey) || ('ctrlKey' in event && event.ctrlKey)
      || ('altKey' in event && event.altKey) || ('shiftKey' in event && event.shiftKey)) return;
    if (!onNavigateRequest) { if (isMobile) setOpenMobile(false); else if (window.innerWidth < 1024) setOpen(false); return; }
    const close = isMobile ? () => setOpenMobile(false) : window.innerWidth < 1024 ? () => setOpen(false) : undefined;
    const destination = new URL(href, window.location.href);
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) { close?.(); return; }
    event.preventDefault();
    onNavigateRequest(href, close);
  };
  return (
    <Sidebar collapsible="none" className="canvas-context-navigation">
      <SidebarHeader className="flex-row items-start gap-1 border-b border-sidebar-border py-3">
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
        {isMobile && <div className="canvas-staff-mobile-global"><GlobalNavigation studio={entries.studio} grading={entries.grading} admin={entries.admin} mobile
          onNavigate={() => setOpenMobile(false)} onNavigateRequest={onNavigateRequest ? navigate : undefined} onAccount={onAccount ? () => { onAccount(); setOpenMobile(false); } : undefined}
          accountOpen={accountOpen} accountControls={ACCOUNT_TRAY_ID} /></div>}
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
                          <Link href={item.href} data-academy-managed-navigation={onNavigateRequest ? 'true' : undefined} aria-current={item.active ? "page" : undefined} onClick={event => navigate(event, item.href)}>
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
    </Sidebar>
  );
}
