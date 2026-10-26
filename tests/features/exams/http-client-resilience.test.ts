import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpExamClient,
  EXAM_MAX_ATTEMPTS,
  EXAM_MAX_INLINE_RETRY_WAIT_MS,
  EXAM_REQUEST_TIMEOUT_MS,
  ExamRequestError,
  parseRetryAfterMs,
} from '@/features/exams/ui/client';

const SERVER_DATE = 'Thu, 03 Sep 2026 05:00:00 GMT';
const ATTEMPT = 'attempt-1';

function ok(data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json', date: SERVER_DATE, ...headers },
  });
}

function failure(status: number, code = 'FAILED', headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message: `${code} message` } }), {
    status,
    headers: { 'content-type': 'application/json', date: SERVER_DATE, ...headers },
  });
}

function html(status: number) {
  return new Response('<html>upstream</html>', { status, headers: { 'content-type': 'text/html' } });
}

function sessionBody(attemptId: string | null, status = 'in_progress') {
  return {
    attemptsUsed: 1,
    attempt: attemptId === null ? null : {
      attemptId,
      attemptNo: 1,
      status,
      late: false,
      startedAt: '2026-09-03T05:00:00.000Z',
      deadlineAt: '2026-09-03T05:30:00.000Z',
      sectionDeadlines: {},
      answers: {},
      learner: { sections: [] },
    },
  };
}

const answerRow = {
  attemptId: ATTEMPT,
  questionId: 'concepts/q1',
  answer: 'a',
  result: null,
  manualPoints: null,
  manualFeedback: null,
  gradedBy: null,
  updatedAt: '2026-09-03T05:01:00.000Z',
};

const submitResult = { attemptId: ATTEMPT, status: 'graded', late: false, points: 1, maxPoints: 1, percent: 100, passed: true };

const networkFailure = () => Promise.reject(new TypeError('Failed to fetch'));

type Step = Response | ((init?: RequestInit) => Response | Promise<Response>);

/** Plays scripted responses in order; a function step may return or reject (network failure). */
function scripted(...steps: Step[]) {
  const queue = [...steps];
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const step = queue.shift();
    if (step === undefined) throw new Error('unexpected extra request');
    return typeof step === 'function' ? step(init) : step;
  });
}

function build(fetcher: ReturnType<typeof scripted>, overrides: { random?: () => number; timeoutMs?: number } = {}) {
  const sleep = vi.fn(async (_ms: number) => undefined);
  const client = createHttpExamClient({
    courseId: 'ai-foundations',
    itemId: 'exam-m1',
    attemptId: ATTEMPT,
    fetcher: fetcher as unknown as typeof fetch,
    sleep,
    random: overrides.random ?? (() => 0.5),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
  });
  return { client, sleep };
}

const calls = (fetcher: ReturnType<typeof scripted>) => fetcher.mock.calls.map(([url, init]) => (
  `${init?.method ?? 'GET'} ${String(url).replace('/api/v1/exams/', '')}`
));

const SUBMIT = `POST attempts/${ATTEMPT}/submit`;
const SESSION = 'GET exam-m1/attempts?courseId=ai-foundations';

