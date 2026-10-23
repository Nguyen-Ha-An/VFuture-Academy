import "server-only";
import { ApiError } from "@/lib/api";
import { can, type Permission } from "@/lib/permissions";
import { supabaseService } from "@/lib/supabase/server";
import { STUDIO_REPORT_TIMEZONE } from "@/features/reporting/contracts";
import { loadStudioLearningReport } from "@/features/reporting/service";
import { actorDisplayNames } from "./actor-directory";
import type { AdminContext } from "./context";
import type { AdminAuditEntry } from "./management-contracts";
import { managementRead } from "./management";
import { schoolReports } from "./school-reports";

/** The `dashboard` management operation (plus the two counts this module adds). */
export type AdminDashboardData = {
  members?: number;
  schools?: number;
  enrollments?: number;
  pendingGrading?: number;
  pendingReview?: number;
  publishedContent?: number;
  recentActivity?: AdminAuditEntry[];
};

/** Every read behind the overview; a failed one is listed in `unavailable`. */
export type DashboardRead =
  | "members"
  | "schools"
  | "enrollments"
  | "pendingGrading"
  | "pendingReview"
  | "publishedContent"
  | "recentActivity"
  | "pendingInvitations"
  | "activeLearners"
  | "activitySeries"
  | "schoolRanking"
  | "reviewPipeline";

export type DashboardPeriod = { from: string; to: string };

/**
 * Distinct active learners from the learning report for today−29..today, compared with
 * today−59..today−30: same source, definition and window length, so a delta is honest.
 * `previous` is null when the earlier window could not be read (the card then shows no delta).
 */
export type ActiveLearnersTrend = {
  current: number;
  previous: number | null;
  period: DashboardPeriod;
  previousPeriod: DashboardPeriod;
};

/** One UTC day of additive learning activity (sums across schools stay meaningful). */
export type ActivityDay = {
  day: string;
  lessonCompletions: number;
  /** Quiz attempts plus exam attempts. */
  attempts: number;
};

export type SchoolActivity = {
  branchId: string;
  name: string;
  activeLearners30d: number;
};

/** Current review requests by state (a snapshot, never given a delta). */
export type ReviewPipeline = {
  pending: number;
  changesRequested: number;
  approved: number;
};

export type DashboardActor = { name: string; avatarUrl: string | null };

/**
 * Everything the admin overview shows. A key that is absent and not listed in `unavailable`
 * means the actor may not read it (the card is hidden). A key listed in `unavailable` was
 * readable but failed, so the card says "Unavailable" rather than 0.
 */
export type AdminOverviewData = AdminDashboardData & {
  unavailable?: DashboardRead[];
  pendingInvitations?: number;
  activeLearners?: ActiveLearnersTrend;
  activitySeries?: ActivityDay[];
  /** Top schools by active learners in the last 30 days, at most five. */
  schoolRanking?: SchoolActivity[];
  reviewPipeline?: ReviewPipeline;
  /** Display names for recent-activity actors, keyed by lower-cased user id. */
  actors?: Record<string, DashboardActor>;
};

export type AdminDashboardOptions = {
  /** Fixed clock for tests. */
  now?: Date;
  /**
   * Only the `dashboard` operation plus review and content counts: skips the overview-only
   * reads (learning reports, daily series, school ranking, invitations, actor names).
   */
  summary?: boolean;
};

export const ACTIVITY_DAYS = 30;
export const SCHOOL_RANKING_SIZE = 5;
const DAILY_PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;

/** Permissions that gate each field of the `dashboard` operation (20260906065949_admin_management.sql). */
const OPERATION_FIELDS: ReadonlyArray<[DashboardRead, Permission]> = [
  ["members", "member.read"],
  ["schools", "branch.read"],
  ["enrollments", "learning.read"],
  ["pendingGrading", "grading.read"],
  ["recentActivity", "audit.read"],
];

const CONTENT_TABLES = [
  "courses",
  "resources",
  "opportunities",
  "bank_questions",
] as const;

type CountResponse = { count: number | null; error: unknown };
type RowsResponse = { data: unknown; error: unknown };

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** The learning report's calendar day (Asia/Ho_Chi_Minh), matching its own default window. */
export function reportCalendarDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

/** today−29..today and the 30 days before it. */
export function activeLearnerWindows(today: string): {
  period: DashboardPeriod;
  previousPeriod: DashboardPeriod;
} {
  return {
    period: { from: shiftDay(today, -29), to: today },
    previousPeriod: { from: shiftDay(today, -59), to: shiftDay(today, -30) },
  };
}

