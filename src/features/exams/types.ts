import type {
  CompiledItem,
  GradingItem,
  GradingQuestion,
  LearnerItem,
  PoolSpec,
} from '../../content-engine/compile';
import type { ScoringPolicy } from '../../content-engine/grading';
import type { QuestionResult } from '../../content-engine/grading/types';
import type { Locale } from '../../content-engine/schema/common';
import type { Permission } from '../../lib/permissions';

export type AttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'submitted_late'
  | 'graded'
  | 'pending_manual'
  | 'expired';

export type ExamErrorCode =
  | 'EXAM_CLOSED'
  | 'NO_ATTEMPTS'
  | 'ATTEMPT_NOT_ACTIVE'
  | 'DEADLINE_PASSED'
  | 'SECTION_DEADLINE_PASSED'
  | 'FORBIDDEN'
  | 'LOCALE_UNAVAILABLE'
  | 'INVALID_EXAM_CONFIGURATION'
  | 'POOL_UNSATISFIABLE'
  | 'MANUAL_GRADING_INCOMPLETE'
  | 'GRADING_CONFLICT'
  | 'LEGACY_RESULT_UNRELEASED';

export class ExamError extends Error {
  readonly httpStatus: 403 | 409 | 422;

  constructor(
    readonly code: ExamErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExamError';
    this.httpStatus = code === 'FORBIDDEN'
      ? 403
      : code === 'POOL_UNSATISFIABLE' || code === 'INVALID_EXAM_CONFIGURATION'
        ? 422
        : 409;
  }
}

export type ExamPermission = Extract<Permission, 'exam.release' | 'submission.grade'>;

export interface ExamActor {
  id: string;
  locale: Locale;
  permissions?: readonly ExamPermission[];
  branchId?: string | null;
  /** Allows a globally scoped studio actor to access unassigned learners. */
  global?: boolean;
}

export interface AttemptQuestionSetSection {
  id: string;
  questionIds: string[];
  optionOrders: Record<string, string[]>;
  /** Cumulative milliseconds from attempt start when this timed section ends. */
  deadlineOffsetMs: number | null;
}

export interface AttemptQuestionSet {
  sections: AttemptQuestionSetSection[];
  learner: LearnerItem;
  locale: Locale;
  defaultLocale: Locale;
}

export interface ExamAttemptRecord {
  id: string;
  userId: string;
  courseVersionId: string;
  itemId: string;
  branchId: string | null;
  attemptNo: number;
  status: AttemptStatus;
  late: boolean;
  questionSet: AttemptQuestionSet;
  gradingSnapshot: GradingItem;
  startedAt: Date;
  deadlineAt: Date | null;
  submittedAt: Date | null;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  /**
   * When the pinned answer key and explanations were published to the learner.
   * Governs review reveal only; it is never a statement about the score.
   */
  releasedAt: Date | null;
  /**
   * When grading COMPLETED and the score plus manual feedback became the learner's.
   * Set automatically by a valid submit that needed no manual grading, and by the
   * explicit completion of a manually graded attempt. Independent of `releasedAt`
   * in both directions: it must never be read as permission to reveal answer keys,
   * and releasing an answer key must never set it. Null on every attempt that
   * predates the column, which keeps those results governed by the legacy release
   * path alone.
   */
  resultAvailableAt: Date | null;
}

export interface ExamAnswerRecord {
  attemptId: string;
  questionId: string;
  answer: unknown;
  result: QuestionResult | null;
  manualPoints: number | null;
  manualFeedback: unknown | null;
  gradedBy: string | null;
  updatedAt: Date;
}

export interface ExamGradeRecord {
  userId: string;
  courseVersionId: string;
  itemId: string;
  percent: number;
  passed: boolean;
  policy: ScoringPolicy;
  computedAt: Date;
}

export type ExamFinalizeResult = {
  attempt: ExamAttemptRecord;
  answersChanged: boolean;
  transitioned: boolean;
};

export type ExamCompleteGradingResult = {
  attempt: ExamAttemptRecord;
  /** A grading draft changed between the caller's read and this write. */
  answersChanged: boolean;
  /** This call performed the finalizing transition rather than observing one. */
  transitioned: boolean;
};

