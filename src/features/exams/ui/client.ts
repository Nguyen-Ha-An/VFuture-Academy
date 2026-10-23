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

export type HttpExamClientOptions = {
  courseId: string;
  itemId: string;
  attemptId?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
};

export class ExamRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ExamRequestError';
    this.status = status;
    this.code = code;
  }
}

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
  let attemptId = options.attemptId;
  let serverOffsetMs: number | null = null;

  const activeAttemptId = () => {
    if (!attemptId) throw new Error('ExamClient.start() must complete before attempt actions.');
    return attemptId;
  };

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetcher(url, { ...init, credentials: 'same-origin' });
    const serverDate = response.headers.get('date');
    if (serverDate) {
      const serverTime = Date.parse(serverDate);
      if (Number.isFinite(serverTime)) serverOffsetMs = serverTime - now().getTime();
    }

    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const isJson = mediaType === 'application/json' || mediaType.endsWith('+json');
    if (!response.ok && !isJson) {
      throw new ExamRequestError(response.status, 'EXAM_REQUEST_FAILED', 'Exam request failed');
    }
    if (!isJson) {
      throw new ExamRequestError(response.status, 'INVALID_RESPONSE', 'Exam API returned an invalid response');
    }

    let payload: Record<string, unknown> | null;
    try {
      payload = record(await response.json());
    } catch {
      throw new ExamRequestError(
        response.status,
        response.ok ? 'INVALID_RESPONSE' : 'EXAM_REQUEST_FAILED',
        response.ok ? 'Exam API returned an invalid response' : 'Exam request failed',
      );
    }
    if (!response.ok) {
      const error = record(payload?.error);
      throw new ExamRequestError(
        response.status,
        typeof error?.code === 'string' ? error.code : 'EXAM_REQUEST_FAILED',
        typeof error?.message === 'string' ? error.message : 'Exam request failed',
      );
    }
    if (!payload || !Object.hasOwn(payload, 'data')) {
      throw new ExamRequestError(response.status, 'INVALID_RESPONSE', 'Exam API returned an invalid response');
    }
    return payload.data as T;
  }

  const attemptUrl = (suffix: string) => (
    `/api/v1/exams/attempts/${encodeURIComponent(activeAttemptId())}/${suffix}`
  );

  return {
    async session() {
      const query = new URLSearchParams({ courseId: options.courseId });
      const result = sessionResult(await request(
        `/api/v1/exams/${encodeURIComponent(options.itemId)}/attempts?${query}`,
        { method: 'GET' },
      ));
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
      ));
      attemptId = result.attemptId;
      return result;
    },
    async save(answers) {
      return answerRecords(await request(attemptUrl('answers'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      }));
    },
    async submit() {
      return request<ExamSubmitResult>(attemptUrl('submit'), { method: 'POST' });
    },
    async review() {
      return request<ExamReviewResult>(attemptUrl('review'), { method: 'GET' });
    },
    async events(events) {
      return request(attemptUrl('events'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    },
    async serverNow() {
      const localNow = now();
      return new Date(localNow.getTime() + (serverOffsetMs ?? 0));
    },
  };
}
