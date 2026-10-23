import "server-only";

import type { Branch } from "@/features/admin/branches";
import type { AdminContext } from "@/features/admin/context";
import type { AdminDashboardData } from "@/features/admin/dashboard";
import { actorDisplayNames } from "@/features/admin/actor-directory";
import { managementRead } from "@/features/admin/management";
import type { MemberPage } from "@/features/admin/management-contracts";
import { schoolReports, type SchoolReportRow } from "@/features/admin/school-reports";
import type { SchoolReportCells } from "@/features/admin/components/BranchesManager";

/**
 * The one data module behind /admin/branches and /admin/branches/[branchId]: pages call these
 * reads and hand plain data to their views, so tests and the admin harness can mock one file.
 */

/** Hidden = no report permission (columns and cards are not rendered); unavailable = the read failed. */
export type SchoolReportsResult =
  | { state: "hidden" }
  | { state: "unavailable" }
  | { state: "ready"; rows: Record<string, SchoolReportCells> };

export const SCHOOL_MEMBER_PAGE_SIZE = 50;

export function reportCells(row: SchoolReportRow): SchoolReportCells {
  return {
    activeLearners30d: row.activeLearners30d,
    enrollments: row.enrollments,
    completedEnrollments: row.completedEnrollments,
    // A school with no enrollments has no completion rate, not a 0% one.
    completionPercent: row.enrollments > 0 ? (row.completedEnrollments / row.enrollments) * 100 : null,
    pendingGrading: row.pendingGrading,
    averagePercent: row.averagePercent,
  };
}

async function readReports(context: AdminContext): Promise<SchoolReportsResult> {
  try {
    const rows = await schoolReports(context);
    if (rows === undefined) return { state: "hidden" };
    return { state: "ready", rows: Object.fromEntries(rows.map((row) => [row.branchId, reportCells(row)])) };
  } catch {
    return { state: "unavailable" };
  }
}

/** Schools in the current scope plus their report row; the branch list itself must load. */
export async function schoolsDirectory(context: AdminContext, { withReports }: { withReports: boolean }) {
  const [branches, reports] = await Promise.all([
    managementRead<Branch[]>(context, "branches"),
    withReports ? readReports(context) : Promise.resolve<SchoolReportsResult>({ state: "hidden" }),
  ]);
  return { branches, reports };
}

export type SchoolOverview = {
  /** null when the school-scope dashboard read failed. */
  counts: AdminDashboardData | null;
  report: { state: "hidden" } | { state: "unavailable" } | { state: "ready"; cells: SchoolReportCells | null };
  /** Actor names for counts.recentActivity (and member targets), keyed by lower-cased id. */
  actors?: Record<string, { name: string; avatarUrl: string | null }>;
};

/** Dashboard counts in the school's own scope plus that school's report row. */
export async function schoolOverview(context: AdminContext, branchId: string, { withReports }: { withReports: boolean }): Promise<SchoolOverview> {
  const [counts, reports] = await Promise.all([
    managementRead<AdminDashboardData>(context, "dashboard").catch(() => null),
    withReports ? readReports(context) : Promise.resolve<SchoolReportsResult>({ state: "hidden" }),
  ]);
  const report: SchoolOverview["report"] =
    reports.state === "ready" ? { state: "ready", cells: reports.rows[branchId] ?? null } : reports;
  const activity = counts?.recentActivity ?? [];
  if (!activity.length) return { counts, report };
  // Names only; a failed lookup leaves the feed readable with "Unknown user".
  const names = await actorDisplayNames([
    ...activity.map((entry) => entry.actorId),
    ...activity.filter((entry) => entry.targetType === "user").map((entry) => entry.targetId),
  ]).catch(() => new Map<string, { name: string; avatarUrl: string | null }>());
  return {
    counts,
    report,
    actors: Object.fromEntries([...names].map(([id, actor]) => [id, { name: actor.name, avatarUrl: actor.avatarUrl }])),
  };
}

/** One page of the school's members (or staff). null when the read failed. */
export async function schoolMembers(context: AdminContext, { page, staff }: { page: number; staff: boolean }): Promise<MemberPage | null> {
  try {
    return await managementRead<MemberPage>(context, "users", {
      page,
      pageSize: SCHOOL_MEMBER_PAGE_SIZE,
      ...(staff ? { kind: "staff" } : {}),
    });
  } catch {
    return null;
  }
}
