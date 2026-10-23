import { ApiError } from "@/lib/api";
import type { Role } from "@/lib/authorization";
import type { MemberSummary } from "./management-contracts";

const names: Record<string, Role> = {
  central_admin: "admin",
  central_editor: "editor",
  school_admin: "branch_lead",
  school_editor: "editor",
  teacher: "instructor",
};
export function legacyRoleName(id: string): Role | null {
  if (names[id]) return names[id];
  const match =
    /^legacy_(contributor|editor|instructor|branch_lead|admin)_(central|branch)$/.exec(
      id,
    );
  return match ? (match[1] as Role) : null;
}
/** Custom assignments remain available in the additive assignments field. */
export function legacyUser(member: MemberSummary) {
  return {
    ...member,
    roles: member.assignments.flatMap((assignment) => {
      const role = legacyRoleName(assignment.roleId);
      return role
        ? [
            {
              role,
              branchId:
                assignment.scope.kind === "branch"
                  ? assignment.scope.branchId
                  : null,
            },
          ]
        : [];
    }),
  };
}
export function legacyGrantDefinition(
  role: Role,
  branchId: string | null,
): string {
  if (role === "admin") return branchId ? "school_admin" : "central_admin";
  if (role === "editor" && !branchId) return "central_editor";
  if (role === "instructor" && branchId) return "teacher";
  if (role === "branch_lead" && branchId) return "school_admin";
  throw new ApiError(
    400,
    "LEGACY_ROLE_UNSUPPORTED",
    "Use Roles & permissions in Admin to assign this role explicitly",
  );
}
