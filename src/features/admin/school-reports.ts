import "server-only";
import { ApiError } from "@/lib/api";
import type { AdminContext } from "./context";
import { managementRead } from "./management";

/**
 * One row of the per-school `reports` operation (admin_management_read,
 * 20260906065949_admin_management.sql). Counts cover rows whose branch scope is known.
 */
export type SchoolReportRow = {
  branchId: string;
  name: string;
  enrollments: number;
  completedEnrollments: number;
  submissions: number;
  /** Submissions still `submitted` or `in_review`. */
  pendingGrading: number;
  /** Mean grade percentage, or null when the school has no grades yet. */
  averagePercent: number | null;
  /** Distinct learners with analytics events in the last 30 days. */
  activeLearners30d: number;
};

type Database = Parameters<typeof managementRead>[3];

function count(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed))
    throw new Error("Unable to load school reports");
  return parsed;
}

function percent(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return count(value);
}

function parseRow(value: unknown): SchoolReportRow {
  if (typeof value !== "object" || value === null)
    throw new Error("Unable to load school reports");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id)
    throw new Error("Unable to load school reports");
  return {
    branchId: row.id,
    name: typeof row.name === "string" ? row.name : row.id,
    enrollments: count(row.enrollments),
    completedEnrollments: count(row.completedEnrollments),
    submissions: count(row.submissions),
    pendingGrading: count(row.pendingGrading),
    averagePercent: percent(row.averagePercent),
    activeLearners30d: count(row.activeLearners30d),
  };
}

/**
 * Per-school report rows for the current admin scope (every school centrally, one school in
 * branch scope). Returns undefined when the actor lacks the report permission so the caller
 * hides report cards/columns; any other failure throws so the page can say "Unavailable".
 */
export async function schoolReports(
  context: AdminContext,
  database?: Database,
): Promise<SchoolReportRow[] | undefined> {
  let data: unknown;
  try {
    data = await managementRead<unknown>(context, "reports", {}, database);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return undefined;
    throw error;
  }
  if (!Array.isArray(data)) throw new Error("Unable to load school reports");
  return data.map(parseRow);
}
