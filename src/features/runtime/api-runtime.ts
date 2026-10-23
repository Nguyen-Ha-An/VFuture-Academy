import type { Locale, MediaRef } from '@/content-engine/schema/common';
import type { NextStepTarget } from '@/content-engine/schema/types';
import type {
  AssignmentPayload,
  LessonRuntime,
  QuizSubmitResult,
  RevealedInfo,
  UploadedFile,
  UploadProgress,
} from '@/content-engine/render/runtime';
import type {
  AssignmentSessionResult,
  AssignmentSubmitResult,
  AssignmentTarget,
} from '@/features/submissions/contracts';
import type { QuestionResult } from '@/content-engine/grading/types';
import { routes } from '@/lib/routes';

const BLOCK_STATE_DEBOUNCE_MS = 800;
const MAX_BLOCK_WRITE_ATTEMPTS = 3;
const MEDIA_ROUTE = '/api/v1/media';

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

type PendingWrite = {
  state: unknown;
  timer: ReturnType<typeof setTimeout> | undefined;
  attempts: number;
  inFlight: Promise<void> | undefined;
};

export type RuntimeWriteTarget =
  | { kind: 'block'; blockId: string }
  | { kind: 'viewed' };

export type ApiRuntimeContext = {
  courseId: string;
  itemId: string;
  locale: Locale;
  initialState: Record<string, unknown>;
  assignmentSessions?: Record<string, AssignmentSessionResult>;
  fetchImpl?: typeof fetch;
  onWriteError?: (error: RuntimeError, target: RuntimeWriteTarget) => void;
  onWriteSuccess?: (target: RuntimeWriteTarget) => void;
  /** Fires when a saved block write reports this item's lesson as complete (activities-mode lessons). */
  onItemCompleted?: () => void;
};

export type ApiRuntime = LessonRuntime & {
  dispose(): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  completeViewed(): Promise<void>;
  hasPendingWrites(): boolean;
};

export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function completedOf(state: unknown): boolean {
  return isRecord(state) && state.completed === true;
}

function mediaHref(assetId: string): string {
  return `${MEDIA_ROUTE}/${encodeURIComponent(assetId)}`;
}

function networkMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Network request failed';
}

