import "server-only";

import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { loginDestination } from "@/lib/auth";
import { cache } from "react";
import { ApiError } from "@/lib/api";
import {
  ADMIN_SCOPE_COOKIE,
  scopeKey,
  selectAdminScope,
  type AdminScope,
  type AdminScopeOption,
} from "@/lib/admin-scope";
import {
  getActor,
  can,
  canAccessAdmin,
  effectivePermissions,
  type Actor,
  type Permission,
} from "@/lib/permissions";
import { supabaseService } from "@/lib/supabase/server";
import { canEnter, workspaceEntries } from "@/lib/workspace-admission";
import { firstWorkspaceDestination, type WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import { createSupabaseBranchRepository, type Branch } from "./branches";

export type AdminContext = {
  workspace: StaffWorkspace;
  actor: Actor;
  scope: AdminScope;
  options: AdminScopeOption[];
  permissions: Permission[];
  branches: Branch[];
  /** Destinations for every workspace the actor may enter, across all scopes. */
  entries: WorkspaceEntries;
};

type AdminAdmission = {
  /**
   * `strict` keeps administration APIs and management pages behind
   * `admin.access`. `destination` admits a scope that reaches any authorized
   * Administration destination, so a `course.publish` publisher can open
   * enrollment-version migration without gaining general admin authority.
   */
  admit: "strict" | "destination";
  denied: string;
};

/** Scopes that hold `admin.access`, used to keep the strict admission exact. */
function administeredScope(actor: Actor, scope: AdminScope): boolean {
  return can(actor, "admin.access", scope);
}

function reachesAdminDestination(actor: Actor, scope: AdminScope): boolean {
  return firstWorkspaceDestination("admin", effectivePermissions(actor, scope)) !== null;
}

async function resolveAdminContext(admission: AdminAdmission): Promise<AdminContext> {
  const actor = await getActor();
  if (!actor)
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  const admits = (scope: AdminScope) =>
    admission.admit === "strict"
      ? administeredScope(actor, scope)
      : reachesAdminDestination(actor, scope);
  if (admission.admit === "strict" ? !canAccessAdmin(actor) : !canEnter(actor, "admin"))
    throw new ApiError(403, "FORBIDDEN", admission.denied);
  const allBranches =
    await createSupabaseBranchRepository(supabaseService()).list();
  const branches = allBranches.filter((branch) =>
    admits({ kind: "branch", branchId: branch.id }),
  );
  const candidates: { scope: AdminScope; label: string }[] = [];
  if (admits({ kind: "central" }))
    candidates.push({ scope: { kind: "central" }, label: "Central" });
  candidates.push(
    ...branches.map((branch) => ({
      scope: { kind: "branch" as const, branchId: branch.id },
      label: branch.name,
    })),
  );
  const options = candidates.map((option) => ({
    ...option,
    permissions: effectivePermissions(actor, option.scope),
  }));
  const preference = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value;
  // Without a stored preference, prefer a scope that also holds `admin.access`
  // so the shell and the strict management pages agree on the active scope.
  const ordered = [
    ...options.filter((option) => administeredScope(actor, option.scope)),
    ...options.filter((option) => !administeredScope(actor, option.scope)),
  ];
  const scope = selectAdminScope(
    ordered.map((option) => option.scope),
    preference,
  );
  if (!scope)
    throw new ApiError(403, "FORBIDDEN", "No active management scope");
  return {
    workspace: "admin",
    actor,
    scope,
    options,
    permissions: effectivePermissions(actor, scope),
    branches,
    entries: workspaceEntries(actor),
  };
}

/** Strict Administration context for management pages and every Admin API. */
export const getAdminContext = cache(() =>
  resolveAdminContext({ admit: "strict", denied: "Administration access denied" }),
);

/**
 * Admission for the Administration shell. Any authorized Administration
 * destination opens the workspace; each page and API keeps its own action gate.
 */
export const getAdminWorkspaceContext = cache(() =>
  resolveAdminContext({ admit: "destination", denied: "Administration access denied" }),
);

export function assertAdminPermission(
  context: AdminContext,
  permission: Permission,
): void {
  if (!can(context.actor, permission, context.scope))
    throw new ApiError(403, "FORBIDDEN", "Permission denied");
}

/** Explicit query scope never silently broadens the active authorized workspace. */
export function assertRequestScope(
  context: AdminContext,
  request: Request,
): void {
  const params = new URL(request.url).searchParams;
  const expectedActor = params.get("actorId");
  if (expectedActor && expectedActor !== context.actor.userId)
    throw new ApiError(
      409,
      "ACTOR_CHANGED",
      "Your signed-in account changed. Reload this workspace.",
    );
  const requested = params.get("scope");
  if (requested !== null && requested !== scopeKey(context.scope)) {
    throw new ApiError(
      409,
      "SCOPE_CHANGED",
      "The active management scope changed. Reload this workspace.",
    );
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== new URL(request.url).origin)
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Cross-origin administration request denied",
    );
  }
}

async function pageContext(
  load: () => Promise<AdminContext>,
  permission?: Permission,
): Promise<AdminContext> {
  try {
    const context = await load();
    if (permission) assertAdminPermission(context, permission);
    return context;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(await loginDestination());
    if (error instanceof ApiError && error.status === 403) forbidden();
    throw error;
  }
}

export function adminPageContext(
  permission?: Permission,
): Promise<AdminContext> {
  return pageContext(getAdminContext, permission);
}

/** Shell-level admission. Pages still call adminPageContext for their action gate. */
export function adminWorkspacePageContext(
  permission?: Permission,
): Promise<AdminContext> {
  return pageContext(getAdminWorkspaceContext, permission);
}
