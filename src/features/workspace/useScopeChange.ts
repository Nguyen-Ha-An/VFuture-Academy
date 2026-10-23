"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestNavigation } from "@/lib/navigation-guard";
import { scopeKey, type AdminScope } from "@/lib/admin-scope";
import { workspaceHome, type StaffWorkspace } from "@/lib/workspaces";

export type ScopeChangeOptions = {
  /** The scope the server currently has active; choosing it again does nothing. */
  active: AdminScope;
  /** Defaults to `/api/v1/{workspace}/scope`. */
  endpoint?: string;
  /** Where to land once the scope is stored; defaults to the workspace home. */
  destination?: string;
};

export type ScopeChange = {
  /** Switches to a scope key (`central` or `branch:<id>`) or scope. */
  changeScope: (scope: string | AdminScope) => Promise<void>;
  /** True from the choice until the switch fails or is cancelled (the page remounts on success). */
  pending: boolean;
  /** True after the server rejected the scope or the request failed. */
  error: boolean;
  /** True once the guard allowed the switch; cover the page until the new layout mounts. */
  switching: boolean;
};

/**
 * Scope switching shared by the legacy scope select and the staff workspace switcher:
 * unsaved-changes guard, then POST the scope, then replace + refresh so the
 * server-authorized layout remounts. A second choice while one is in flight is ignored.
 */
export function useScopeChange(workspace: StaffWorkspace, { active, endpoint, destination }: ScopeChangeOptions): ScopeChange {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const transitionRef = useRef(false);
  const url = endpoint ?? `/api/v1/${workspace}/scope`;
  const landing = destination ?? workspaceHome(workspace);
  const activeKey = scopeKey(active);

  const changeScope = useCallback(async (next: string | AdminScope) => {
    const scope = typeof next === "string" ? next : scopeKey(next);
    if (transitionRef.current || scope === activeKey) return;
    transitionRef.current = true;
    setPending(true);
    setError(false);
    try {
      // Resolve the editor's Save / Stay / Discard decision before changing
      // the server scope. Keep the editor and its dialog visible meanwhile.
      if (!(await requestNavigation())) {
        transitionRef.current = false;
        setPending(false);
        return;
      }
      setSwitching(true);
      const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!response.ok) throw new Error("scope_rejected");
      // Remain covered until the new server-authorized layout remounts.
      router.replace(landing);
      router.refresh();
    } catch {
      setError(true);
      setPending(false);
      setSwitching(false);
      transitionRef.current = false;
    }
  }, [activeKey, landing, router, url]);

  return { changeScope, pending, error, switching };
}
