"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CheckIcon, ChevronsUpDownIcon, ClipboardCheckIcon, PenLineIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScopeSwitchingOverlay } from "@/features/admin/components/AdminScopeSelector";
import { useScopeChange } from "@/features/workspace/useScopeChange";
import { scopeKey, type AdminScope, type AdminScopeOption } from "@/lib/admin-scope";
import { cn } from "@/lib/ui-cn";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import { STAFF_WORKSPACES, type StaffWorkspace } from "@/lib/workspaces";

/** Same labels as the legacy WorkspaceSwitcher. */
const LABEL_KEY = {
  studio: "workspaceStudio",
  grading: "workspaceGrading",
  admin: "workspaceAdmin",
} as const satisfies Record<StaffWorkspace, string>;

const WORKSPACE_ICON = {
  studio: PenLineIcon,
  grading: ClipboardCheckIcon,
  admin: ShieldCheckIcon,
} as const satisfies Record<StaffWorkspace, LucideIcon>;

/** Placeholder scope for workspaces without scopes; the hook never switches without options. */
const NO_SCOPE: AdminScope = { kind: "central" };

export type WorkspaceScopeSwitcherProps = {
  workspace: StaffWorkspace;
  entries: WorkspaceEntries;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
};

/**
 * The team switcher at the top of the staff sidebar: brand tile, current workspace and
 * scope. One click lists every workspace the actor may enter (entries are resolved on
 * the server across scopes) and the scopes of this workspace. With a single workspace
 * and a single scope it is a static header.
 */
export function WorkspaceScopeSwitcher({ workspace, entries, scopeOptions, activeScope }: WorkspaceScopeSwitcherProps) {
  const common = useTranslations("common");
  const central = useTranslations("centralAdmin");
  const { isMobile, state } = useSidebar();
  const { changeScope, pending, error, switching } = useScopeChange(workspace, { active: activeScope ?? NO_SCOPE });
  const [open, setOpen] = useState(false);
  // Controlled tooltip: never mounted while hidden, so it can't swallow Escape in the drawer.
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const workspaces = STAFF_WORKSPACES.flatMap((candidate) => {
    const href = entries[candidate];
    return href ? [{ workspace: candidate, href }] : [];
  });
  const scopes = activeScope && scopeOptions ? scopeOptions : [];
  const activeKey = activeScope ? scopeKey(activeScope) : undefined;
  const labelFor = (option: AdminScopeOption) => (option.scope.kind === "central" ? central("central") : option.label);
  const activeOption = scopes.find((option) => scopeKey(option.scope) === activeKey);
  const workspaceLabel = common(LABEL_KEY[workspace]);
  const scopeLabel = activeOption ? labelFor(activeOption) : activeScope?.kind === "central" ? central("central") : undefined;
  const summary = scopeLabel ? `${workspaceLabel} · ${scopeLabel}` : workspaceLabel;
  const showWorkspaces = workspaces.length >= 2;
  const showScopes = scopes.length >= 2;
  const hideTooltip = state !== "collapsed" || isMobile;

  const identity = (
    <>
      <span
        aria-hidden="true"
        className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-semibold text-brand-foreground"
      >
        VF
      </span>
      <span className="grid min-w-0 flex-1 text-left">
        <span className="truncate text-sm font-semibold leading-[1.4]">{workspaceLabel}</span>
        {scopeLabel ? <span className="truncate text-xs leading-[1.4] text-muted-foreground">{scopeLabel}</span> : null}
      </span>
    </>
  );

  let header: ReactNode;
  if (!showWorkspaces && !showScopes) {
    header = (
      <Tooltip open={!hideTooltip && tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <div
            data-slot="workspace-scope-header"
            className="flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-sm text-sidebar-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
          >
            {identity}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" align="center">{summary}</TooltipContent>
      </Tooltip>
    );
  } else {
    header = (
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        {/* Tooltip wraps the menu trigger so the menu's data-state (open styling) wins. */}
        <Tooltip open={!hideTooltip && !open && tooltipOpen} onOpenChange={setTooltipOpen}>
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <SidebarMenuButton
                size="lg"
                aria-busy={pending || undefined}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                {identity}
                <ChevronsUpDownIcon aria-hidden="true" className="ml-auto text-muted-foreground" />
              </SidebarMenuButton>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent side="right" align="center">{summary}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side={isMobile ? "bottom" : "right"}
          align="start"
          sideOffset={4}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
        >
          {showWorkspaces ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium leading-[1.4] text-muted-foreground">{common("workspaces")}</DropdownMenuLabel>
              {workspaces.map(({ workspace: candidate, href }) => {
                const Icon = WORKSPACE_ICON[candidate];
                const current = candidate === workspace;
                return (
                  <DropdownMenuItem key={candidate} asChild>
                    <Link href={href} aria-current={current ? "true" : undefined} className="leading-[1.4]">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border">
                        <Icon aria-hidden="true" className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{common(LABEL_KEY[candidate])}</span>
                      {current ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ) : null}
          {showWorkspaces && showScopes ? <DropdownMenuSeparator /> : null}
          {showScopes ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium leading-[1.4] text-muted-foreground">{central("scope")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={activeKey} onValueChange={(value) => void changeScope(value)}>
                {scopes.map((option) => (
                  <DropdownMenuRadioItem
                    key={scopeKey(option.scope)}
                    value={scopeKey(option.scope)}
                    disabled={pending}
                    className="leading-[1.4]"
                  >
                    <span className="min-w-0 truncate">{labelFor(option)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>{header}</SidebarMenuItem>
      </SidebarMenu>
      <div aria-live="polite" className={cn(error && "px-2 group-data-[collapsible=icon]:sr-only")}>
        {error ? <p className="text-xs leading-[1.4] text-destructive">{central("scopeError")}</p> : null}
      </div>
      {/*
        * Desktop: portalled to <body>, because the sidebar container is `fixed z-10` (a stacking
        * context) and would cap the overlay under the sticky top bar. Phone: inline, so it stays
        * inside the modal drawer (itself topmost, no ancestor transforms) and its focus trap.
        */}
      {switching ? (isMobile ? <ScopeSwitchingOverlay /> : createPortal(<ScopeSwitchingOverlay />, document.body)) : null}
    </>
  );
}