export function createApiRuntime(ctx: ApiRuntimeContext): ApiRuntime {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const state = new Map<string, unknown>(Object.entries(ctx.initialState));
  const assignmentSessions = new Map<string, AssignmentSessionResult>(Object.entries(ctx.assignmentSessions ?? {}));
  const pendingWrites = new Map<string, PendingWrite>();
  const blockWriteTails = new Map<string, Promise<void>>();
  let viewed = false;
  let viewedPending = false;
  let viewedInFlight: Promise<void> | undefined;
  let disposed = false;

  const assignmentKey = (target: AssignmentTarget) => target.blockId ?? ctx.itemId;

  const assignmentSessionUrl = (target: AssignmentTarget) => {
    const params = new URLSearchParams({ courseId: ctx.courseId });
    if (target.blockId !== null) params.set('blockId', target.blockId);
    return `/api/v1/assignments/${encodeURIComponent(ctx.itemId)}/submissions?${params}`;
  };

  const unwrap = async <T>(response: Response): Promise<T> => {
    if (response.ok && response.status === 204) return undefined as T;

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new RuntimeError(
        'INVALID_RESPONSE',
        response.ok ? 'API response was not valid JSON' : `Request failed with status ${response.status}`,
        response.status,
      );
    }

    if (!response.ok) {
      if (isErrorEnvelope(envelope)) {
        throw new RuntimeError(envelope.error.code, envelope.error.message, response.status);
      }
      throw new RuntimeError('HTTP_ERROR', `Request failed with status ${response.status}`, response.status);
    }

    if (!isRecord(envelope)) {
      throw new RuntimeError('INVALID_RESPONSE', 'API response did not contain data', response.status);
    }
    if (!Object.hasOwn(envelope, 'data')) {
      if (Object.keys(envelope).length === 0) return undefined as T;
      throw new RuntimeError('INVALID_RESPONSE', 'API response did not contain data', response.status);
    }
    return envelope.data as T;
  };

  const request = async <T>(url: string, init: RequestInit): Promise<T> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const attempts = method === 'GET' || method === 'PUT' ? 2 : 1;
    let lastNetworkError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await unwrap<T>(await fetchImpl(url, init));
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        lastNetworkError = error;
      }
    }

    throw new RuntimeError('NETWORK_ERROR', networkMessage(lastNetworkError), 0);
  };

  const requestJson = <T>(
    url: string,
    method: 'POST' | 'PUT',
    body: unknown,
    init?: Pick<RequestInit, 'keepalive'>,
  ): Promise<T> => request<T>(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });

  const assignmentForm = (target: AssignmentTarget, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('courseId', ctx.courseId);
    form.append('itemId', ctx.itemId);
    if (target.blockId !== null) form.append('blockId', target.blockId);
    return form;
  };

  const uploadWithProgress = (
    form: FormData,
    file: File,
    options: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void },
  ): Promise<UploadedFile> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    xhr.open('POST', '/api/v1/uploads');
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      const loaded = Math.min(event.loaded, total);
      options.onProgress?.({ loaded, total, percent: total > 0 ? Math.round((loaded / total) * 100) : 0 });
    });
    xhr.addEventListener('load', () => {
      cleanup();
      let envelope: unknown;
      try {
        envelope = JSON.parse(xhr.responseText);
      } catch {
        reject(new RuntimeError('INVALID_RESPONSE', 'Upload response was not valid JSON', xhr.status));
        return;
      }
      const body = isRecord(envelope) ? envelope : null;
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = isRecord(body?.error) ? body.error : null;
        reject(new RuntimeError(
          typeof error?.code === 'string' ? error.code : 'UPLOAD_FAILED',
          typeof error?.message === 'string' ? error.message : 'Upload failed',
          xhr.status,
        ));
        return;
      }
      if (!body || !isRecord(body.data)) {
        reject(new RuntimeError('INVALID_RESPONSE', 'Upload response did not contain data', xhr.status));
        return;
      }
      options.onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
      resolve(body.data as unknown as UploadedFile);
    });
    xhr.addEventListener('error', () => {
      cleanup();
      reject(new RuntimeError('NETWORK_ERROR', 'Upload failed', 0));
    });
    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new RuntimeError('UPLOAD_CANCELLED', 'Upload cancelled', 0));
    });
    if (options.signal?.aborted) {
      reject(new RuntimeError('UPLOAD_CANCELLED', 'Upload cancelled', 0));
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.send(form);
  });

  const blockPayload = (blockState: unknown) => ({
    courseId: ctx.courseId,
    itemId: ctx.itemId,
    state: blockState,
    completed: completedOf(blockState),
  });

  const blockUrl = (blockId: string) => `/api/v1/progress/blocks/${encodeURIComponent(blockId)}`;

  const putBlockState = (blockId: string, blockState: unknown, keepalive = false): Promise<unknown> => (
    requestJson(blockUrl(blockId), 'PUT', blockPayload(blockState), keepalive ? { keepalive: true } : undefined)
  );

  const notifyWriteError = (error: RuntimeError, target: RuntimeWriteTarget): void => {
    try {
      ctx.onWriteError?.(error, target);
    } catch {
      // Consumer callbacks must not interrupt persistence retries.
    }
  };

  const notifyWriteSuccess = (target: RuntimeWriteTarget): void => {
    try {
      ctx.onWriteSuccess?.(target);
    } catch {
      // Consumer callbacks must not interrupt persistence.
    }
  };

  const notifyItemCompletion = (result: unknown): void => {
    const lessons = isRecord(result) && isRecord(result.completion) ? result.completion.lessons : null;
    const lesson = isRecord(lessons) ? lessons[ctx.itemId] : null;
    if (!isRecord(lesson) || lesson.complete !== true) return;
    try {
      ctx.onItemCompleted?.();
    } catch {
      // Consumer callbacks must not interrupt persistence.
    }
  };

  const retryDelay = (attempts: number): number => BLOCK_STATE_DEBOUNCE_MS * (2 ** (attempts - 1));

  function armPendingWrite(blockId: string, pending: PendingWrite, delay: number): void {
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      void writePending(blockId, pending).catch(() => undefined);
    }, delay);
  }

  function writePending(blockId: string, pending: PendingWrite, keepalive = false): Promise<void> {
    if (pendingWrites.get(blockId) !== pending || pending.attempts >= MAX_BLOCK_WRITE_ATTEMPTS) {
      return Promise.resolve();
    }
    if (pending.inFlight) return pending.inFlight;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }

    const predecessor = blockWriteTails.get(blockId);
    const operation = (async () => {
      if (predecessor) {
        await predecessor.catch(() => undefined);
        if (pendingWrites.get(blockId) !== pending || pending.attempts >= MAX_BLOCK_WRITE_ATTEMPTS) return;
      }
      pending.attempts += 1;
      try {
        const result = await putBlockState(blockId, pending.state, keepalive);
        notifyItemCompletion(result);
        if (pendingWrites.get(blockId) === pending) {
          pendingWrites.delete(blockId);
          notifyWriteSuccess({ kind: 'block', blockId });
        }
      } catch (error) {
        const runtimeError = error instanceof RuntimeError
          ? error
          : new RuntimeError('NETWORK_ERROR', networkMessage(error), 0);
        if (pendingWrites.get(blockId) === pending) {
          notifyWriteError(runtimeError, { kind: 'block', blockId });
          if (pending.attempts < MAX_BLOCK_WRITE_ATTEMPTS && !disposed) {
            armPendingWrite(blockId, pending, retryDelay(pending.attempts));
          }
        }
        throw runtimeError;
      } finally {
        if (pendingWrites.get(blockId) === pending) {
          pending.inFlight = undefined;
        }
      }
    })();
    pending.inFlight = operation;
    blockWriteTails.set(blockId, operation);
    const clearTail = () => {
      if (blockWriteTails.get(blockId) === operation) blockWriteTails.delete(blockId);
    };
    void operation.then(clearTail, clearTail);
    return operation;
  }

  const scheduleBlockWrite = (blockId: string, blockState: unknown): void => {
    const previous = pendingWrites.get(blockId);
    if (previous?.timer) clearTimeout(previous.timer);
    if (disposed) return;

    const pending: PendingWrite = {
      state: blockState,
      timer: undefined,
      attempts: 0,
      inFlight: undefined,
    };
    pendingWrites.set(blockId, pending);
    armPendingWrite(blockId, pending, BLOCK_STATE_DEBOUNCE_MS);
  };

  const flushPendingWrites = async (): Promise<void> => {
    const writes: Promise<void>[] = [];
    for (const [blockId, pending] of pendingWrites) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = undefined;
      }
      if (pending.attempts < MAX_BLOCK_WRITE_ATTEMPTS) {
        writes.push(writePending(blockId, pending, true));
      }
    }
    if (viewedPending) writes.push(writeViewed());
    await Promise.all(writes);
    if (pendingWrites.size > 0 || viewedPending) {
      throw new RuntimeError('WRITE_PENDING', 'Progress still has unsaved changes', 0);
    }
  };

  function writeViewed(): Promise<void> {
    if (viewed) return Promise.resolve();
    if (viewedInFlight) return viewedInFlight;
    viewedPending = true;
    const operation = requestJson('/api/v1/progress/viewed', 'POST', {
      courseId: ctx.courseId,
      itemId: ctx.itemId,
    }).then(() => {
      viewed = true;
      viewedPending = false;
      notifyWriteSuccess({ kind: 'viewed' });
    }).catch((error: unknown) => {
      const runtimeError = error instanceof RuntimeError
        ? error
        : new RuntimeError('NETWORK_ERROR', networkMessage(error), 0);
      viewedPending = true;
      notifyWriteError(runtimeError, { kind: 'viewed' });
      throw runtimeError;
    }).finally(() => {
      viewedInFlight = undefined;
    });
    viewedInFlight = operation;
    return operation;
  }

  const retryPendingWrites = async (): Promise<void> => {
    for (const pending of pendingWrites.values()) {
      pending.attempts = 0;
    }
    await flushPendingWrites();
  };

  const hasPendingWrites = (): boolean => pendingWrites.size > 0 || viewedPending;

  const handleLifecycleFlush = (): void => {
    void flushPendingWrites().catch(() => undefined);
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasPendingWrites()) return;
    handleLifecycleFlush();
    event.preventDefault();
    event.returnValue = '';
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') handleLifecycleFlush();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleLifecycleFlush);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleLifecycleFlush);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    for (const pending of pendingWrites.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = undefined;
      }
    }
    void flushPendingWrites().catch(() => undefined);
  };

  return {
    mode: 'learner',
    locale: ctx.locale,
    dispose,
    flush: flushPendingWrites,
    retry: retryPendingWrites,
    completeViewed: writeViewed,
    hasPendingWrites,
    getBlockState: <T,>(blockId: string) => state.get(blockId) as T | undefined,
    setBlockState: <T,>(blockId: string, blockState: T) => {
      state.set(blockId, blockState);
      scheduleBlockWrite(blockId, blockState);
    },
    getAssignmentSession: (target) => assignmentSessions.get(assignmentKey(target)),
    refreshAssignmentSession: async (target) => {
      const session = await request<AssignmentSessionResult>(assignmentSessionUrl(target), { method: 'GET' });
      assignmentSessions.set(assignmentKey(target), session);
      return session;
    },
    submitQuiz: (quizId, answers) => requestJson<QuizSubmitResult>('/api/v1/quizzes/submit', 'POST', {
      courseId: ctx.courseId,
      itemId: ctx.itemId,
      quizId,
      answers,
    }),
    checkQuestion: (quizId, questionId, answer) => requestJson<QuestionResult & { revealed: RevealedInfo }>(
      '/api/v1/quizzes/check',
      'POST',
      {
        courseId: ctx.courseId,
        itemId: ctx.itemId,
        quizId,
        questionId,
        answer,
      },
    ),
    submitAssignment: async (target, payload: AssignmentPayload, expectedLatestSubmissionId) => {
      const result = await requestJson<AssignmentSubmitResult>('/api/v1/assignments/submit', 'POST', {
        courseId: ctx.courseId,
        itemId: ctx.itemId,
        blockId: target.blockId,
        expectedLatestSubmissionId,
        payload,
      });
      assignmentSessions.set(assignmentKey(target), result.session);
      return result;
    },
    uploadAssignmentFile: (target, file, options) => {
      const form = assignmentForm(target, file);
      return options
        ? uploadWithProgress(form, file, options)
        : request<UploadedFile>('/api/v1/uploads', { method: 'POST', body: form });
    },
    uploadFile: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('courseId', ctx.courseId);
      form.append('itemId', ctx.itemId);
      return request<UploadedFile>('/api/v1/uploads', { method: 'POST', body: form });
    },
    resolveMedia: (ref: MediaRef) => ('url' in ref ? ref.url : mediaHref(ref.assetId)),
    hrefFor: (target: NextStepTarget | { kind: 'resource' | 'opportunity'; id: string }) => {
      if ('url' in target) return target.url;
      if (target.kind === 'lesson' || target.kind === 'exam') return routes.learner.courseItem(ctx.courseId, target.id);
      if (target.kind === 'course') return routes.learner.course(target.id);
      if (target.kind === 'resource') return routes.learner.resource(target.id);
      return routes.learner.opportunity(target.id);
    },
    notebookHref: (target) => `${routes.learner.courseItem(ctx.courseId, ctx.itemId)}/notebook${target.blockId ? '?blockId=' + encodeURIComponent(target.blockId) : ''}`,
    markViewed: () => {
      void writeViewed().catch(() => undefined);
    },
    onActivityComplete: (blockId: string) => {
      const current = state.get(blockId);
      const completed = isRecord(current) ? { ...current, completed: true } : { completed: true };
      state.set(blockId, completed);
      scheduleBlockWrite(blockId, completed);
    },
  };
}
