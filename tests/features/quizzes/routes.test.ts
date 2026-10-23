import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const service = {
    check: vi.fn(),
    submit: vi.fn(),
  };
  return {
    requireApiUser: vi.fn(),
    supabaseService: vi.fn(() => ({ from: vi.fn() })),
    createQuizService: vi.fn((_dependencies: unknown) => service),
    recompute: vi.fn(),
    service,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/quizzes/service', () => ({ createQuizService: mocks.createQuizService }));
vi.mock('@/features/progress/service', () => ({ recompute: mocks.recompute }));

import { POST as checkQuiz } from '@/app/api/v1/quizzes/check/route';
import { POST as submitQuiz } from '@/app/api/v1/quizzes/submit/route';

function rateLimitDatabase(profileLocale: 'en' | 'vi' = 'en') {
  const counts = new Map<string, number>();
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(async () => ({ data: { locale: profileLocale }, error: null })),
  };
  return {
    from: vi.fn(() => profileQuery),
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const key = String(args.key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { data: count <= Number(args.limit), error: null };
    }),
  };
}

describe('quiz routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'learner-1', user_metadata: { locale: 'en' } });
    mocks.recompute.mockResolvedValue(undefined);
    mocks.supabaseService.mockReturnValue(rateLimitDatabase());
  });

  it('wires quiz submission to the real progress recompute hook', async () => {
    mocks.service.submit.mockResolvedValueOnce({ attemptId: 'attempt-wired' });

    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers: { 'check-1/q1': 'a' },
      }),
    }));

    expect(response.status).toBe(200);
    const dependencies = mocks.createQuizService.mock.calls.at(-1)?.[0] as {
      hooks?: { recompute(actor: { id: string; locale: 'en' | 'vi' }, courseId: string): Promise<void> };
    };
    expect(dependencies.hooks).toBeDefined();
    await dependencies.hooks!.recompute({ id: 'learner-1', locale: 'en' }, 'ai-foundations');
    expect(mocks.recompute).toHaveBeenCalledWith(
      { userId: 'learner-1', roles: [] },
      'ai-foundations',
    );
  });

  it('authenticates and delegates a practice check with the validated body', async () => {
    const result = {
      questionId: 'check-1/q1',
      status: 'correct',
      points: 1,
      maxPoints: 1,
      revealed: { correctAnswers: { 'check-1/q1': 'a' } },
    };
    mocks.service.check.mockResolvedValueOnce(result);
    const body = {
      courseId: 'ai-foundations',
      itemId: 'what-is-ai',
      quizId: 'check-1',
      questionId: 'check-1/q1',
      answer: 'a',
    };

    const response = await checkQuiz(new Request('http://localhost/api/v1/quizzes/check', {
      method: 'POST',
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: result });
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.service.check).toHaveBeenCalledWith(
      { id: 'learner-1', locale: 'en' },
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q1',
      'a',
    );
  });

  it('uses the persisted profile locale when auth metadata has no locale', async () => {
    mocks.requireApiUser.mockResolvedValueOnce({ id: 'learner-1', user_metadata: {} });
    mocks.supabaseService.mockReturnValueOnce(rateLimitDatabase('en'));
    mocks.service.check.mockResolvedValueOnce({ questionId: 'check-1/q1' });

    const response = await checkQuiz(new Request('http://localhost/api/v1/quizzes/check', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations', itemId: 'what-is-ai', quizId: 'check-1', questionId: 'check-1/q1', answer: 'a',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.service.check).toHaveBeenCalledWith(
      { id: 'learner-1', locale: 'en' },
      'ai-foundations', 'what-is-ai', 'check-1', 'check-1/q1', 'a',
    );
  });

  it('uses the persisted profile locale for quiz submission', async () => {
    mocks.requireApiUser.mockResolvedValueOnce({ id: 'learner-1', user_metadata: { locale: 'vi' } });
    mocks.supabaseService.mockReturnValueOnce(rateLimitDatabase('en'));
    mocks.service.submit.mockResolvedValueOnce({ attemptId: 'attempt-1' });

    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations', itemId: 'what-is-ai', quizId: 'check-1', answers: { 'check-1/q1': 'a' },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.service.submit).toHaveBeenCalledWith(
      { id: 'learner-1', locale: 'en' },
      'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a' },
    );
  });

  it('rejects an invalid submit body before constructing the service', async () => {
    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers: {},
        unexpected: true,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('rejects a check answer string longer than 4000 characters', async () => {
    const response = await checkQuiz(new Request('http://localhost/api/v1/quizzes/check', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        questionId: 'check-1/q1',
        answer: 'a'.repeat(4001),
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('rejects an answer array with more than 200 items', async () => {
    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers: { 'check-1/q2': Array.from({ length: 201 }, () => 'a') },
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('rejects an answer record with more than 200 keys', async () => {
    const answer = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`blank-${index}`, 'a']),
    );
    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers: { 'check-1/q4': answer },
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('accepts exactly 200 top-level quiz answers', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`q-${index}`, 'a']),
    );
    mocks.service.submit.mockResolvedValueOnce({ attemptId: 'attempt-200' });

    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'answer-count-limit',
        answers,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.service.submit).toHaveBeenCalledWith(
      { id: 'learner-1', locale: 'en' },
      'ai-foundations',
      'what-is-ai',
      'answer-count-limit',
      answers,
    );
  });

  it('rejects more than 200 top-level quiz answers', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`q-${index}`, 'a']),
    );

    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'answer-count-limit',
        answers,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('rejects an answers object larger than 64 KiB when serialized', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`check-1/q${index}`, 'a'.repeat(4000)]),
    );
    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers,
      }),
    }));

    expect([400, 413]).toContain(response.status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: expect.stringMatching(/^(VALIDATION_ERROR|PAYLOAD_TOO_LARGE)$/) },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });

  it('delegates a graded submission and returns the standard success envelope', async () => {
    const result = {
      attemptId: 'attempt-1',
      results: [],
      points: 0,
      maxPoints: 0,
      percent: 0,
      attemptsRemaining: null,
      revealed: {},
    };
    mocks.service.submit.mockResolvedValueOnce(result);
    const answers = { 'check-1/q1': 'a' };

    const response = await submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'check-1',
        answers,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: result });
    expect(mocks.service.submit).toHaveBeenCalledWith(
      { id: 'learner-1', locale: 'en' },
      'ai-foundations',
      'what-is-ai',
      'check-1',
      answers,
    );
  });

  it('rate-limits practice checks per user and quiz after 60 requests in a minute', async () => {
    mocks.service.check.mockResolvedValue({ questionId: 'rate-check/q1' });
    const request = () => checkQuiz(new Request('http://localhost/api/v1/quizzes/check', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'rate-check',
        questionId: 'rate-check/q1',
        answer: 'a',
      }),
    }));

    const responses = [];
    for (let index = 0; index < 61; index += 1) responses.push(await request());

    expect(responses.slice(0, 60).every(({ status }) => status === 200)).toBe(true);
    expect(responses[60].status).toBe(429);
    await expect(responses[60].json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
    expect(mocks.service.check).toHaveBeenCalledTimes(60);
  });

  it('rate-limits submissions per user and quiz after 20 requests in a minute', async () => {
    mocks.service.submit.mockResolvedValue({ attemptId: 'attempt-rate' });
    const request = () => submitQuiz(new Request('http://localhost/api/v1/quizzes/submit', {
      method: 'POST',
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'what-is-ai',
        quizId: 'rate-submit',
        answers: {},
      }),
    }));

    const responses = [];
    for (let index = 0; index < 21; index += 1) responses.push(await request());

    expect(responses.slice(0, 20).every(({ status }) => status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    await expect(responses[20].json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
    expect(mocks.service.submit).toHaveBeenCalledTimes(20);
  });

  it('returns the API authentication error without touching the quiz service', async () => {
    mocks.requireApiUser.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'),
    );

    const response = await checkQuiz(new Request('http://localhost/api/v1/quizzes/check', {
      method: 'POST',
      body: '{}',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    expect(mocks.createQuizService).not.toHaveBeenCalled();
  });
});
