import type {
  AssignmentPayload,
  LearnerSubmissionFile,
  LearnerSubmissionStatus,
} from '@/content-engine/render/assignment-contracts';

export {
  assignmentId,
  compareAssignmentTimestamps,
  type AssignmentAction,
  type AssignmentLocator,
  type AssignmentSessionResult,
  type AssignmentSubmitResult,
  type AssignmentTarget,
  type LearnerAssignmentSubmission,
  type LearnerReleasedGrade,
  type LearnerSubmissionFile,
  type LearnerSubmissionStatus,
} from '@/content-engine/render/assignment-contracts';

/**
 * Queue status filters. `pending` ("Waiting") is every submission still waiting on a grader:
 * the effective `submitted` and `in_review` states together.
 */
export const QUEUE_STATUS_FILTERS = ['pending', 'submitted', 'in_review', 'approved', 'changes_requested'] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUS_FILTERS)[number];

export type SubmissionQueueFilter = {
  branchId?: string;
  courseId?: string;
  assignmentId?: string;
  status?: QueueStatusFilter;
  cursor?: string;
};

export type SubmissionQueueGrade = {
  rubricScores: Record<string, number>;
  feedback: string | { vi?: string; en?: string };
  decision: 'approved' | 'changes_requested';
  passed: boolean;
  totalPoints: number;
  maxPoints: number;
  gradedAt: string;
  released: boolean;
};

export type SubmissionQueueSubmission = {
  id: string;
  userId: string;
  learnerName: string;
  branchId: string | null;
  courseVersionId: string;
  itemId: string;
  blockId: string | null;
  assignmentId: string;
  attemptNo: number;
  status: LearnerSubmissionStatus;
  submittedAt: string;
  payload: AssignmentPayload;
  files: LearnerSubmissionFile[];
  grade?: SubmissionQueueGrade;
};

export type SubmissionQueuePage = {
  items: SubmissionQueueSubmission[];
  nextCursor: string | null;
};

export type GradeSubmissionResult = {
  submission: SubmissionQueueSubmission;
};
