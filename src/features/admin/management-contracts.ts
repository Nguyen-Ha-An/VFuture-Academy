import type { Permission } from "@/lib/authorization";
import type { AdminScope } from "@/lib/admin-scope";

export type ManagedRoleDefinition = {
  id: string;
  name: string;
  description: string;
  scopeKind: "central" | "branch";
  permissions: Permission[];
  builtIn: boolean;
  grantableBySchool: boolean;
  version: number;
  assignmentCount: number;
};
export type ManagedAssignment = {
  id: string;
  roleId: string;
  roleName: string;
  scope: AdminScope;
  grantedAt: string;
  grantedBy: string | null;
};
export type ManagedMembership = {
  branchId: string;
  branchName: string;
  status: "active" | "suspended";
  isPrimary: boolean;
};
export type MemberSummary = {
  id: string;
  displayName: string;
  handle: string | null;
  email: string;
  branchId: string | null;
  accountStatus: "active" | "suspended";
  createdAt: string;
  memberships: ManagedMembership[];
  assignments: ManagedAssignment[];
};
export type MemberPage = {
  items: MemberSummary[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};
export type MemberLearning = {
  courseId: string;
  courseVersionId: string;
  title: string;
  /** Localized course title resolved from this historical course version when available. */
  displayTitle?: string;
  status: string;
  completedLessons: number;
  examAveragePercent?: number | null;
  totalLessons: number;
  branchId: string | null;
};
export type MemberExamResult = {
  id: string;
  courseVersionId: string;
  itemId: string;
  /** Localized title resolved from this historical course version when available. */
  displayTitle?: string;
  status: string;
  submittedAt: string | null;
  branchId: string | null;
  percent: number | null;
};
export type MemberSubmission = {
  id: string;
  courseVersionId: string;
  itemId: string;
  /** Localized title resolved from this historical course version when available. */
  displayTitle?: string;
  status: string;
  submittedAt: string;
  branchId: string | null;
  percent: number | null;
};
export type AdminAuditEntry = {
  id: string;
  action: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  at: string;
  before?: unknown;
  after?: unknown;
};
/** A person named next to an action (history actor, role grantor). */
export type MemberActor = { name: string; initials: string; avatarUrl: string | null };
export type MemberDetail = MemberSummary & {
  /** Display names keyed by lower-cased user id, for history actors and role grantors; ids without a usable profile are absent. */
  actors?: Record<string, MemberActor>;
  learning?: MemberLearning[];
  submissions?: MemberSubmission[];
  examResults?: MemberExamResult[];
  history?: AdminAuditEntry[];
  effectivePermissions: { scope: AdminScope; permissions: Permission[] }[];
  actions: {
    editIdentity: boolean;
    transfer: boolean;
    suspendAccount: boolean;
    manageMembership: boolean;
    assignRole: boolean;
    readLearning: boolean;
    readSubmissions: boolean;
    readHistory: boolean;
  };
};
export type ManagedInvitation = {
  id: string;
  email: string;
  branchId: string;
  roleId: string | null;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
};
export type InvitationCreated = ManagedInvitation & { inviteUrl: string };
export type ManagementOptions = {
  scope: AdminScope;
  branches: { id: string; name: string }[];
  roles: ManagedRoleDefinition[];
  permissions: Permission[];
};
