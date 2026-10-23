import type {
  ActivityDay,
  AdminOverviewData,
  DashboardRead,
} from "@/features/admin/dashboard";
import type { AdminAuditEntry } from "@/features/admin/management-contracts";
import type { SchoolActivityRow } from "./SchoolActivityCard";
import {
  formatStaffAuditAction,
  formatStaffAuditTarget,
} from "@/features/admin/audit-format";
import { statusTone } from "@/features/staff-ui/components/status-tones";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";

// Pure mapping from adminDashboard() data to the serializable props of AdminOverviewView.
// No server imports, so an e2e harness can build the same props from fixtures.

export type OverviewKpiKey =
  | "members"
  | "activeLearners"
  | "pendingGrading"
  | "pendingReview"
  | "schools"
  | "enrollments"
  | "publishedContent";

export type OverviewKpi = {
  key: OverviewKpiKey;
  /** null reads as "Unavailable", never 0. */
  value: number | null;
  href?: string;
  /** Absolute change against the previous window of the same definition. */
  delta?: number;
  /** Members only; null means the invitation count failed to load. */
  pendingInvitations?: number | null;
};

export type OverviewTone = "success" | "info" | "warning" | "danger" | "neutral" | "outline";

export type OverviewPipelineStage = {
  key: "pending" | "changesRequested" | "approved" | "pendingGrading";
  count: number | null;
  tone: OverviewTone;
  href?: string;
};

export type OverviewActor =
  | { kind: "person"; name: string; avatarUrl: string | null }
  | { kind: "system" }
  | { kind: "unknown" };

export type OverviewActivityItem = {
  id: string;
  actor: OverviewActor;
  action: string;
  /** Left out when the action already names the thing ("đã tạo lời mời"). */
  target?: string;
  href?: string;
  at: string;
};

export type AdminOverviewViewProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Present only with membership.manage. */
  inviteHref?: string;
  kpis: OverviewKpi[];
  /** Absent: hidden (no permission). */
  activity?: { state: "ready"; days: ActivityDay[] } | { state: "unavailable" };
  schools?: { state: "ready"; rows: SchoolActivityRow[] } | { state: "unavailable" };
  pipeline?: OverviewPipelineStage[];
  recent?: { state: "ready"; items: OverviewActivityItem[] } | { state: "unavailable" };
  auditHref?: string;
};

export type AdminOverviewInput = {
  data: AdminOverviewData;
  permissions: readonly Permission[];
  entries: WorkspaceEntries;
  locale: string;
  eyebrow?: string;
  title: string;
  description?: string;
};

const PRIMARY: readonly OverviewKpiKey[] = [
  "members",
  "activeLearners",
  "pendingGrading",
  "pendingReview",
];
const FALLBACKS: readonly OverviewKpiKey[] = [
  "schools",
  "enrollments",
  "publishedContent",
];
export const KPI_SLOTS = 4;

function slot<T>(
  value: T | undefined,
  key: DashboardRead,
  unavailable: ReadonlySet<DashboardRead>,
): { state: "ready"; value: T } | { state: "unavailable" } | undefined {
  if (value !== undefined) return { state: "ready", value };
  return unavailable.has(key) ? { state: "unavailable" } : undefined;
}

/**
 * The audit labels are sentence-case table labels ("Đã tạo lời mời"). In the feed they follow the
 * actor's name, so Vietnamese starts lower-case ("Nguyễn Minh Anh đã tạo lời mời"); a member target
 * is named, and a bare type word that only repeats the verb ("… lời mời Lời mời") is dropped.
 */
function feedPhrase(
  entry: AdminAuditEntry,
  locale: string,
  actors: AdminOverviewData["actors"],
): { action: string; target?: string } {
  const label = formatStaffAuditAction(entry.action, locale).label;
  const action = locale === "vi" && label ? label.charAt(0).toLocaleLowerCase("vi") + label.slice(1) : label;
  const name = entry.targetType === "user" ? actors?.[entry.targetId.toLowerCase()]?.name : undefined;
  if (name) return { action, target: name };
  const type = formatStaffAuditTarget(entry.targetType, locale);
  return action.toLocaleLowerCase(locale).includes(type.toLocaleLowerCase(locale)) ? { action } : { action, target: type };
}

function actorFor(
  actorId: string | null,
  actors: AdminOverviewData["actors"],
): OverviewActor {
  if (!actorId) return { kind: "system" };
  const actor = actors?.[actorId.toLowerCase()];
  return actor
    ? { kind: "person", name: actor.name, avatarUrl: actor.avatarUrl }
    : { kind: "unknown" };
}