/** The last `days` UTC days, oldest first, each present exactly once. */
export function utcDayRange(now: Date, days = ACTIVITY_DAYS): string[] {
  const today = isoDay(now);
  return Array.from({ length: days }, (_, index) =>
    shiftDay(today, index - (days - 1)),
  );
}

function toCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed))
    throw new Error("Unable to load learning activity");
  return parsed;
}

/**
 * Sums `analytics_branch_daily` rows per UTC day and fills days without rows with zeros.
 * Only additive metrics are summed; rolling windows (active learners 7d/30d) never are.
 */
export function sumActivityByDay(
  rows: readonly unknown[],
  days: readonly string[],
): ActivityDay[] {
  const totals = new Map<string, ActivityDay>(
    days.map((day) => [day, { day, lessonCompletions: 0, attempts: 0 }]),
  );
  for (const value of rows) {
    if (typeof value !== "object" || value === null)
      throw new Error("Unable to load learning activity");
    const row = value as Record<string, unknown>;
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    const total = totals.get(day);
    if (!total) continue;
    total.lessonCompletions += toCount(row.lesson_completions);
    total.attempts += toCount(row.quiz_attempts) + toCount(row.exam_attempts);
  }
  return days.map((day) => totals.get(day)!);
}

/** Most active schools first; ties by name so the order is stable. */
export function rankSchools(
  rows: readonly SchoolActivity[],
  size = SCHOOL_RANKING_SIZE,
): SchoolActivity[] {
  return [...rows]
    .sort(
      (left, right) =>
        right.activeLearners30d - left.activeLearners30d ||
        left.name.localeCompare(right.name, "vi"),
    )
    .slice(0, size);
}

const OPEN_REVIEW_STATUSES = ["pending", "changes_requested", "approved"] as const;
const REVIEW_PAGE_SIZE = 1000;
/** A bigger history is reported as unavailable rather than silently truncated. */
const REVIEW_MAX_PAGES = 20;
const REVIEW_ID_CHUNK = 200;

type ReviewRequestRow = {
  content_type: string;
  content_id: string;
  status: string;
  submitted_at: string;
};

type ReviewDatabase = ReturnType<typeof supabaseService>;

/** Reads every page of a query; throws when the page cap is reached (never a silent truncation). */
async function readAllPages(
  page: (from: number, to: number) => PromiseLike<RowsResponse>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < REVIEW_MAX_PAGES; index += 1) {
    const from = index * REVIEW_PAGE_SIZE;
    const response = await page(from, from + REVIEW_PAGE_SIZE - 1);
    if (response.error || !Array.isArray(response.data))
      throw new Error("Unable to load reviews");
    for (const row of response.data) {
      if (typeof row !== "object" || row === null)
        throw new Error("Unable to load reviews");
      rows.push(row as Record<string, unknown>);
    }
    if (response.data.length < REVIEW_PAGE_SIZE) return rows;
  }
  throw new Error("Review history is too large to count");
}

/**
 * Counts content items by the state of their latest review request, the same definition the
 * Studio home and course lists use (`contentStage`). A resubmission never rewrites an earlier
 * `changes_requested` row, so counting rows would keep growing with history.
 */
export function latestReviewPipeline(
  rows: readonly ReviewRequestRow[],
): ReviewPipeline {
  const latest = new Map<string, ReviewRequestRow>();
  for (const row of rows) {
    const key = `${row.content_type}:${row.content_id}`;
    const current = latest.get(key);
    if (!current || Date.parse(row.submitted_at) > Date.parse(current.submitted_at))
      latest.set(key, row);
  }
  const pipeline: ReviewPipeline = { pending: 0, changesRequested: 0, approved: 0 };
  for (const { status } of latest.values()) {
    if (status === "pending") pipeline.pending += 1;
    else if (status === "changes_requested") pipeline.changesRequested += 1;
    else if (status === "approved") pipeline.approved += 1;
  }
  return pipeline;
}

function reviewRequestRow(row: Record<string, unknown>): ReviewRequestRow {
  const { content_type, content_id, status, submitted_at } = row;
  if (
    typeof content_type !== "string" ||
    typeof content_id !== "string" ||
    typeof status !== "string" ||
    typeof submitted_at !== "string"
  )
    throw new Error("Unable to load reviews");
  return { content_type, content_id, status, submitted_at };
}

