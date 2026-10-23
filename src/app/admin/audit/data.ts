import "server-only";

import { actorDisplayNames, type ActorDisplay } from "@/features/admin/actor-directory";
import type { AuditLogQuery } from "@/features/admin/audit-log";
import type { AdminContext } from "@/features/admin/context";
import { managementRead } from "@/features/admin/management";
import type { AdminAuditEntry } from "@/features/admin/management-contracts";

/** The audit operation returns at most this many rows per page (admin_management_read). */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Action families offered by the filter. The `audit` operation matches `action` as a
 * case-insensitive substring, so each family is its code prefix ("user." etc.). Roles are the
 * exception: "role" (no dot) matches definitions (role.create/update) and every assignment code
 * (user.role, user.role.set, user.role_granted, user.role_revoked) that audit-format.ts labels
 * as a role change.
 */
export const AUDIT_ACTION_FAMILIES = [
  "branch",
  "content",
  "course",
  "invitation",
  "profile",
  "project",
  "role",
  "submission",
  "user",
] as const;
export type AuditActionFamily = (typeof AUDIT_ACTION_FAMILIES)[number];

export function familyFilterValue(family: AuditActionFamily) {
  return family === "role" ? "role" : `${family}.`;
}

/** One page of the audit log in the current scope, plus display names for its actors. */
export async function auditLogPage(context: AdminContext, input: AuditLogQuery) {
  const rows = await managementRead<AdminAuditEntry[]>(context, "audit", input);
  const memberTargets = [...new Set(rows.filter((row) => row.targetType === "user").map((row) => row.targetId))];
  const [actors, members]: Map<string, ActorDisplay>[] = await Promise.all([
    actorDisplayNames([...rows.map((row) => row.actorId), input.actor]),
    // Member targets are named too, so a row reads "Role granted · Lê Thu Hà", not a UUID.
    memberTargets.length ? actorDisplayNames(memberTargets) : Promise.resolve(new Map<string, ActorDisplay>()),
  ]);
  // Schools the admin can see are already in the context; name branch targets from it.
  const schools = new Map((context.branches ?? []).map((branch) => [branch.id, branch.name]));
  const targetName = (type: string, id: string): string | undefined =>
    type === "user" ? members.get(id.toLowerCase())?.name : type === "branch" ? schools.get(id) : undefined;
  return { rows, actors, targetName, hasMore: rows.length === AUDIT_PAGE_SIZE };
}
