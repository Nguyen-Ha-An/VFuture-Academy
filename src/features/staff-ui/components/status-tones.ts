import type { ManagedInvitation } from "@/features/admin/management-contracts";
import type { AttemptStatus } from "@/features/exams/types";
import type { SubmissionStatus } from "@/features/instructor-grading/types";
import type { ProjectStatus } from "@/features/projects/service";
import type { StudioResourceStatus } from "@/features/resources/service";
import type { AccountStatus } from "@/lib/authorization";

/**
 * One tone vocabulary for every staff status pill. Colour carries meaning only here:
 * warning = waiting on staff, info = in progress, success = done well,
 * danger = blocked or needs rework, neutral = resting state, outline = closed or inactive.
 */
export const STATUS_TONES = ["neutral", "info", "success", "warning", "danger", "outline"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

// Runtime value lists mirror the database check constraints in supabase/migrations. Where a
// TypeScript union already exists it is reused, and `satisfies` keeps the list and the union in step.

/** cms_review_requests.status (20260908224000_studio_workflow_atomic_publish.sql). */
export const REVIEW_STATUSES = ["pending", "changes_requested", "approved", "stale", "withdrawn", "published"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Resources, opportunities, courses and question-bank items (0002_content.sql, 0007_ecosystem.sql). */
export const CONTENT_STATUSES = ["draft", "published", "archived"] as const satisfies readonly StudioResourceStatus[];
export type ContentStatus = StudioResourceStatus;

/** projects.status (0007_ecosystem.sql); the database also allows 'published', which the service union omits. */
export const PROJECT_STATUSES = ["idea", "forming", "active", "completed", "showcased", "published"] as const satisfies readonly (ProjectStatus | "published")[];
export type ProjectStatusValue = ProjectStatus | "published";

/** assignment_submissions.status (0004_learning.sql). */
export const SUBMISSION_STATUSES = ["submitted", "in_review", "approved", "changes_requested"] as const satisfies readonly SubmissionStatus[];

/** exam_attempts.status (0004_learning.sql). */
export const EXAM_ATTEMPT_STATUSES = ["in_progress", "submitted", "submitted_late", "graded", "pending_manual", "expired"] as const satisfies readonly AttemptStatus[];

/** enrollments.status (0004_learning.sql). */
export const ENROLLMENT_STATUSES = ["active", "completed", "dropped"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Derived admin invitation state (ManagedInvitation.status). */
export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const satisfies readonly ManagedInvitation["status"][];
export type InvitationStatus = ManagedInvitation["status"];

/** Account or membership status (active | suspended) plus 'invited' for people who have not accepted yet. */
export const MEMBER_STATUSES = ["active", "suspended", "invited"] as const satisfies readonly (AccountStatus | "invited")[];
export type MemberStatus = AccountStatus | "invited";

export type StatusValues = {
  review: ReviewStatus;
  content: ContentStatus;
  project: ProjectStatusValue;
  submission: SubmissionStatus;
  examAttempt: AttemptStatus;
  enrollment: EnrollmentStatus;
  invitation: InvitationStatus;
  member: MemberStatus;
};
export type StatusKind = keyof StatusValues;

export const STATUS_VALUES: { [K in StatusKind]: readonly StatusValues[K][] } = {
  review: REVIEW_STATUSES,
  content: CONTENT_STATUSES,
  project: PROJECT_STATUSES,
  submission: SUBMISSION_STATUSES,
  examAttempt: EXAM_ATTEMPT_STATUSES,
  enrollment: ENROLLMENT_STATUSES,
  invitation: INVITATION_STATUSES,
  member: MEMBER_STATUSES,
};

// Record<Union, Tone> makes a missing or extra state a type error.
export const STATUS_TONE_MAP: { [K in StatusKind]: Record<StatusValues[K], StatusTone> } = {
  review: { pending: "warning", changes_requested: "danger", approved: "info", stale: "outline", withdrawn: "outline", published: "success" },
  content: { draft: "neutral", published: "success", archived: "outline" },
  project: { idea: "neutral", forming: "info", active: "info", completed: "success", showcased: "success", published: "success" },
  submission: { submitted: "warning", in_review: "info", approved: "success", changes_requested: "danger" },
  examAttempt: { in_progress: "info", submitted: "neutral", submitted_late: "warning", graded: "success", pending_manual: "warning", expired: "outline" },
  enrollment: { active: "info", completed: "success", dropped: "outline" },
  invitation: { pending: "warning", accepted: "success", revoked: "outline", expired: "outline" },
  member: { active: "success", suspended: "danger", invited: "warning" },
};

export function isStatusValue<K extends StatusKind>(kind: K, value: string): value is StatusValues[K] {
  return (STATUS_VALUES[kind] as readonly string[]).includes(value);
}

/** Tone for a known state; anything the map does not know (bad data, a new state) reads as neutral. */
export function statusTone<K extends StatusKind>(kind: K, value: StatusValues[K] | (string & {})): StatusTone {
  if (!isStatusValue(kind, value)) return "neutral";
  return (STATUS_TONE_MAP[kind] as Record<string, StatusTone>)[value];
}
