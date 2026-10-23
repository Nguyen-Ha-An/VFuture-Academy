import "server-only";
import { ApiError } from "@/lib/api";
import { can, effectivePermissions } from "@/lib/permissions";
import { getAdminContext, type AdminContext } from "./context";

/** Compatibility routes accept a branch filter, never a client-supplied actor. */
export async function legacyAdminContext(
  branchId?: string | null,
): Promise<AdminContext> {
  const context = await getAdminContext();
  if (!branchId) return context;
  const scope = { kind: "branch" as const, branchId };
  if (!can(context.actor, "admin.access", scope))
    throw new ApiError(403, "FORBIDDEN", "Permission denied");
  return {
    ...context,
    scope,
    permissions: effectivePermissions(context.actor, scope),
  };
}