async function openReviewPipeline(
  database: ReviewDatabase,
): Promise<ReviewPipeline> {
  // Items with at least one open request are the only ones that can count.
  const candidates = await readAllPages((from, to) =>
    database
      .from("cms_review_requests")
      .select("content_type, content_id")
      .in("status", [...OPEN_REVIEW_STATUSES])
      .order("id", { ascending: true })
      .range(from, to) as PromiseLike<RowsResponse>,
  );
  const idsByType = new Map<string, Set<string>>();
  for (const row of candidates) {
    if (typeof row.content_type !== "string" || typeof row.content_id !== "string")
      throw new Error("Unable to load reviews");
    const ids = idsByType.get(row.content_type) ?? new Set<string>();
    ids.add(row.content_id);
    idsByType.set(row.content_type, ids);
  }
  const chunks: Array<[string, string[]]> = [];
  for (const [type, ids] of idsByType) {
    const list = [...ids];
    for (let index = 0; index < list.length; index += REVIEW_ID_CHUNK)
      chunks.push([type, list.slice(index, index + REVIEW_ID_CHUNK)]);
  }
  // Their full request history decides which request is the latest one.
  const histories = await Promise.all(
    chunks.map(([type, ids]) =>
      readAllPages((from, to) =>
        database
          .from("cms_review_requests")
          .select("content_type, content_id, status, submitted_at")
          .eq("content_type", type)
          .in("content_id", ids)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<RowsResponse>,
      ),
    ),
  );
  return latestReviewPipeline(histories.flat().map(reviewRequestRow));
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function canReadReports(context: AdminContext): boolean {
  return context.scope.kind === "central"
    ? can(context.actor, "report.global.read", context.scope) ||
        can(context.actor, "analytics.global.read", context.scope)
    : can(context.actor, "report.branch.read", context.scope) ||
        can(context.actor, "analytics.branch.read", context.scope);
}

/**
 * The admin overview's only data entry point. Each read is independent: a missing
 * permission leaves its key out, a failure lists it in `unavailable`, and the rest of
 * the overview still loads.
 */
export async function adminDashboard(
  context: AdminContext,
  options: AdminDashboardOptions = {},
): Promise<AdminOverviewData> {
  const now = options.now ?? new Date();
  const unavailable = new Set<DashboardRead>();
  const database = supabaseService();
  const scope = context.scope;
  const branchId = scope.kind === "branch" ? scope.branchId : null;

  const operation = async (): Promise<AdminDashboardData> => {
    try {
      return await managementRead<AdminDashboardData>(context, "dashboard");
    } catch {
      for (const [key, permission] of OPERATION_FIELDS)
        if (can(context.actor, permission, scope)) unavailable.add(key);
      return {};
    }
  };

  const reviewCounts = async (): Promise<ReviewPipeline | undefined> => {
    // CMS ownership is captured in the immutable snapshot, not client filters,
    // so review counts are only shown for the central scope.
    if (scope.kind !== "central") return undefined;
    if (!can(context.actor, "content.review", { kind: "central" }))
      return undefined;
    try {
      return await openReviewPipeline(database);
    } catch {
      unavailable.add("pendingReview");
      unavailable.add("reviewPipeline");
      return undefined;
    }
  };

  const publishedContent = async (): Promise<number | undefined> => {
    if (!can(context.actor, "content.read", scope)) return undefined;
    try {
      const counts = await Promise.all(
        CONTENT_TABLES.map(async (table) => {
          let query = database
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("status", "published");
          if (branchId)
            query = query
              .eq("ownership_kind", "branch")
              .eq("owner_branch_id", branchId);
          const response = (await query) as CountResponse;
          if (response.error) throw new Error("Unable to load content overview");
          return response.count ?? 0;
        }),
      );
      return counts.reduce((sum, count) => sum + count, 0);
    } catch {
      unavailable.add("publishedContent");
      return undefined;
    }
  };

  const pendingInvitations = async (): Promise<number | undefined> => {
    if (options.summary) return undefined;
    if (!can(context.actor, "membership.manage", scope)) return undefined;
    try {
      // Same definition as admin_invitation_json's "pending": not accepted, not revoked, not expired.
      let query = database
        .from("admin_invitations")
        .select("id", { count: "exact", head: true })
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", now.toISOString());
      if (branchId) query = query.eq("branch_id", branchId);
      const response = (await query) as CountResponse;
      if (response.error) throw new Error("Unable to load invitations");
      return response.count ?? 0;
    } catch {
      unavailable.add("pendingInvitations");
      return undefined;
    }
  };

  const activeLearners = async (): Promise<ActiveLearnersTrend | undefined> => {
    if (options.summary || !canReadReports(context)) return undefined;
    const { period, previousPeriod } = activeLearnerWindows(
      reportCalendarDay(now),
    );
    const [current, previous] = await Promise.allSettled([
      loadStudioLearningReport(context.actor, scope, period),
      loadStudioLearningReport(context.actor, scope, previousPeriod),
    ]);
    if (current.status === "rejected") {
      if (!isForbidden(current.reason)) unavailable.add("activeLearners");
      return undefined;
    }
    const currentValue = current.value.overview?.activeUsers;
    if (typeof currentValue !== "number" || !Number.isFinite(currentValue)) {
      unavailable.add("activeLearners");
      return undefined;
    }
    const previousValue =
      previous.status === "fulfilled"
        ? previous.value.overview?.activeUsers
        : undefined;
    return {
      current: currentValue,
      previous:
        typeof previousValue === "number" && Number.isFinite(previousValue)
          ? previousValue
          : null,
      period,
      previousPeriod,
    };
  };

  const activitySeries = async (): Promise<ActivityDay[] | undefined> => {
    if (options.summary || !canReadReports(context)) return undefined;
    const days = utcDayRange(now);
    try {
      const rows: unknown[] = [];
      // One row per school and day: page through so a large scope is never silently truncated.
      for (let offset = 0; ; offset += DAILY_PAGE_SIZE) {
        let query = database
          .from("analytics_branch_daily")
          .select("branch_id, day, lesson_completions, quiz_attempts, exam_attempts")
          .gte("day", days[0])
          .lte("day", days[days.length - 1]);
        if (branchId) query = query.eq("branch_id", branchId);
        const response = (await query
          .order("day", { ascending: true })
          .order("branch_id", { ascending: true })
          .range(offset, offset + DAILY_PAGE_SIZE - 1)) as RowsResponse;
        if (response.error || !Array.isArray(response.data))
          throw new Error("Unable to load learning activity");
        rows.push(...response.data);
        if (response.data.length < DAILY_PAGE_SIZE) break;
      }
      return sumActivityByDay(rows, days);
    } catch {
      unavailable.add("activitySeries");
      return undefined;
    }
  };

  const schoolRanking = async (): Promise<SchoolActivity[] | undefined> => {
    // A single school has nothing to rank against.
    if (options.summary || scope.kind !== "central") return undefined;
    try {
      const rows = await schoolReports(context);
      if (!rows) return undefined;
      return rankSchools(
        rows.map(({ branchId: id, name, activeLearners30d }) => ({
          branchId: id,
          name,
          activeLearners30d,
        })),
      );
    } catch {
      unavailable.add("schoolRanking");
      return undefined;
    }
  };

  const [
    base,
    reviews,
    published,
    invitations,
    learners,
    series,
    ranking,
  ] = await Promise.all([
    operation(),
    reviewCounts(),
    publishedContent(),
    pendingInvitations(),
    activeLearners(),
    activitySeries(),
    schoolRanking(),
  ]);

  const result: AdminOverviewData = { ...base };
  if (reviews) {
    result.pendingReview = reviews.pending;
    result.reviewPipeline = reviews;
  }
  if (published !== undefined) result.publishedContent = published;
  if (invitations !== undefined) result.pendingInvitations = invitations;
  if (learners) result.activeLearners = learners;
  if (series) result.activitySeries = series;
  if (ranking) result.schoolRanking = ranking;
  if (!options.summary && result.recentActivity?.length) {
    // Member targets are named too, so the feed reads "… đã khoá tài khoản Lê Thu Hà".
    const names = await actorDisplayNames([
      ...result.recentActivity.map((entry) => entry.actorId),
      ...result.recentActivity.filter((entry) => entry.targetType === "user").map((entry) => entry.targetId),
    ]);
    result.actors = Object.fromEntries(
      [...names].map(([id, actor]) => [
        id,
        { name: actor.name, avatarUrl: actor.avatarUrl },
      ]),
    );
  }
  if (unavailable.size) result.unavailable = [...unavailable];
  return result;
}

/** The slim read behind GET /api/v1/admin/dashboard (no overview-only reads). */
export function adminDashboardSummary(
  context: AdminContext,
): Promise<AdminOverviewData> {
  return adminDashboard(context, { summary: true });
}
