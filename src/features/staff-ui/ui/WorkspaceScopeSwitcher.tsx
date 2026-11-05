"use client";

import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useSidebar } from "@/components/ui/sidebar";
import { CanvasSelect } from "@/features/canvas/ui";
import { ScopeSwitchingOverlay } from "@/features/admin/components/AdminScopeSelector";
import { useStaffScopeTransition } from "./StaffScopeTransitionContext";
import type { ScopeChange } from "@/features/workspace/useScopeChange";
import { useScopeChange } from "@/features/workspace/useScopeChange";
import { scopeKey, type AdminScope, type AdminScopeOption } from "@/lib/admin-scope";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";

const NO_SCOPE: AdminScope = { kind: "central" };

export type WorkspaceScopeSwitcherProps = {
  workspace: StaffWorkspace;
  /** Admission destinations remain owned by global navigation. */
  entries: WorkspaceEntries;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
};

/** School selection only. All choices come from the server-authorized scope list. */
export function WorkspaceScopeSwitcher(props: WorkspaceScopeSwitcherProps) {
  const shared = useStaffScopeTransition();
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  if (shared) return <ScopeSelectorView {...props} state={{ ...shared.state, pending: shared.state.pending || shared.queued }} onRequest={value => {
    const overlay = isMobile || shared.compact;
    const visible = isMobile ? openMobile : open;
    shared.request(value, overlay && visible ? () => isMobile ? setOpenMobile(false) : setOpen(false) : undefined);
  }} />;
  return <StandaloneScopeSwitcher {...props} />;
}

function StandaloneScopeSwitcher(props: WorkspaceScopeSwitcherProps) {
  const state = useScopeChange(props.workspace, { active: props.activeScope ?? NO_SCOPE });
  const { isMobile } = useSidebar();
  return <><ScopeSelectorView {...props} state={state} onRequest={value => void state.changeScope(value)} />
    {state.switching ? (isMobile ? <ScopeSwitchingOverlay /> : createPortal(<ScopeSwitchingOverlay />, document.body)) : null}</>;
}

function ScopeSelectorView({ scopeOptions, activeScope, state, onRequest }: WorkspaceScopeSwitcherProps & { state: ScopeChange; onRequest: (scope: string) => void }) {
  const central = useTranslations("centralAdmin");
  const { pending, error } = state;
  const scopes = activeScope && scopeOptions ? scopeOptions : [];
  const activeKey = activeScope ? scopeKey(activeScope) : undefined;
  const labelFor = (option: AdminScopeOption) => option.scope.kind === "central" ? central("central") : option.label;
  const activeOption = scopes.find(option => scopeKey(option.scope) === activeKey);
  const scopeLabel = activeOption ? labelFor(activeOption) : activeScope?.kind === "central" ? central("central") : undefined;
  const selectable = scopes.length >= 2;

  return <>
    {selectable ? <div className="min-w-0 w-full" aria-live="polite" aria-busy={pending || undefined} data-slot="workspace-scope-selector">
      <CanvasSelect
        label={central("scope")}
        size="small"
        value={activeKey}
        disabled={pending}
        options={scopes.map(option => ({ value: scopeKey(option.scope), label: labelFor(option) }))}
        onChange={value => { if (!pending && scopes.some(option => scopeKey(option.scope) === value)) onRequest(value); }}
        messages={error ? [{ type: 'error', text: central("scopeError") }] : undefined}
      />
    </div> : scopeLabel ? <div data-slot="workspace-scope-header" className="min-w-0 px-2 py-1">
      <p className="text-xs leading-normal text-muted-foreground">{central("scope")}</p>
      <p className="truncate text-sm leading-normal font-medium" title={scopeLabel}>{scopeLabel}</p>
    </div> : null}
    <div aria-live="polite">{!selectable && error ? <p className="text-xs leading-normal text-destructive">{central("scopeError")}</p> : null}</div>
  </>;
}
