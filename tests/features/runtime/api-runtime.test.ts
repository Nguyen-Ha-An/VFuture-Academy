// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiRuntime, RuntimeError } from '@/features/runtime';
import type { RuntimeWriteTarget } from '@/features/runtime';
import type { AssignmentSessionResult } from '@/features/submissions/contracts';
import type { QuestionResult } from '@/content-engine/grading/types';
import type { RevealedInfo } from '@/content-engine/render/runtime';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string);
}

let activeRuntimes: ReturnType<typeof createApiRuntime>[] = [];

function makeRuntime(
  fetchMock: ReturnType<typeof vi.fn>,
  initialState: Record<string, unknown> = {},
  onWriteError?: (error: RuntimeError, target: RuntimeWriteTarget) => void,
  onWriteSuccess?: (target: RuntimeWriteTarget) => void,
  assignmentSessions?: Record<string, AssignmentSessionResult>,
) {
  const runtime = createApiRuntime({
    courseId: 'course-one',
    itemId: 'lesson-one',
    locale: 'en',
    initialState,
    fetchImpl: fetchMock as unknown as typeof fetch,
    onWriteError,
    onWriteSuccess,
    assignmentSessions,
  });
  activeRuntimes.push(runtime);
  return runtime;
}

describe('createApiRuntime', () => {
  beforeEach(() => {
    activeRuntimes = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const runtime of activeRuntimes) {
      if ('dispose' in runtime && typeof runtime.dispose === 'function') runtime.dispose();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caches immediately and coalesces rapid block changes into the last PUT after 800 ms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, { cards: { seen: ['initial'] } });

    expect(runtime.getBlockState('cards')).toEqual({ seen: ['initial'] });

    runtime.setBlockState('cards', { seen: ['a'] });
    runtime.setBlockState('cards', { seen: ['a', 'b'], completed: true });

    expect(runtime.getBlockState('cards')).toEqual({ seen: ['a', 'b'], completed: true });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/blocks/cards', expect.objectContaining({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    }));
    expect(requestBody(fetchMock)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      state: { seen: ['a', 'b'], completed: true },
      completed: true,
    });
  });

  it('debounces pending writes independently for each block', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: null })));
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('block-one', { value: 1 });
    await vi.advanceTimersByTimeAsync(400);
    runtime.setBlockState('block-two', { value: 2 });

    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/progress/blocks/block-one');

    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/progress/blocks/block-two');
  });

  it('keeps different block writes parallel while one block is in flight', async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('block-one', { value: 1 });
    runtime.setBlockState('block-two', { value: 2 });
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/progress/blocks/block-one',
      '/api/v1/progress/blocks/block-two',
    ]);

    resolveFirst(jsonResponse({ data: null }));
    await expect(runtime.flush()).resolves.toBeUndefined();
  });

  it('serializes replacement writes for one block so the latest state reaches the server last', async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse);
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('reflection-one', { text: 'older' });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    runtime.setBlockState('reflection-one', { text: 'newer' });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(jsonResponse({ data: null }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(fetchMock, 0)).toMatchObject({ state: { text: 'older' } });
    expect(requestBody(fetchMock, 1)).toMatchObject({ state: { text: 'newer' } });

    resolveSecond(jsonResponse({ data: null }));
    await expect(runtime.flush()).resolves.toBeUndefined();
  });

  it('does not report an obsolete write failure after the replacement succeeds', async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const writeError = vi.fn();
    const writeSuccess = vi.fn();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, {}, writeError, writeSuccess);

    runtime.setBlockState('reflection-one', { text: 'older' });
    await vi.advanceTimersByTimeAsync(800);
    runtime.setBlockState('reflection-one', { text: 'newer' });
    await vi.advanceTimersByTimeAsync(800);

    resolveFirst(jsonResponse({ error: { code: 'WRITE_FAILED', message: 'Old request failed' } }, 503));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(runtime.flush()).resolves.toBeUndefined();

    expect(writeError).not.toHaveBeenCalled();
    expect(writeSuccess).toHaveBeenCalledTimes(1);
    expect(writeSuccess).toHaveBeenCalledWith({ kind: 'block', blockId: 'reflection-one' });
  });

  it('posts quiz answers and unwraps the QuizSubmitResult data envelope', async () => {
    const result = {
      attemptId: 'attempt-one',
      results: [{ questionId: 'quiz-one/q1', status: 'correct', points: 2, maxPoints: 2 }],
      points: 2,
      maxPoints: 2,
      percent: 100,
      passed: true,
      attemptsRemaining: 2,
      revealed: { correctAnswers: { 'quiz-one/q1': 'a' }, explanations: {} },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: result }));
    const runtime = makeRuntime(fetchMock);

    await expect(runtime.submitQuiz('quiz-one', { 'quiz-one/q1': 'a' })).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/quizzes/submit', expect.objectContaining({ method: 'POST' }));
    expect(requestBody(fetchMock)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      quizId: 'quiz-one',
      answers: { 'quiz-one/q1': 'a' },
    });
  });

  it('posts a per-question check and unwraps its result', async () => {
    const result = {
      questionId: 'quiz-one/q1',
      status: 'incorrect',
      points: 0,
      maxPoints: 2,
      revealed: { correctAnswers: { 'quiz-one/q1': 'a' } },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: result }));
    const runtime = makeRuntime(fetchMock);

    const checked: Promise<QuestionResult & { revealed: RevealedInfo }> = runtime.checkQuestion(
      'quiz-one',
      'quiz-one/q1',
      'b',
    );
    await expect(checked).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/quizzes/check', expect.objectContaining({ method: 'POST' }));
    expect(requestBody(fetchMock)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      quizId: 'quiz-one',
      questionId: 'quiz-one/q1',
      answer: 'b',
    });
  });

  it('posts an explicit standalone assignment locator and stable expected latest id', async () => {
    const result = {
      created: true,
      session: {
        locator: { courseId: 'course-one', itemId: 'lesson-one', blockId: null },
        courseVersionId: 'version-one', attemptsUsed: 1, submissions: [],
        action: { allowed: true, kind: 'revision', expectedLatestSubmissionId: 'submission-one', nextAttemptNo: 2 },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: result }));
    const runtime = makeRuntime(fetchMock);
    const payload = { text: 'My response', links: [{ url: 'https://example.com/work' }] };

    await expect(runtime.submitAssignment({ blockId: null }, payload, 'submission-zero')).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/assignments/submit', expect.objectContaining({ method: 'POST' }));
    expect(requestBody(fetchMock)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      blockId: null,
      expectedLatestSubmissionId: 'submission-zero',
      payload,
    });
  });

  it('hydrates standalone and inline assignment sessions by explicit presentation key', () => {
    const standalone = {
      locator: { courseId: 'course-one', itemId: 'lesson-one', blockId: null },
      courseVersionId: 'version-one', attemptsUsed: 0, submissions: [],
      action: { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 },
    } satisfies AssignmentSessionResult;
    const inline = {
      ...standalone,
      locator: { ...standalone.locator, blockId: 'inline-assignment' },
    } satisfies AssignmentSessionResult;
    const runtime = makeRuntime(vi.fn(), {}, undefined, undefined, {
      'lesson-one': standalone,
      'inline-assignment': inline,
    });

    expect(runtime.getAssignmentSession({ blockId: null })).toBe(standalone);
    expect(runtime.getAssignmentSession({ blockId: 'inline-assignment' })).toBe(inline);
  });

  it('refreshes and caches the canonical assignment session for the exact target', async () => {
    const refreshed = {
      locator: { courseId: 'course-one', itemId: 'lesson-one', blockId: 'inline-assignment' },
      courseVersionId: 'version-one', attemptsUsed: 2, submissions: [],
      action: { allowed: true, kind: 'revision', expectedLatestSubmissionId: 'submission-two', nextAttemptNo: 3 },
    } satisfies AssignmentSessionResult;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: refreshed }));
    const runtime = makeRuntime(fetchMock);

    const result = await runtime.refreshAssignmentSession({ blockId: 'inline-assignment' });
    expect(result).toEqual(refreshed);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/assignments/lesson-one/submissions?courseId=course-one&blockId=inline-assignment',
      { method: 'GET' },
    );
    expect(runtime.getAssignmentSession({ blockId: 'inline-assignment' })).toBe(result);
  });

  it('does not infer standalone location when an inline block reuses the item id', async () => {
    const result = { created: false, session: { submissions: [] } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: result }));
    const runtime = makeRuntime(fetchMock);

    await runtime.submitAssignment({ blockId: 'lesson-one' }, { text: 'Inline' }, null);

    expect(requestBody(fetchMock)).toMatchObject({
      courseId: 'course-one', itemId: 'lesson-one', blockId: 'lesson-one', expectedLatestSubmissionId: null,
    });
  });

  it('uploads a standalone assignment file with the explicit null target', async () => {
    const uploaded = { assetId: 'asset-one', name: 'answer.pdf', size: 4, mime: 'application/pdf' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: uploaded }));
    const runtime = makeRuntime(fetchMock);
    const file = new File(['work'], 'answer.pdf', { type: 'application/pdf' });

    await expect(runtime.uploadAssignmentFile({ blockId: null }, file)).resolves.toEqual(uploaded);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/uploads');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    expect((init.body as FormData).get('courseId')).toBe('course-one');
    expect((init.body as FormData).get('itemId')).toBe('lesson-one');
    expect((init.body as FormData).has('blockId')).toBe(false);
  });

  it('includes an inline assignment block id in multipart uploads', async () => {
    const uploaded = { assetId: 'asset-one', name: 'answer.pdf', size: 4, mime: 'application/pdf' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: uploaded }));
    const runtime = makeRuntime(fetchMock);
    const file = new File(['work'], 'answer.pdf', { type: 'application/pdf' });

    await runtime.uploadAssignmentFile({ blockId: 'inline-assignment' }, file);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as FormData).get('blockId')).toBe('inline-assignment');
  });

  it('reports real XHR upload progress and carries the inline locator', async () => {
    let sent: FormData | null = null;
    class FakeXhr {
      status = 200;
      responseText = JSON.stringify({ data: { assetId: 'asset-one', name: 'answer.pdf', size: 4, mime: 'application/pdf' } });
      withCredentials = false;
      private listeners = new Map<string, () => void>();
      upload = { addEventListener: (_name: string, listener: (event: ProgressEvent) => void) => {
        this.progress = listener;
      } };
      private progress: ((event: ProgressEvent) => void) | null = null;
      open = vi.fn();
      addEventListener = (name: string, listener: () => void) => { this.listeners.set(name, listener); };
      send = (body: FormData) => {
        sent = body;
        this.progress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent);
        this.listeners.get('load')?.();
      };
      abort = () => this.listeners.get('abort')?.();
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const runtime = makeRuntime(vi.fn());
    const progress = vi.fn();

    await runtime.uploadAssignmentFile(
      { blockId: 'inline-assignment' },
      new File(['work'], 'answer.pdf', { type: 'application/pdf' }),
      { onProgress: progress },
    );

    expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 4, percent: 50 });
    expect(progress).toHaveBeenLastCalledWith({ loaded: 4, total: 4, percent: 100 });
    expect(sent).not.toBeNull();
    expect(sent!.get('blockId')).toBe('inline-assignment');
  });

  it('aborts an in-flight XHR assignment upload from the caller signal', async () => {
    class PendingXhr {
      status = 0;
      responseText = '';
      withCredentials = false;
      private listeners = new Map<string, () => void>();
      upload = { addEventListener: () => undefined };
      open = vi.fn();
      addEventListener = (name: string, listener: () => void) => { this.listeners.set(name, listener); };
      send = vi.fn();
      abort = () => this.listeners.get('abort')?.();
    }
    vi.stubGlobal('XMLHttpRequest', PendingXhr);
    const runtime = makeRuntime(vi.fn());
    const controller = new AbortController();
    const upload = runtime.uploadAssignmentFile(
      { blockId: null },
      new File(['work'], 'answer.pdf', { type: 'application/pdf' }),
      { signal: controller.signal },
    );

    controller.abort();

    await expect(upload).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED', status: 0 });
  });

  it('maps an API error envelope to RuntimeError with its HTTP status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'NO_ATTEMPTS', message: 'No attempts remaining' },
    }, 409));
    const runtime = makeRuntime(fetchMock);

    try {
      await runtime.submitQuiz('quiz-one', {});
      expect.unreachable('submitQuiz should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect(error).toMatchObject({
        name: 'RuntimeError',
        code: 'NO_ATTEMPTS',
        message: 'No attempts remaining',
        status: 409,
      });
    }
  });

  it('retries a failed PUT once after a network failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('reflection-one', { text: 'Saved' });
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-arms a failed block PUT with backoff and stops after three attempts', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({
      error: { code: 'WRITE_FAILED', message: 'Could not save progress' },
    }, 503)));
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('reflection-one', { text: 'Keep trying' });

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_599);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a failed block write and retains it for a successful retry', async () => {
    const writeError = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'WRITE_FAILED', message: 'Could not save progress' },
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, {}, writeError);

    runtime.setBlockState('reflection-one', { text: 'Retry me' });
    await vi.advanceTimersByTimeAsync(800);

    expect(writeError).toHaveBeenCalledTimes(1);
    expect(writeError).toHaveBeenCalledWith(expect.objectContaining({
      name: 'RuntimeError',
      code: 'WRITE_FAILED',
      message: 'Could not save progress',
      status: 503,
    }), { kind: 'block', blockId: 'reflection-one' });

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writeError).toHaveBeenCalledTimes(1);
  });

  it('reports a failed viewed write and lets the learner retry it explicitly', async () => {
    const writeError = vi.fn();
    const writeSuccess = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'WRITE_FAILED', message: 'Could not save progress' },
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'in_progress' } }));
    const runtime = makeRuntime(fetchMock, {}, writeError, writeSuccess);

    runtime.markViewed();
    await vi.runAllTimersAsync();

    expect(writeError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'WRITE_FAILED',
      status: 503,
    }), { kind: 'viewed' });

    await expect(runtime.retry()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writeSuccess).toHaveBeenCalledWith({ kind: 'viewed' });
  });

  it('shares the automatic viewed request with an awaited completion request', async () => {
    let resolveViewed!: (response: Response) => void;
    const viewedResponse = new Promise<Response>((resolve) => { resolveViewed = resolve; });
    const fetchMock = vi.fn(() => viewedResponse);
    const runtime = makeRuntime(fetchMock);

    runtime.markViewed();
    const completion = runtime.completeViewed();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveViewed(jsonResponse({ data: { status: 'completed' } }));
    await expect(completion).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not report a successful flush for exhausted unsaved writes', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'offline' } }, 503));
    const runtime = makeRuntime(fetchMock);
    runtime.setBlockState('q', { answer: 'a' });
    await vi.runAllTimersAsync();
    await expect(runtime.flush()).rejects.toThrow();
    fetchMock.mockImplementation(async () => jsonResponse({ data: {} }));
    await expect(runtime.retry()).resolves.toBeUndefined();
    expect(runtime.hasPendingWrites()).toBe(false);
  });

  it('retries a block write after automatic attempts have been exhausted', async () => {
    const writeSuccess = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'WRITE_FAILED', message: 'No' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'WRITE_FAILED', message: 'No' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'WRITE_FAILED', message: 'No' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, {}, undefined, writeSuccess);

    runtime.setBlockState('reflection-one', { text: 'Keep this', completed: true });
    await vi.advanceTimersByTimeAsync(3_200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(runtime.retry()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(writeSuccess).toHaveBeenCalledWith({ kind: 'block', blockId: 'reflection-one' });
  });

  it('does not retry a non-idempotent POST after a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    const runtime = makeRuntime(fetchMock);

    await expect(runtime.submitQuiz('quiz-one', {})).rejects.toMatchObject({
      name: 'RuntimeError',
      code: 'NETWORK_ERROR',
      status: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks an item viewed only once for a runtime instance', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock);

    runtime.markViewed();
    runtime.markViewed();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/viewed', expect.objectContaining({ method: 'POST' }));
    expect(requestBody(fetchMock)).toEqual({ courseId: 'course-one', itemId: 'lesson-one' });
  });

  it('resolves media assets through the authenticated media route and preserves HTTPS URLs', () => {
    const runtime = makeRuntime(vi.fn());

    expect(runtime.resolveMedia({ assetId: 'asset one' })).toBe('/api/v1/media/asset%20one');
    expect(runtime.resolveMedia({ url: 'https://cdn.example.com/lesson.mp4' })).toBe('https://cdn.example.com/lesson.mp4');
  });

  it.each([
    [{ kind: 'lesson', id: 'lesson-two' }, '/app/courses/course-one/items/lesson-two'],
    [{ kind: 'exam', id: 'exam-one' }, '/app/courses/course-one/items/exam-one'],
    [{ kind: 'course', id: 'course-two' }, '/app/courses/course-two'],
    [{ kind: 'resource', id: 'guide-one' }, '/app/resources/guide-one'],
    [{ kind: 'opportunity', id: 'internship-one' }, '/app/opportunities/internship-one'],
    [{ kind: 'url', url: 'https://example.com/next' }, 'https://example.com/next'],
  ] as const)('maps the %s target to %s', (target, expected) => {
    const runtime = makeRuntime(vi.fn());

    expect(runtime.hrefFor(target)).toBe(expected);
  });

  it('preserves existing activity state when marking the block complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, { 'reflection-one': { text: 'A thought' } });

    runtime.onActivityComplete('reflection-one');

    expect(runtime.getBlockState('reflection-one')).toEqual({ text: 'A thought', completed: true });
    await vi.advanceTimersByTimeAsync(800);
    expect(requestBody(fetchMock)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      state: { text: 'A thought', completed: true },
      completed: true,
    });
  });

  it.each([
    ['a 204 response', () => new Response(null, { status: 204 })],
    ['an ok(undefined) envelope', () => jsonResponse({ data: undefined })],
  ])('accepts %s when flushing a pending write', async (_label, response) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('cards', { seen: ['a'] });

    await expect(runtime.flush()).resolves.toBeUndefined();
  });

  it('flushes one keepalive PUT per pending block without double-sending lifecycle events', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: null })));
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('cards', { seen: ['a'] });
    runtime.setBlockState('cards', { seen: ['a', 'b'], completed: true });
    runtime.setBlockState('reflection', { text: 'Ready' });
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/progress/blocks/cards', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/progress/blocks/reflection', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }));
    expect(requestBody(fetchMock, 0)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      state: { seen: ['a', 'b'], completed: true },
      completed: true,
    });
    expect(requestBody(fetchMock, 1)).toEqual({
      courseId: 'course-one',
      itemId: 'lesson-one',
      state: { text: 'Ready' },
      completed: false,
    });

    await runtime.flush();
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports item completion when a saved activity write completes the lesson', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { state: {}, completion: { lessons: { 'lesson-one': { complete: false } } } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { state: {}, completion: { lessons: { 'lesson-one': { complete: true } } } } }));
    const onItemCompleted = vi.fn();
    const runtime = createApiRuntime({
      courseId: 'course-one',
      itemId: 'lesson-one',
      locale: 'en',
      initialState: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      onItemCompleted,
    });
    activeRuntimes.push(runtime);

    runtime.onActivityComplete('cards');
    await runtime.flush();
    expect(onItemCompleted).not.toHaveBeenCalled();

    runtime.onActivityComplete('reflection');
    await runtime.flush();
    expect(onItemCompleted).toHaveBeenCalledTimes(1);
  });

  it('flushes pending writes when the document becomes hidden', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: null })));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('cards', { seen: ['a'] });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/blocks/cards', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
    }));
    await runtime.flush();
  });

  it('dispose removes lifecycle listeners, cancels timers, and flushes only once', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: null })));
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const runtime = makeRuntime(fetchMock);

    runtime.setBlockState('cards', { seen: ['a'] });
    runtime.dispose();

    expect(removeWindowListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/blocks/cards', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
    }));

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave retry timers running after a failed disposal flush', async () => {
    const writeError = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'WRITE_FAILED', message: 'Offline' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const runtime = makeRuntime(fetchMock, {}, writeError);

    runtime.setBlockState('reflection', { text: 'Keep this' });
    runtime.dispose();
    await vi.advanceTimersByTimeAsync(800);

    expect(writeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'WRITE_FAILED' }), { kind: 'block', blockId: 'reflection' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(runtime.hasPendingWrites()).toBe(true);
  });
});
