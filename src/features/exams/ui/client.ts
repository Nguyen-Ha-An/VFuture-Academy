import type {
  ExamReviewResult,
  ExamSessionResult,
  ExamStartResult,
  ExamSubmitResult,
} from '../service';
import type {
  ExamAnswerRecord,
  ExamEventInput,
} from '../types';

export interface ExamClient {
  session(): Promise<ExamSessionResult>;
  start(): Promise<ExamStartResult>;
  save(answers: Record<string, unknown>): Promise<ExamAnswerRecord[]>;
  submit(): Promise<ExamSubmitResult>;
  review(): Promise<ExamReviewResult>;
  events(events: readonly ExamEventInput[]): Promise<{ accepted: number; dropped: number }>;
  serverNow(): Promise<Date>;
}

/**
 * Per-attempt request timeout. It intentionally exceeds the gateway's 20 s JSON
 * timeout so the gateway answers (with its own 504) before the client gives up;
 * a client timeout therefore means the gateway itself never answered.
 */
export const EXAM_REQUEST_TIMEOUT_MS = 30_000;
/** At most this many tries (first call included) for a retryable request. */
export const EXAM_MAX_ATTEMPTS = 3;
/** Full-jitter exponential backoff between tries: random(0, min(cap, base * 2^n)). */
export const EXAM_BACKOFF_BASE_MS = 500;
export const EXAM_BACKOFF_CAP_MS = 8_000;
/**
 * The longest a single request will sleep before retrying. A longer Retry-After is
 * surfaced immediately (retryAfterMs) so the caller can schedule the next try.
 */
export const EXAM_MAX_INLINE_RETRY_WAIT_MS = 10_000;
/** Sanity ceiling for a parsed Retry-After so a hostile value cannot overflow timers. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;

export type HttpExamClientOptions = {
  courseId: string;
  itemId: string;
  attemptId?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Per-attempt timeout; defaults to EXAM_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Waits between retries; injectable so tests do not need real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1); injectable so tests are deterministic. */
  random?: () => number;
};

export type ExamRequestErrorDetails = {
  ambiguous?: boolean;
  retryAfterMs?: number;
};

export class ExamRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * A write may have been committed even though the client never saw the answer
   * (timeout, network failure, 502/504). Callers must reconcile before assuming
   * either outcome.
   */
  readonly ambiguous: boolean;
  /** The server's Retry-After, in milliseconds, when it sent a usable one. */
  readonly retryAfterMs?: number;

  constructor(status: number, code: string, message: string, details: ExamRequestErrorDetails = {}) {
    super(message);
    this.name = 'ExamRequestError';
    this.status = status;
    this.code = code;
    this.ambiguous = details.ambiguous === true;
    if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs;
  }
}

/**
 * Parses Retry-After (delta-seconds or HTTP-date) into milliseconds. Negative values
 * and past dates clamp to zero; anything unparseable is ignored.
 */
export function parseRetryAfterMs(value: string | null, serverNowMs: number): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  if (/^-\d+$/.test(text)) return 0;
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1_000, MAX_RETRY_AFTER_MS);
  if (!/^[A-Za-z]{3},\s/.test(text)) return undefined;
  const date = Date.parse(text);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - serverNowMs), MAX_RETRY_AFTER_MS);
}

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);
// A server error may occur after the mutation committed (for example during
// grade recomputation), so a 500 is not evidence that the submission failed.
const AMBIGUOUS_WRITE_STATUSES = new Set([500, 502, 504]);

type RequestPolicy = {
  /** Transient failures (network, 408, 429, 502, 503, 504) are retried inside the call. */
  retry: boolean;
  /** A timed-out attempt is retried as well; only for reads, writes are retried by their caller. */
  retryTimeout: boolean;
  /** The request writes state, so an unanswered attempt may have been committed. */
  mutates: boolean;
};

/** GET: always safe to repeat. */
const READ: RequestPolicy = { retry: true, retryTimeout: true, mutates: false };
/** PUT answers / POST start: the server makes repeats harmless, but a timeout is left to the caller. */
const IDEMPOTENT_WRITE: RequestPolicy = { retry: true, retryTimeout: false, mutates: true };
/** Submit and events: sent once; submit reconciles ambiguity, events are best effort. */
const ONCE: RequestPolicy = { retry: false, retryTimeout: false, mutates: true };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function dateValue(value: unknown): Date {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Exam API returned an invalid date');
  return date;
}

function startResult(value: unknown): ExamStartResult {
  const result = record(value) as unknown as ExamStartResult;
  const deadlines = record(result.sectionDeadlines) ?? {};
  return {
    ...result,
    startedAt: dateValue(result.startedAt),
    deadlineAt: result.deadlineAt === null ? null : dateValue(result.deadlineAt),
    sectionDeadlines: Object.fromEntries(Object.entries(deadlines).map(([sectionId, deadline]) => [
      sectionId,
      deadline === null ? null : dateValue(deadline),
    ])),
  };
}