async function settled<T>(promise: Promise<T>) {
  return promise.then((value) => ({ value }), (error: unknown) => ({ error }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('request timeout', () => {
  it('uses a 30 second per-attempt timeout that exceeds the gateway 20 second JSON timeout', () => {
    expect(EXAM_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(EXAM_REQUEST_TIMEOUT_MS).toBeGreaterThan(20_000);
  });

  it('aborts at 30 seconds and reports an ambiguous timeout for a write', async () => {
    vi.useFakeTimers();
    const seen: { signal?: AbortSignal } = {};
    const fetcher = scripted((init) => {
      seen.signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        seen.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const { client } = build(fetcher);

    const result = settled(client.save({ 'concepts/q1': 'a' }));
    await vi.advanceTimersByTimeAsync(EXAM_REQUEST_TIMEOUT_MS - 1);
    expect(seen.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const { error } = await result as { error: ExamRequestError };
    expect(error).toBeInstanceOf(ExamRequestError);
    expect(error).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT', ambiguous: true });
    expect(seen.signal?.aborted).toBe(true);
    // A timed-out save is never retried inside the request: autosave owns that retry.
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('times out even when the transport ignores the abort signal', async () => {
    vi.useFakeTimers();
    const fetcher = scripted(() => new Promise<Response>(() => {}));
    const { client } = build(fetcher, { timeoutMs: 1_000 });

    const result = settled(client.start());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(((await result) as { error: ExamRequestError }).error)
      .toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT', ambiguous: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('also bounds a response body that never finishes', async () => {
    vi.useFakeTimers();
    const hanging = new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const { client } = build(scripted(hanging), { timeoutMs: 1_000 });

    const result = settled(client.save({ 'concepts/q1': 'a' }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(((await result) as { error: ExamRequestError }).error).toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('retries a timed-out read and recovers on the next attempt', async () => {
    vi.useFakeTimers();
    const fetcher = scripted(() => new Promise<Response>(() => {}), ok(sessionBody(ATTEMPT)));
    const { client, sleep } = build(fetcher, { timeoutMs: 1_000 });

    const result = settled(client.session());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await result).toMatchObject({ value: { attemptsUsed: 1 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('does not call a timed-out read ambiguous', async () => {
    vi.useFakeTimers();
    const hang = () => new Promise<Response>(() => {});
    const { client } = build(scripted(hang, hang, hang), { timeoutMs: 500 });

    const result = settled(client.review());
    await vi.advanceTimersByTimeAsync(500 * EXAM_MAX_ATTEMPTS);

    expect(((await result) as { error: ExamRequestError }).error)
      .toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT', ambiguous: false });
  });

  it('maps a transport failure to a NETWORK_ERROR that is ambiguous only for writes', async () => {
    const write = build(scripted(networkFailure));
    await expect(write.client.events([{ type: 'focus_lost' }])).rejects.toMatchObject({
      status: 0, code: 'NETWORK_ERROR', ambiguous: true,
    });

    const read = build(scripted(networkFailure, networkFailure, networkFailure));
    await expect(read.client.review()).rejects.toMatchObject({
      status: 0, code: 'NETWORK_ERROR', ambiguous: false,
    });
  });
});

describe('Retry-After parsing', () => {
  const now = Date.parse(SERVER_DATE);

  it.each([
    ['7', 7_000],
    [' 120 ', 120_000],
    ['0', 0],
    ['-5', 0],
    ['Thu, 03 Sep 2026 05:01:00 GMT', 60_000],
    ['Thu, 03 Sep 2026 04:00:00 GMT', 0],
  ])('reads %j as %d ms', (value, expected) => {
    expect(parseRetryAfterMs(value, now)).toBe(expected);
  });

  it.each([null, '', '   ', 'soon', '1.5', '12abc', 'Thursday', '0x10'])('ignores %j', (value) => {
    expect(parseRetryAfterMs(value, now)).toBeUndefined();
  });

  it('clamps absurd values to a day', () => {
    expect(parseRetryAfterMs('999999999999', now)).toBe(24 * 60 * 60 * 1_000);
  });

  it('reads an HTTP-date against the server clock, not the local clock', async () => {
    const fetcher = scripted(failure(429, 'RATE_LIMITED', { 'retry-after': 'Thu, 03 Sep 2026 05:00:45 GMT' }));
    const client = createHttpExamClient({
      courseId: 'ai-foundations',
      itemId: 'exam-m1',
      attemptId: ATTEMPT,
      fetcher: fetcher as unknown as typeof fetch,
      sleep: async () => undefined,
      // A local clock far ahead of the server must not shorten the wait.
      now: () => new Date('2026-09-03T09:00:00.000Z'),
    });

    await expect(client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 45_000 });
  });

  it('puts retryAfterMs on non-JSON upstream failures too', async () => {
    const response = new Response('slow down', { status: 503, headers: { 'content-type': 'text/plain', 'retry-after': '90' } });
    const { client } = build(scripted(response));

    await expect(client.events([{ type: 'focus_lost' }])).rejects.toMatchObject({ status: 503, retryAfterMs: 90_000 });
  });
});

describe('bounded retry with jitter', () => {
  it('retries a transient save failure with jittered exponential waits and then succeeds', async () => {
    const fetcher = scripted(failure(503, 'UNAVAILABLE'), networkFailure, ok([answerRow]));
    const { client, sleep } = build(fetcher, { random: () => 0.5 });

    const saved = await client.save({ 'concepts/q1': 'a' });

    expect(saved).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    // Full jitter: random() * min(8000, 500 * 2^(try - 1)) = 250 then 500.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500]);
  });

  it('never makes more than three attempts and surfaces the last failure', async () => {
    const fetcher = scripted(failure(503, 'A'), failure(503, 'B'), failure(503, 'C'), failure(503, 'D'));
    const { client, sleep } = build(fetcher);

    await expect(client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({ status: 503, code: 'C' });

    expect(fetcher).toHaveBeenCalledTimes(EXAM_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(EXAM_MAX_ATTEMPTS - 1);
  });

  it.each([
    ['no jitter', 0, [0, 0]],
    ['maximum jitter', 0.999999, [499, 999]],
  ])('keeps each wait inside its backoff window (%s)', async (_name, random, expected) => {
    const fetcher = scripted(failure(503), failure(503), failure(503));
    const { client, sleep } = build(fetcher, { random: () => random });

    await expect(client.session()).rejects.toMatchObject({ status: 503 });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(expected);
  });

  it.each([408, 429, 502, 503, 504])('retries a read that fails with %d', async (status) => {
    const fetcher = scripted(failure(status), ok(sessionBody(ATTEMPT)));
    const { client } = build(fetcher);

    await expect(client.session()).resolves.toMatchObject({ attemptsUsed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 409, 422, 500])('does not retry a %d', async (status) => {
    const reads = scripted(failure(status, 'BUSINESS'));
    await expect(build(reads).client.session()).rejects.toMatchObject({ status, code: 'BUSINESS' });
    expect(reads).toHaveBeenCalledOnce();

    const writes = scripted(failure(status, 'BUSINESS'));
    await expect(build(writes).client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({ status, code: 'BUSINESS' });
    expect(writes).toHaveBeenCalledOnce();
  });

  it('retries start (the server returns the active attempt) and review', async () => {
    const started = scripted(failure(503), ok({
      attemptId: ATTEMPT, attemptNo: 1, status: 'in_progress', late: false,
      startedAt: '2026-09-03T05:00:00.000Z', deadlineAt: null, sectionDeadlines: {}, answers: {}, learner: { sections: [] },
    }));
    await expect(build(started).client.start()).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(started).toHaveBeenCalledTimes(2);

    const reviewed = scripted(failure(504), ok({ attemptId: ATTEMPT, status: 'graded' }));
    await expect(build(reviewed).client.review()).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(reviewed).toHaveBeenCalledTimes(2);
  });

  it('never retries integrity events automatically', async () => {
    const rejected = scripted(failure(503));
    await expect(build(rejected).client.events([{ type: 'focus_lost' }])).rejects.toMatchObject({ status: 503 });
    expect(rejected).toHaveBeenCalledOnce();

    const dropped = scripted(networkFailure);
    await expect(build(dropped).client.events([{ type: 'focus_lost' }])).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(dropped).toHaveBeenCalledOnce();
  });

  it.each([502, 504])('treats a %d on a write as ambiguous but not on a read', async (status) => {
    const write = scripted(html(status), html(status), html(status));
    await expect(build(write).client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({ status, ambiguous: true });
    expect(write).toHaveBeenCalledTimes(EXAM_MAX_ATTEMPTS);

    const read = scripted(html(status), html(status), html(status));
    await expect(build(read).client.session()).rejects.toMatchObject({ status, ambiguous: false });
  });

  it('does not flag definite rejections (429, 503, 400) as ambiguous writes', async () => {
    for (const status of [400, 429, 503]) {
      const { client } = build(scripted(failure(status, 'X', { 'retry-after': '3600' }), failure(status), failure(status)));
      await expect(client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({ status, ambiguous: false });
    }
  });

  it('honors a short Retry-After instead of the shorter jittered wait', async () => {
    const fetcher = scripted(failure(429, 'RATE_LIMITED', { 'retry-after': '7' }), ok(sessionBody(ATTEMPT)));
    const { client, sleep } = build(fetcher, { random: () => 0 });

    await client.session();

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7_000]);
  });

  it('surfaces a long Retry-After immediately without sleeping', async () => {
    expect(EXAM_MAX_INLINE_RETRY_WAIT_MS).toBe(10_000);
    const fetcher = scripted(failure(429, 'RATE_LIMITED', { 'retry-after': '60' }), ok([answerRow]));
    const { client, sleep } = build(fetcher);

    await expect(client.save({ 'concepts/q1': 'a' })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterMs: 60_000,
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('sends every attempt with same-origin credentials and an abort signal', async () => {
    const fetcher = scripted(failure(503), ok(sessionBody(ATTEMPT)));
    const { client } = build(fetcher);

    await client.session();

    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe('same-origin');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('ambiguous submit reconciliation', () => {
  it('posts once and returns a definitive answer without reconciling', async () => {
    const fetcher = scripted(ok(submitResult));
    const { client } = build(fetcher);

    await expect(client.submit()).resolves.toMatchObject({ status: 'graded' });
    expect(calls(fetcher)).toEqual([SUBMIT]);
  });

  it('bypasses cached session state when reconciling an ambiguous submission', async () => {
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'graded')), ok(submitResult));

    await build(fetcher).client.submit();

    expect(fetcher.mock.calls[1][1]?.cache).toBe('no-store');
  });

  it('honors Retry-After before repeating an ambiguous submission', async () => {
    vi.useFakeTimers();
    const fetcher = scripted(failure(504, 'GATEWAY_TIMEOUT', { 'retry-after': '7' }), ok(sessionBody(ATTEMPT, 'graded')), ok(submitResult));
    const { client, sleep } = build(fetcher);

    await expect(client.submit()).resolves.toEqual(submitResult);

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7_000]);
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
  });

  it('retains a long Retry-After across submission retries without keeping the request open', async () => {
    vi.useFakeTimers();
    const fetcher = scripted(
      failure(504, 'GATEWAY_TIMEOUT', { 'retry-after': '60' }),
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(submitResult),
    );
    const { client, sleep } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', retryAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(client.submit()).rejects.toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', retryAfterMs: 30_000 });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SESSION]);
    expect(sleep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(client.submit()).resolves.toEqual(submitResult);
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SESSION, SESSION, SUBMIT]);
  });

  it.each([
    ['DEADLINE_PASSED', 409],
    ['ATTEMPT_NOT_ACTIVE', 409],
    ['RATE_LIMITED', 429],
  ])('passes a definite %s (%d) straight through with no reconciliation', async (code, status) => {
    const fetcher = scripted(failure(status, code));
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code, status });
    expect(calls(fetcher)).toEqual([SUBMIT]);
  });

  it.each([
    ['network failure', () => networkFailure()],
    ['500 after a possible commit', () => failure(500, 'INTERNAL')],
    ['502', () => failure(502)],
    ['504', () => failure(504)],
  ])('after a %s, reads the session and then repeats the submit exactly once', async (_name, firstStep) => {
    const fetcher = scripted(firstStep, ok(sessionBody(ATTEMPT, 'graded')), ok(submitResult));
    const { client } = build(fetcher);

    await expect(client.submit()).resolves.toEqual(submitResult);

    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
  });

  it.each([
    ['HTML success', () => html(200)],
    ['truncated JSON', () => new Response('{"data":', { headers: { 'content-type': 'application/json' } })],
    ['missing envelope', () => new Response('{}', { headers: { 'content-type': 'application/json' } })],
    ['null result', () => ok(null)],
    ['wrong attempt', () => ok({ ...submitResult, attemptId: 'another-attempt' })],
    ['uncommitted state', () => ok({ ...submitResult, status: 'in_progress' })],
  ])('reconciles a %s before treating the submission as acknowledged', async (_name, firstStep) => {
    const fetcher = scripted(firstStep, ok(sessionBody(ATTEMPT, 'graded')), ok(submitResult));
    const { client } = build(fetcher);

    await expect(client.submit()).resolves.toEqual(submitResult);

    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
  });

  it('after a timeout, reconciles to a graded attempt and returns the idempotent server result', async () => {
    vi.useFakeTimers();
    const fetcher = scripted(
      () => new Promise<Response>(() => {}),
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(submitResult),
    );
    const { client } = build(fetcher, { timeoutMs: 30_000 });

    const result = settled(client.submit());
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await result).toEqual({ value: submitResult });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
  });

  it('treats pending_manual like graded: the repeated submit returns the same result', async () => {
    const pending = { ...submitResult, status: 'pending_manual', passed: null };
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'pending_manual')), ok(pending));
    const { client } = build(fetcher);

    await expect(client.submit()).resolves.toEqual(pending);
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
  });

  it('retries the submit once, after a backoff, when the attempt is still in progress', async () => {
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'in_progress')), ok(submitResult));
    const { client, sleep } = build(fetcher, { random: () => 0.5 });

    await expect(client.submit()).resolves.toEqual(submitResult);

    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250]);
  });

  it('does not retry a second time when the in-progress retry is also unanswered, and reconciles next time', async () => {
    const fetcher = scripted(
      networkFailure,
      ok(sessionBody(ATTEMPT, 'in_progress')),
      networkFailure,
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(submitResult),
    );
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'NETWORK_ERROR', ambiguous: true });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT]);

    await expect(client.submit()).resolves.toEqual(submitResult);
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT, SESSION, SUBMIT]);
  });

  it('clears the reconcile requirement once a definitive answer arrives', async () => {
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'in_progress')), failure(409, 'ATTEMPT_NOT_ACTIVE'), ok(submitResult));
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'ATTEMPT_NOT_ACTIVE', ambiguous: false });
    await expect(client.submit()).resolves.toEqual(submitResult);

    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT, SUBMIT]);
  });

  it('maps an expired attempt to DEADLINE_PASSED so the player takes its terminal path', async () => {
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'expired')));
    const { client } = build(fetcher);

    const error = await client.submit().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExamRequestError);
    expect(error).toMatchObject({ code: 'DEADLINE_PASSED', status: 409, ambiguous: false });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION]);
  });

  it('maps any other non-active status to ATTEMPT_NOT_ACTIVE without posting again', async () => {
    const fetcher = scripted(networkFailure, ok(sessionBody(ATTEMPT, 'submitted')));
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'ATTEMPT_NOT_ACTIVE' });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION]);
  });

  it('reports SUBMIT_OUTCOME_UNKNOWN when reconciliation fails and reconciles before any new submit', async () => {
    const fetcher = scripted(
      networkFailure,
      networkFailure, networkFailure, networkFailure,
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(submitResult),
    );
    const { client } = build(fetcher);

    const error = await client.submit().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExamRequestError);
    expect(error).toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', ambiguous: true });
    // The unanswered submit plus the exhausted session reads; no duplicate submit.
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SESSION, SESSION]);

    await expect(client.submit()).resolves.toEqual(submitResult);
    expect(calls(fetcher).slice(4)).toEqual([SESSION, SUBMIT]);
  });

  it.each([
    ['another attempt', sessionBody('attempt-other', 'in_progress')],
    ['no attempt', sessionBody(null)],
  ])('refuses to guess when the session shows %s', async (_name, body) => {
    const fetcher = scripted(networkFailure, ok(body), ok(sessionBody(ATTEMPT, 'graded')), ok(submitResult));
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', ambiguous: true });
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION]);

    await expect(client.submit()).resolves.toEqual(submitResult);
    expect(calls(fetcher).slice(2)).toEqual([SESSION, SUBMIT]);
  });

  it('keeps the bound attempt while reconciling, so later actions still target the original attempt', async () => {
    const fetcher = scripted(
      networkFailure,
      ok(sessionBody('attempt-other', 'in_progress')),
      ok({ attemptId: ATTEMPT, status: 'graded' }),
    );
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN' });
    await client.review();

    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, `GET attempts/${ATTEMPT}/review`]);
  });

  it('a public session() call still rebinds, and an unresolved submit does not follow it to a new attempt', async () => {
    const fetcher = scripted(
      networkFailure,
      networkFailure, networkFailure, networkFailure,
      ok(sessionBody('attempt-2', 'in_progress')),
      ok({ ...submitResult, attemptId: 'attempt-2' }),
    );
    const { client } = build(fetcher);

    await expect(client.submit()).rejects.toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN' });
    await client.session();
    await expect(client.submit()).resolves.toMatchObject({ attemptId: 'attempt-2' });

    expect(calls(fetcher).slice(-2)).toEqual([SESSION, 'POST attempts/attempt-2/submit']);
  });

  it('never reports a submit success the server did not return', async () => {
    const fetcher = scripted(
      networkFailure,
      ok(sessionBody(ATTEMPT, 'graded')),
      networkFailure,
      ok(sessionBody(ATTEMPT, 'graded')),
      ok(submitResult),
    );
    const { client } = build(fetcher);

    const outcome = await settled(client.submit());

    // Observing a graded attempt is not a success: the repeated POST itself went unanswered.
    expect(outcome).not.toHaveProperty('value');
    expect(outcome).toMatchObject({ error: { code: 'NETWORK_ERROR', ambiguous: true } });
    await expect(client.submit()).resolves.toEqual(submitResult);
    expect(calls(fetcher)).toEqual([SUBMIT, SESSION, SUBMIT, SESSION, SUBMIT]);
  });
});