export function buildAdminOverviewView(
  input: AdminOverviewInput,
): AdminOverviewViewProps {
  const { data, permissions, entries, locale } = input;
  const unavailable = new Set(data.unavailable ?? []);
  const has = (permission: Permission) => permissions.includes(permission);

  const candidates: Record<OverviewKpiKey, OverviewKpi | undefined> = {
    members: (() => {
      const read = slot(data.members, "members", unavailable);
      if (!read) return undefined;
      const invitations = slot(
        data.pendingInvitations,
        "pendingInvitations",
        unavailable,
      );
      return {
        key: "members",
        value: read.state === "ready" ? read.value : null,
        href: has("member.read") ? routes.admin.users() : undefined,
        ...(invitations
          ? {
              pendingInvitations:
                invitations.state === "ready" ? invitations.value : null,
            }
          : {}),
      };
    })(),
    activeLearners: (() => {
      const read = slot(data.activeLearners, "activeLearners", unavailable);
      if (!read) return undefined;
      if (read.state === "unavailable")
        return { key: "activeLearners", value: null };
      const { current, previous } = read.value;
      return {
        key: "activeLearners",
        value: current,
        ...(previous === null ? {} : { delta: current - previous }),
      };
    })(),
    pendingGrading: (() => {
      const read = slot(data.pendingGrading, "pendingGrading", unavailable);
      if (!read) return undefined;
      return {
        key: "pendingGrading",
        value: read.state === "ready" ? read.value : null,
        href: entries.grading
          ? routes.grading.queue({ status: "pending" })
          : undefined,
      };
    })(),
    pendingReview: (() => {
      const read = slot(data.pendingReview, "pendingReview", unavailable);
      if (!read) return undefined;
      return {
        key: "pendingReview",
        value: read.state === "ready" ? read.value : null,
        href: entries.studio ? routes.studio.reviews() : undefined,
      };
    })(),
    schools: (() => {
      const read = slot(data.schools, "schools", unavailable);
      if (!read) return undefined;
      return {
        key: "schools",
        value: read.state === "ready" ? read.value : null,
        href: has("branch.read") ? routes.admin.branches() : undefined,
      };
    })(),
    enrollments: (() => {
      const read = slot(data.enrollments, "enrollments", unavailable);
      return read
        ? { key: "enrollments", value: read.state === "ready" ? read.value : null }
        : undefined;
    })(),
    publishedContent: (() => {
      const read = slot(data.publishedContent, "publishedContent", unavailable);
      return read
        ? {
            key: "publishedContent",
            value: read.state === "ready" ? read.value : null,
          }
        : undefined;
    })(),
  };

  // The four primary cards, topped up from the fallbacks when a primary one is hidden.
  const kpis = [...PRIMARY, ...FALLBACKS]
    .map((key) => candidates[key])
    .filter((kpi): kpi is OverviewKpi => kpi !== undefined)
    .slice(0, KPI_SLOTS);

  const activitySlot = slot(data.activitySeries, "activitySeries", unavailable);
  const schoolsSlot = slot(data.schoolRanking, "schoolRanking", unavailable);

  const reviews = slot(data.reviewPipeline, "reviewPipeline", unavailable);
  const grading = slot(data.pendingGrading, "pendingGrading", unavailable);
  // Review states anchor the strip; waiting-to-grade alone would repeat its KPI.
  const pipeline: OverviewPipelineStage[] | undefined = reviews
    ? [
        {
          key: "pending",
          count: reviews.state === "ready" ? reviews.value.pending : null,
          tone: statusTone("review", "pending"),
          href: entries.studio ? routes.studio.reviews() : undefined,
        },
        {
          key: "changesRequested",
          count:
            reviews.state === "ready" ? reviews.value.changesRequested : null,
          tone: statusTone("review", "changes_requested"),
        },
        {
          key: "approved",
          count: reviews.state === "ready" ? reviews.value.approved : null,
          tone: statusTone("review", "approved"),
        },
        ...(grading
          ? [
              {
                key: "pendingGrading" as const,
                count: grading.state === "ready" ? grading.value : null,
                tone: statusTone("submission", "submitted"),
                href: entries.grading
          ? routes.grading.queue({ status: "pending" })
          : undefined,
              },
            ]
          : []),
      ]
    : undefined;

  const recentSlot = slot(data.recentActivity, "recentActivity", unavailable);
  const recent: AdminOverviewViewProps["recent"] = recentSlot
    ? recentSlot.state === "unavailable"
      ? { state: "unavailable" }
      : {
          state: "ready",
          items: recentSlot.value.map((entry) => ({
            id: entry.id,
            actor: actorFor(entry.actorId, data.actors),
            ...feedPhrase(entry, locale, data.actors),
            href:
              entry.targetType === "user" && has("member.read")
                ? routes.admin.user(entry.targetId)
                : entry.targetType === "branch" && has("branch.read")
                  ? routes.admin.branch(entry.targetId)
                  : undefined,
            at: entry.at,
          })),
        }
    : undefined;

  return {
    eyebrow: input.eyebrow,
    title: input.title,
    description: input.description,
    // The target page itself needs member.read, so both are required.
    inviteHref: has("membership.manage") && has("member.read")
      ? routes.admin.users({ invite: 1 })
      : undefined,
    kpis,
    activity: activitySlot
      ? activitySlot.state === "ready"
        ? { state: "ready", days: activitySlot.value }
        : { state: "unavailable" }
      : undefined,
    schools: schoolsSlot
      ? schoolsSlot.state === "ready"
        ? {
            state: "ready",
            rows: schoolsSlot.value.map((row) => ({
              ...row,
              ...(has("branch.read")
                ? { href: routes.admin.branch(row.branchId) }
                : {}),
            })),
          }
        : { state: "unavailable" }
      : undefined,
    pipeline,
    recent,
    auditHref: recent && has("audit.read") ? routes.admin.audit() : undefined,
  };
}
