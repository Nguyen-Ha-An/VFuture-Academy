import { WorkspaceApiError, readApiData } from '@/features/studio/ui/client';

/**
 * The finalized exam attempt state the grading UI needs after an explicit completion.
 *
 * Results Engine owns the exact `complete-grading` DTO. This module is the single integration
 * point. Extra DTO fields are ignored so the DTO can grow without touching the UI, but the
 * success path is strict about the fields the UI locks on: an attempt is only treated as
 * completed when the server says so with a final status AND an availability timestamp.
 */
export type CompletedExamAttempt = {
  attemptId: string | null;
  status: string;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  resultAvailableAt: string;
  releasedAt: string | null;
  /**
   * `false` when this request found the attempt already complete — an idempotent retry, or a
   * concurrent grader winning the race. Still authoritative final state, still locks the UI,
   * but it is not this grader's transition so it is not announced as one.
   */
  transitioned: boolean;
};

/** Server-computed completion gate from `GET /api/v1/studio/grading/exams/{attemptId}`. */
export type ManualGradingProgress = {
  total: number;
  scored: number;
  outstanding: string[];
  complete: boolean;
};

/**
 * A completion whose response could not be trusted. Recoverable: the caller keeps the grader's
 * edits and the attempt unlocked, and the idempotent endpoint can be retried.
 */
export class CompletionContractError extends Error {
  constructor(message = 'The completion response was incomplete') {
    super(message);
    this.name = 'CompletionContractError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Strict parse of a completion response, checked against the attempt the caller asked to
 * complete. Accepts `{ attempt: {...} }` or a bare attempt object and returns `null` unless the
 * server reported a fully formed, finished result:
 *
 * - `status` is exactly `graded` — the only terminal state completion produces. `expired`,
 *   `submitted` or an unknown status with a timestamp is a malformed success, not a completion.
 * - `resultAvailableAt` is a parseable timestamp — the field the learner's visibility hangs on.
 * - `points`, `maxPoints` and `percent` are all present, finite and mutually consistent, so the
 *   UI never shows a locked result with a blank or impossible score.
 * - `attemptId`, when the DTO carries one, is the attempt that was requested — a response for a
 *   different attempt must never lock this workbench.
 *
 * Anything else is a failure the caller reports as recoverable: nothing locks, every saved score
 * and unsaved edit is kept, and the idempotent endpoint can be retried.
 *
 * Historical detail reads are deliberately NOT routed through here: a pre-split attempt
 * legitimately has no availability timestamp and often no score, and the workbench reads those
 * fields tolerantly.
 */
export function parseCompletedExamAttempt(
  value: unknown,
  expectedAttemptId: string,
): CompletedExamAttempt | null {
  const outer = record(value);
  if (!outer) return null;
  const attempt = record(outer.attempt) ?? outer;

  if (attempt.status !== 'graded') return null;

  const resultAvailableAt = timestamp(attempt.resultAvailableAt) ?? timestamp(attempt.result_available_at);
  if (!resultAvailableAt) return null;

  const attemptId = text(attempt.attemptId) ?? text(attempt.attempt_id);
  if (attemptId !== null && attemptId !== expectedAttemptId) return null;

  const points = numeric(attempt.points);
  const maxPoints = numeric(attempt.maxPoints) ?? numeric(attempt.max_points);
  const percent = numeric(attempt.percent);
  if (points === null || maxPoints === null || percent === null) return null;
  if (points < 0 || maxPoints < 0 || points > maxPoints) return null;
  if (percent < 0 || percent > 100) return null;

  return {
    attemptId,
    status: attempt.status,
    points,
    maxPoints,
    percent,
    resultAvailableAt,
    releasedAt: timestamp(attempt.releasedAt) ?? timestamp(attempt.released_at),
    // Absent `transitioned` is read as a real transition: the alternative would silently
    // suppress the grader's own confirmation.
    transitioned: outer.transitioned !== false,
  };
}

/**
 * Reads `data.manualGrading` from the exam grading detail. Returns `null` when the field is
 * absent, so a detail response predating the field falls back to the caller's own derivation
 * instead of reporting "nothing to score".
 */
export function parseManualGradingProgress(value: unknown): ManualGradingProgress | null {
  const progress = record(record(value)?.manualGrading);
  if (!progress) return null;
  const total = numeric(progress.total);
  const scored = numeric(progress.scored);
  if (total === null || scored === null) return null;
  return {
    total,
    scored,
    outstanding: Array.isArray(progress.outstanding)
      ? progress.outstanding.flatMap((entry) => text(entry) ?? [])
      : [],
    complete: progress.complete === true,
  };
}

/** Error codes from `complete-grading` that leave the grader's saved scores and edits intact. */
const RECOVERABLE_COMPLETION_CODES = new Set([
  'MANUAL_GRADING_INCOMPLETE',
  'GRADING_CONFLICT',
  'ATTEMPT_NOT_ACTIVE',
  'LEGACY_RESULT_UNRELEASED',
  'INVALID_GRADE',
]);

export function completionErrorCode(cause: unknown): string | null {
  return cause instanceof WorkspaceApiError ? cause.code : null;
}

export function isRecoverableCompletionError(cause: unknown): boolean {
  const code = completionErrorCode(cause);
  return cause instanceof CompletionContractError
    || (code !== null && RECOVERABLE_COMPLETION_CODES.has(code));
}

export function completeGradingPath(attemptId: string): string {
  return `/api/v1/studio/exams/attempts/${encodeURIComponent(attemptId)}/complete-grading`;
}

/**
 * Finalizes a fully graded manual exam attempt. The body is `{}` per the published contract;
 * retries are idempotent and return the current final state, so a retry after a network error
 * or a malformed response is safe.
 */
export async function completeExamGrading(attemptId: string): Promise<CompletedExamAttempt> {
  const data = await readApiData<unknown>(await fetch(completeGradingPath(attemptId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }));
  const attempt = parseCompletedExamAttempt(data, attemptId);
  if (!attempt) throw new CompletionContractError();
  return attempt;
}

/** True while an attempt is still open for manual grading. */
export function isManualGradingOpen(status: unknown): boolean {
  return status === 'pending_manual';
}

/**
 * Historical results that were fully graded before result availability existed: finalized, with
 * neither an availability timestamp nor a legacy release. These keep the separate legacy release
 * affordance and are never auto-released.
 */
export function needsLegacyRelease(attempt: {
  status: unknown;
  resultAvailableAt: string | null;
  releasedAt: string | null;
}): boolean {
  return attempt.status === 'graded'
    && attempt.resultAvailableAt === null
    && attempt.releasedAt === null;
}