export type ExamReleaseTransition = {
  attempt: ExamAttemptRecord;
  transitioned: boolean;
};

export type ExamEventType =
  | 'focus_lost'
  | 'focus_gained'
  | 'visibility_hidden'
  | 'paste'
  | 'fullscreen_exit';

export interface ExamEventRecord {
  id: string;
  attemptId: string;
  type: ExamEventType;
  at: Date;
  meta: Record<string, unknown>;
}

export interface ExamEventInput {
  type: ExamEventType;
  at?: Date;
  meta?: Record<string, unknown>;
}

export interface ExamRepo {
  getAttempt(id: string): Promise<ExamAttemptRecord | null>;
  /**
   * A null userId lists all users for an instructor item-level release.
   * Implementations MUST return attempts ordered by attemptNo ascending because
   * the `first` and `latest` scoring policies consume this sequence directly.
   */
  listAttempts(userId: string | null, itemId: string, courseVersionId?: string): Promise<ExamAttemptRecord[]>;
  /** Atomically resumes an active attempt or inserts one within the attempt limit. */
  insertAttempt(attempt: ExamAttemptRecord, attemptsAllowed: number): Promise<ExamAttemptRecord>;
  updateAttempt(id: string, patch: Partial<ExamAttemptRecord>): Promise<ExamAttemptRecord>;
  /** Saves learner answers only while the owned attempt remains in progress. */
  saveActiveAnswers(attemptId: string, userId: string, answers: readonly ExamAnswerRecord[]): Promise<boolean>;
  /** Atomically writes graded answers and transitions one in-progress attempt. */
  finalizeAttempt(
    id: string,
    patch: Partial<ExamAttemptRecord>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ): Promise<ExamFinalizeResult>;
  /**
   * Atomically writes ONE manual draft score under the attempt-row lock, returning
   * false when the attempt is no longer `pending_manual`. It shares the lock with
   * `completeManualGrading` so a draft cannot land on an attempt whose total was
   * already published without it.
   */
  saveManualDraft(attemptId: string, answer: ExamAnswerRecord): Promise<boolean>;
  /**
   * Atomically completes one `pending_manual` attempt: writes the recomputed graded
   * answers, transitions to `graded` and stamps result availability. An attempt that
   * is already `graded` reports `transitioned: false` with its current state so a
   * retry or a lost race is idempotent rather than an error.
   */
  completeManualGrading(
    id: string,
    patch: Pick<ExamAttemptRecord, 'points' | 'maxPoints' | 'percent' | 'resultAvailableAt'>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ): Promise<ExamCompleteGradingResult>;
  /** Atomically preserves the first release timestamp for one graded attempt. */
  releaseAttempt(id: string, releasedAt: Date): Promise<ExamReleaseTransition>;
  upsertAnswers(answers: readonly ExamAnswerRecord[]): Promise<void>;
  listAnswers(attemptId: string): Promise<ExamAnswerRecord[]>;
  upsertGrade(grade: ExamGradeRecord): Promise<ExamGradeRecord>;
  /** Atomically appends no more than `limit` total events and returns the accepted count. */
  insertEvents(events: readonly ExamEventRecord[], limit: number): Promise<number>;
  countEvents(attemptId: string): Promise<number>;
  listExpiredInProgress(now: Date): Promise<ExamAttemptRecord[]>;
}

export interface Clock {
  now(): Date;
}

export interface BankQuestionSnapshot {
  id: string;
  versionId: string;
  grading: GradingQuestion;
  renders: Record<Locale, unknown>;
}

export type BankListQuery =
  | { from: string[] }
  | { filter: NonNullable<PoolSpec['filter']> };

export interface BankSource {
  listPublished(query: BankListQuery): Promise<BankQuestionSnapshot[]>;
}

export interface ExamItemContext {
  courseVersionId: string;
  item: CompiledItem;
  enrolled: boolean;
  defaultLocale: Locale;
  branchId?: string | null;
}

export type LoadExamItem = (
  actor: ExamActor,
  courseId: string,
  itemId: string,
) => Promise<ExamItemContext | null>;