function answerRecords(value: unknown): ExamAnswerRecord[] {
  if (!Array.isArray(value)) throw new Error('Exam API returned invalid answers');
  return value.map((entry) => {
    const answer = record(entry) as unknown as ExamAnswerRecord;
    return { ...answer, updatedAt: dateValue(answer.updatedAt) };
  });
}

function sessionResult(value: unknown): ExamSessionResult {
  const result = record(value);
  if (!result || typeof result.attemptsUsed !== 'number' || !Number.isInteger(result.attemptsUsed) || result.attemptsUsed < 0) {
    throw new Error('Exam API returned an invalid session');
  }
  return {
    attemptsUsed: result.attemptsUsed,
    attempt: result.attempt === null ? null : startResult(result.attempt),
  };
}

export function createHttpExamClient(options: HttpExamClientOptions): ExamClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? EXAM_REQUEST_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let attemptId = options.attemptId;
  let serverOffsetMs: number | null = null;
  /** Attempt whose last submit ended without a definitive answer; the next submit reconciles first. */
  let unresolvedSubmitFor: string | null = null;
  let submitRetryAtMs = 0;

  const activeAttemptId = () => {
    if (!attemptId) throw new Error('ExamClient.start() must complete before attempt actions.');
    return attemptId;
  };

  const serverNowMs = () => now().getTime() + (serverOffsetMs ?? 0);

  /** One HTTP exchange (headers and body) bounded by the per-attempt timeout. */
  async function exchange<T>(url: string, init: RequestInit, mutates: boolean): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ExamRequestError(0, 'REQUEST_TIMEOUT', 'Exam request timed out', { ambiguous: mutates }));
      }, timeoutMs);
    });

    const run = async (): Promise<T> => {
      let response: Response;
      try {
        response = await fetcher(url, { ...init, credentials: 'same-origin', signal: controller.signal });
      } catch {
        throw new ExamRequestError(0, 'NETWORK_ERROR', 'Exam request could not reach the server', { ambiguous: mutates });
      }
      const serverDate = response.headers.get('date');
      if (serverDate) {
        const serverTime = Date.parse(serverDate);
        if (Number.isFinite(serverTime)) serverOffsetMs = serverTime - now().getTime();
      }

      const failure = (code: string, message: string) => new ExamRequestError(response.status, code, message, {
        ambiguous: mutates && AMBIGUOUS_WRITE_STATUSES.has(response.status),
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), serverNowMs()),
      });
      const invalidResponse = () => new ExamRequestError(
        response.status, 'INVALID_RESPONSE', 'Exam API returned an invalid response', { ambiguous: mutates },
      );

      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      const isJson = mediaType === 'application/json' || mediaType.endsWith('+json');
      if (!response.ok && !isJson) throw failure('EXAM_REQUEST_FAILED', 'Exam request failed');
      if (!isJson) {
        throw invalidResponse();
      }

      let payload: Record<string, unknown> | null;
      try {
        payload = record(await response.json());
      } catch {
        throw response.ok
          ? invalidResponse()
          : failure('EXAM_REQUEST_FAILED', 'Exam request failed');
      }
      if (!response.ok) {
        const error = record(payload?.error);
        throw failure(
          typeof error?.code === 'string' ? error.code : 'EXAM_REQUEST_FAILED',
          typeof error?.message === 'string' ? error.message : 'Exam request failed',
        );
      }
      if (!payload || !Object.hasOwn(payload, 'data')) {
        throw invalidResponse();
      }
      return payload.data as T;
    };

    const exchangePromise = run();
    // When the timeout wins, the abandoned exchange may still reject; that must not surface.
    exchangePromise.catch(() => undefined);
    try {
      return await Promise.race([exchangePromise, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  const jitter = (attemptNumber: number) => {
    const window = Math.min(EXAM_BACKOFF_CAP_MS, EXAM_BACKOFF_BASE_MS * 2 ** (attemptNumber - 1));
    const unit = Math.min(Math.max(random(), 0), 0.999999);
    return Math.floor(unit * window);
  };

  const isTransient = (error: ExamRequestError, policy: RequestPolicy) => {
    if (error.code === 'REQUEST_TIMEOUT') return policy.retryTimeout;
    if (error.code === 'NETWORK_ERROR') return true;
    return RETRYABLE_STATUSES.has(error.status);
  };

  async function request<T>(url: string, init: RequestInit, policy: RequestPolicy): Promise<T> {
    for (let attemptNumber = 1; ; attemptNumber += 1) {
      try {
        return await exchange<T>(url, init, policy.mutates);
      } catch (error) {
        if (!(error instanceof ExamRequestError) || !policy.retry
          || attemptNumber >= EXAM_MAX_ATTEMPTS || !isTransient(error, policy)) throw error;
        const backoff = jitter(attemptNumber);
        const requested = error.retryAfterMs;
        // A long Retry-After is the caller's to schedule; do not hold this request open.
        if (requested !== undefined && requested > EXAM_MAX_INLINE_RETRY_WAIT_MS) throw error;
        await sleep(requested === undefined ? backoff : Math.max(requested, backoff));
      }
    }
  }

  const attemptUrl = (suffix: string, id = activeAttemptId()) => (
    `/api/v1/exams/attempts/${encodeURIComponent(id)}/${suffix}`
  );

  /** Reads the session without touching the bound attempt, so reconciliation cannot rebind the client. */
  async function fetchSession(): Promise<ExamSessionResult> {
    const query = new URLSearchParams({ courseId: options.courseId });
    return sessionResult(await request(
      `/api/v1/exams/${encodeURIComponent(options.itemId)}/attempts?${query}`,
      { method: 'GET', cache: 'no-store' },
      READ,
    ));
  }

  /** One submit POST. Only an unanswered (ambiguous) outcome leaves the attempt unresolved. */
  async function postSubmit(id: string): Promise<ExamSubmitResult> {
    const retryWait = unresolvedSubmitFor === id ? Math.max(0, submitRetryAtMs - now().getTime()) : 0;
    if (retryWait > EXAM_MAX_INLINE_RETRY_WAIT_MS) throw outcomeUnknown();
    if (retryWait > 0) await sleep(retryWait);
    submitRetryAtMs = 0;
    try {
      const result = await request<ExamSubmitResult>(attemptUrl('submit', id), { method: 'POST' }, ONCE);
      const acknowledged = record(result);
      if (acknowledged?.attemptId !== id
        || (acknowledged.status !== 'graded' && acknowledged.status !== 'pending_manual')) {
        throw new ExamRequestError(200, 'INVALID_RESPONSE', 'Exam API did not confirm submission', { ambiguous: true });
      }
      if (unresolvedSubmitFor === id) unresolvedSubmitFor = null;
      return result;
    } catch (error) {
      if (error instanceof ExamRequestError && error.ambiguous) {
        unresolvedSubmitFor = id;
        submitRetryAtMs = now().getTime() + (error.retryAfterMs ?? 0);
      }
      else if (unresolvedSubmitFor === id) unresolvedSubmitFor = null;
      throw error;
    }
  }

  const outcomeUnknown = () => new ExamRequestError(
    0,
    'SUBMIT_OUTCOME_UNKNOWN',
    'The server did not confirm whether the exam was submitted',
    { ambiguous: true, retryAfterMs: submitRetryAtMs > now().getTime() ? submitRetryAtMs - now().getTime() : undefined },
  );

  /**
   * After an unanswered submit, learn the attempt's real state before sending another
   * POST: a duplicate submit must never be the way the client discovers the outcome.
   */
  async function reconcileSubmit(id: string): Promise<ExamSubmitResult> {
    unresolvedSubmitFor = id;
    let observed: ExamStartResult | null;
    try {
      const session = await fetchSession();
      observed = session.attempt?.attemptId === id ? session.attempt : null;
    } catch {
      throw outcomeUnknown();
    }
    if (!observed) throw outcomeUnknown();

    if (observed.status === 'graded' || observed.status === 'pending_manual') {
      // The server answers a repeated submit of a finished attempt with the same result.
      return postSubmit(id);
    }
    if (observed.status === 'expired') {
      unresolvedSubmitFor = null;
      throw new ExamRequestError(409, 'DEADLINE_PASSED', 'Late submissions are rejected for this exam.');
    }
    if (observed.status !== 'in_progress') {
      unresolvedSubmitFor = null;
      throw new ExamRequestError(409, 'ATTEMPT_NOT_ACTIVE', 'Only an in-progress attempt can be submitted.');
    }
    // The earlier POST did not take effect (yet); submit once more after a short backoff.
    await sleep(jitter(1));
    return postSubmit(id);
  }

  return {
    async session() {
      const result = await fetchSession();
      attemptId = result.attempt?.attemptId;
      return result;
    },
    async start() {
      const result = startResult(await request(
        `/api/v1/exams/${encodeURIComponent(options.itemId)}/attempts`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ courseId: options.courseId }),
        },
        IDEMPOTENT_WRITE,
      ));
      attemptId = result.attemptId;
      return result;
    },
    async save(answers) {
      return answerRecords(await request(attemptUrl('answers'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      }, IDEMPOTENT_WRITE));
    },
    async submit() {
      const id = activeAttemptId();
      if (unresolvedSubmitFor === id) return reconcileSubmit(id);
      try {
        return await postSubmit(id);
      } catch (error) {
        if (error instanceof ExamRequestError && error.ambiguous) return reconcileSubmit(id);
        throw error;
      }
    },
    async review() {
      return request<ExamReviewResult>(attemptUrl('review'), { method: 'GET' }, READ);
    },
    async events(events) {
      return request(attemptUrl('events'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      }, ONCE);
    },
    async serverNow() {
      const localNow = now();
      return new Date(localNow.getTime() + (serverOffsetMs ?? 0));
    },
  };
}
