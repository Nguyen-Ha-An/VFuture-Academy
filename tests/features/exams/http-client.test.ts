import { describe, expect, it, vi } from 'vitest';

import { createHttpExamClient } from '@/features/exams/ui/client';

const jsonResponse = (data: unknown, date = 'Thu, 03 Sep 2026 05:00:00 GMT') => new Response(
  JSON.stringify({ data }),
  {
    status: 200,
    headers: { 'content-type': 'application/json', date },
  },
);

describe('HTTP exam client', () => {
  it('restores and binds an existing session without creating an attempt', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        attemptsUsed: 2,
        attempt: {
          attemptId: 'attempt-final',
          attemptNo: 2,
          status: 'in_progress',
          late: false,
          startedAt: '2026-09-03T05:00:00.000Z',
          deadlineAt: '2026-09-03T05:30:00.000Z',
          sectionDeadlines: { concepts: '2026-09-03T05:10:00.000Z' },
          answers: { 'concepts/q1': 'a' },
          learner: { sections: [] },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        attemptId: 'attempt-final', status: 'graded', late: false, released: false, answers: {}, revealed: {},
      }));
    const client = createHttpExamClient({ courseId: 'ai-foundations', itemId: 'exam-m1', fetcher });

    const session = await client.session();
    expect(session.attemptsUsed).toBe(2);
    expect(session.attempt?.startedAt).toEqual(new Date('2026-09-03T05:00:00.000Z'));
    expect(session.attempt?.deadlineAt).toEqual(new Date('2026-09-03T05:30:00.000Z'));
    expect(session.attempt?.sectionDeadlines.concepts).toEqual(new Date('2026-09-03T05:10:00.000Z'));
    expect(session.attempt?.answers).toEqual({ 'concepts/q1': 'a' });

    await client.review();
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/v1/exams/exam-m1/attempts?courseId=ai-foundations', 'GET'],
      ['/api/v1/exams/attempts/attempt-final/review', 'GET'],
    ]);
  });

  it('binds attempt actions to the real learner routes and hydrates server dates', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        attemptId: 'attempt-1',
        attemptNo: 1,
        status: 'in_progress',
        late: false,
        startedAt: '2026-09-03T05:00:00.000Z',
        deadlineAt: '2026-09-03T05:30:00.000Z',
        sectionDeadlines: { concepts: '2026-09-03T05:10:00.000Z', essay: null },
        answers: {},
        learner: { sections: [] },
      }))
      .mockResolvedValueOnce(jsonResponse([{
        attemptId: 'attempt-1',
        questionId: 'concepts/q1',
        answer: 'a',
        result: null,
        manualPoints: null,
        manualFeedback: null,
        gradedBy: null,
        updatedAt: '2026-09-03T05:01:00.000Z',
      }]))
      .mockResolvedValueOnce(jsonResponse({ attemptId: 'attempt-1', status: 'graded' }))
      .mockResolvedValueOnce(jsonResponse({
        attemptId: 'attempt-1', status: 'graded', late: false, released: true, answers: {}, revealed: {},
      }))
      .mockResolvedValueOnce(jsonResponse({ accepted: 1, dropped: 0 }));
    const client = createHttpExamClient({
      courseId: 'ai-foundations',
      itemId: 'exam-m1',
      fetcher,
      now: () => new Date('2026-09-03T05:00:30.000Z'),
    });

    const started = await client.start();
    expect(started.startedAt).toEqual(new Date('2026-09-03T05:00:00.000Z'));
    expect(started.deadlineAt).toEqual(new Date('2026-09-03T05:30:00.000Z'));
    expect(started.sectionDeadlines).toEqual({
      concepts: new Date('2026-09-03T05:10:00.000Z'),
      essay: null,
    });

    const answers = await client.save({ 'concepts/q1': 'a' });
    expect(answers[0]?.updatedAt).toEqual(new Date('2026-09-03T05:01:00.000Z'));
    await client.submit();
    await client.review();
    await client.events([{ type: 'focus_lost', at: new Date('2026-09-03T05:02:00.000Z') }]);

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/v1/exams/exam-m1/attempts', 'POST', JSON.stringify({ courseId: 'ai-foundations' })],
      ['/api/v1/exams/attempts/attempt-1/answers', 'PUT', JSON.stringify({ answers: { 'concepts/q1': 'a' } })],
      ['/api/v1/exams/attempts/attempt-1/submit', 'POST', undefined],
      ['/api/v1/exams/attempts/attempt-1/review', 'GET', undefined],
      ['/api/v1/exams/attempts/attempt-1/events', 'POST', JSON.stringify({
        events: [{ type: 'focus_lost', at: '2026-09-03T05:02:00.000Z' }],
      })],
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'same-origin')).toBe(true);
    expect(await client.serverNow()).toEqual(new Date('2026-09-03T05:00:00.000Z'));
  });

  it('preserves a JSON error envelope in a typed request error', async () => {
    const client = createHttpExamClient({
      courseId: 'ai-foundations',
      itemId: 'exam-m1',
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Too many exam requests' },
      }), {
        status: 429,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })),
    });

    await expect(client.start()).rejects.toMatchObject({
      name: 'ExamRequestError',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many exam requests',
    });
  });

  it('turns a non-JSON upstream failure into a typed request error', async () => {
    const client = createHttpExamClient({
      courseId: 'ai-foundations',
      itemId: 'exam-m1',
      fetcher: vi.fn(async () => new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })),
    });

    await expect(client.start()).rejects.toMatchObject({
      name: 'ExamRequestError',
      status: 502,
      code: 'EXAM_REQUEST_FAILED',
      message: 'Exam request failed',
    });
  });

  it('does not issue attempt actions before start binds an attempt', async () => {
    const client = createHttpExamClient({
      courseId: 'ai-foundations',
      itemId: 'exam-m1',
      fetcher: vi.fn(),
    });

    await expect(client.submit()).rejects.toThrow('must complete before attempt actions');
  });
});
