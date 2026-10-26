import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService, type ExamService } from '@/features/exams/service';
import { ExamError } from '@/features/exams/types';
import { ApiError } from '@/lib/api';
import {
  bankSource,
  compileExamFixtures,
  instructor,
  itemContext,
  learner,
  MutableClock,
  withExamSettings,
} from './test-kit';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requirePermission: vi.fn(),
  learnerExamActor: vi.fn(),
  studioExamActor: vi.fn(),
  createServerExamService: vi.fn(),
  listStudioExamAttempts: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/features/exams/server', () => ({
  learnerExamActor: mocks.learnerExamActor,
  studioExamActor: mocks.studioExamActor,
  createServerExamService: mocks.createServerExamService,
  listStudioExamAttempts: mocks.listStudioExamAttempts,
}));

import { GET as sessionAttempt, POST as startAttempt } from '@/app/api/v1/exams/[itemId]/attempts/route';
import { PUT as saveAnswers } from '@/app/api/v1/exams/attempts/[attemptId]/answers/route';
import { POST as saveEvents } from '@/app/api/v1/exams/attempts/[attemptId]/events/route';
import { POST as submitAttempt } from '@/app/api/v1/exams/attempts/[attemptId]/submit/route';
import { GET as reviewAttempt } from '@/app/api/v1/exams/attempts/[attemptId]/review/route';
import { GET as scheduledSweep, POST as sweepAttempts } from '@/app/api/v1/internal/exams/sweep/route';
import { GET as listAttempts } from '@/app/api/v1/studio/exams/[itemId]/attempts/route';
import { POST as releaseAttempts } from '@/app/api/v1/studio/exams/[itemId]/release/route';
import { POST as manualGrade } from '@/app/api/v1/studio/exams/attempts/[id]/manual-grade/route';

const uuid = {
  branch: 'vinsmc',
  version: '00000000-0000-4000-8000-000000000002',
  attempt: '00000000-0000-4000-8000-000000000003',
  missingAttempt: '00000000-0000-4000-8000-000000000004',
};

let allTypesExam: CompiledItem;

function rateLimitDatabase() {
  const counts = new Map<string, number>();
  return {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const key = String(args.key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { data: count <= Number(args.limit), error: null };
    }),
  };
}

beforeAll(async () => {
  ({ all: allTypesExam } = await compileExamFixtures());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ id: learner.id });
  mocks.learnerExamActor.mockResolvedValue(learner);
  mocks.studioExamActor.mockReturnValue(instructor);
  mocks.requirePermission.mockResolvedValue({ userId: instructor.id, roles: [{ role: 'admin', branchId: null }] });
  mocks.supabaseService.mockReturnValue(rateLimitDatabase());
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function harness(item: CompiledItem) {
  const repo = new InMemoryExamRepo();
  const service = createExamService({
    repo,
    clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
    bank: bankSource,
    loadItem: async () => itemContext(item),
    isEnrolled: async () => true,
  });
  mocks.createServerExamService.mockReturnValue(service);
  return { repo, service };
}

function assertNoAnswerKeys(value: unknown): void {
  const forbidden = new Set(['correctAnswer', 'explanation', 'optionFeedback', 'rubric', 'sampleSolution', 'gradingSnapshot', 'questionSet']);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((entry, index) => walk(entry, `${path}/${index}`));
    if (typeof node !== 'object' || node === null) return;
    for (const [key, entry] of Object.entries(node)) {
      expect(forbidden.has(key), `answer key ${key} leaked at ${path}/${key}`).toBe(false);
      walk(entry, `${path}/${key}`);
    }
  };
  walk(JSON.parse(JSON.stringify(value)), '');
}

describe('learner exam routes', () => {
  it('returns the existing learner attempt session without creating another attempt', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-one', allTypesExam.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, { [attempt.questionSet.sections[0].questionIds[0]]: 'a' });

    const response = await sessionAttempt(new Request(
      'http://localhost/api/v1/exams/exam-all/attempts?courseId=course-one',
    ), { params: Promise.resolve({ itemId: 'exam-all' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: {
      attemptsUsed: 1,
      attempt: { attemptId: started.attemptId, status: 'in_progress', answers: expect.any(Object) },
    } });
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
    assertNoAnswerKeys(payload);
  });

  it('returns 401 for an anonymous attempt start before creating the service', async () => {
    mocks.requireApiUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));

    const response = await startAttempt(new Request('http://localhost/api/v1/exams/exam-all/attempts', {
      method: 'POST', body: JSON.stringify({ courseId: 'course-one' }),
    }), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(mocks.createServerExamService).not.toHaveBeenCalled();
  });

  it('maps a closed exam start to EXAM_CLOSED 409', async () => {
    harness(withExamSettings(allTypesExam, { openAt: '2026-09-03T00:00:00.000Z' }));

    const response = await startAttempt(new Request('http://localhost/api/v1/exams/exam-all/attempts', {
      method: 'POST', body: JSON.stringify({ courseId: 'course-one' }),
    }), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'EXAM_CLOSED' } });
  });

  it('returns a learner submission DTO with no answer keys anywhere in its JSON tree', async () => {
    const { repo, service } = harness(withExamSettings(allTypesExam, {
      review: {
        showScore: 'immediately', showCorrectAnswers: 'immediately', showExplanations: 'immediately', releaseAt: null,
      },
    }));
    const started = await service.start(learner, 'course-one', allTypesExam.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, Object.fromEntries(
      attempt.questionSet.sections.flatMap((section) => section.questionIds.map((id) => [id, 'a'])),
    ));

    const response = await submitAttempt(new Request(`http://localhost/api/v1/exams/attempts/${attempt.id}/submit`, {
      method: 'POST',
    }), { params: Promise.resolve({ attemptId: attempt.id }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ data: { attemptId: attempt.id, status: 'graded' } });
    assertNoAnswerKeys(json);
  });

  it('keeps on-release review data hidden until the attempt is released', async () => {
    const item = withExamSettings(allTypesExam, {
      review: {
        showScore: 'on_release', showCorrectAnswers: 'on_release', showExplanations: 'on_release', releaseAt: null,
      },
    });
    const { service } = harness(item);
    const started = await service.start(learner, 'course-one', item.id);
    await service.submit(learner, started.attemptId);

    const beforeResponse = await reviewAttempt(new Request(`http://localhost/api/v1/exams/attempts/${started.attemptId}/review`), {
      params: Promise.resolve({ attemptId: started.attemptId }),
    });
    const before = await beforeResponse.json();
    await service.release(instructor, { attemptId: started.attemptId });
    const afterResponse = await reviewAttempt(new Request(`http://localhost/api/v1/exams/attempts/${started.attemptId}/review`), {
      params: Promise.resolve({ attemptId: started.attemptId }),
    });
    const after = await afterResponse.json();

    // Automatic grading completed on submit, so the score is already the learner's;
    // `on_release` still governs the answer key, which stays sealed until release.
    expect(before.data).toHaveProperty('score');
    expect(before.data.released).toBe(false);
    expect(before.data.revealed).toEqual({});
    expect(after.data).toHaveProperty('score');
    expect(after.data.revealed).toHaveProperty('correctAnswers');
  });

  it.each([
    ['save', (attemptId: string) => saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/answers`, {
      method: 'PUT', body: JSON.stringify({ answers: {} }),
    }), { params: Promise.resolve({ attemptId }) })],
    ['submit', (attemptId: string) => submitAttempt(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/submit`, {
      method: 'POST',
    }), { params: Promise.resolve({ attemptId }) })],
    ['review', (attemptId: string) => reviewAttempt(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/review`), {
      params: Promise.resolve({ attemptId }),
    })],
    ['events', (attemptId: string) => saveEvents(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/events`, {
      method: 'POST', body: JSON.stringify({ events: [{ type: 'focus_lost' }] }),
    }), { params: Promise.resolve({ attemptId }) })],
  ] as const)('does not disclose whether another learner\'s attempt exists on %s', async (_name, invoke) => {
    const { service } = harness(allTypesExam);
    const otherAttempt = await service.start({ ...learner, id: 'other-learner' }, 'course-one', allTypesExam.id);

    const existing = await invoke(otherAttempt.attemptId);
    const missing = await invoke(uuid.missingAttempt);

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await existing.json()).toEqual(await missing.json());
  });

  it('rejects event batches larger than 50 at the route boundary', async () => {
    mocks.createServerExamService.mockReturnValue({ events: vi.fn() } as unknown as ExamService);

    const response = await saveEvents(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/events`, {
      method: 'POST',
      body: JSON.stringify({ events: Array.from({ length: 51 }, () => ({ type: 'focus_lost' })) }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('validates answer payloads before invoking the service', async () => {
    mocks.createServerExamService.mockReturnValue({ save: vi.fn() } as unknown as ExamService);

    const response = await saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/answers`, {
      method: 'PUT', body: JSON.stringify({ answers: {}, extra: true }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) });

    expect(response.status).toBe(400);
  });

  it.each([
    ['a string longer than 4000 characters', { 'section/question': 'a'.repeat(4001) }],
    ['an array longer than 200 entries', { 'section/question': Array.from({ length: 201 }, () => 'a') }],
    ['a record with more than 200 fields', {
      'section/question': Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`field-${index}`, 'a'])),
    }],
  ] as const)('rejects %s in an exam answer', async (_name, answers) => {
    const save = vi.fn();
    mocks.createServerExamService.mockReturnValue({ save } as unknown as ExamService);

    const response = await saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/answers`, {
      method: 'PUT', body: JSON.stringify({ answers }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) });

    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an answers object larger than 64 KiB when serialized', async () => {
    const save = vi.fn();
    mocks.createServerExamService.mockReturnValue({ save } as unknown as ExamService);
    const answers = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`section/q-${index}`, 'a'.repeat(4000)]),
    );

    const response = await saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/answers`, {
      method: 'PUT', body: JSON.stringify({ answers }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) });

    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects event metadata larger than 2 KiB', async () => {
    const events = vi.fn();
    mocks.createServerExamService.mockReturnValue({ events } as unknown as ExamService);

    const response = await saveEvents(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/events`, {
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'paste', meta: { text: 'a'.repeat(2048) } }] }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) });

    expect(response.status).toBe(400);
    expect(events).not.toHaveBeenCalled();
  });

  it.each([
    ['lifecycle', 10, 'rate-start-user', () => startAttempt(new Request('http://localhost/api/v1/exams/rate-exam/attempts', {
      method: 'POST', body: JSON.stringify({ courseId: 'course-one' }),
    }), { params: Promise.resolve({ itemId: 'rate-exam' }) })],
    ['answers', 120, 'rate-answers-user', () => saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/answers`, {
      method: 'PUT', body: JSON.stringify({ answers: {} }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) })],
    ['events', 30, 'rate-events-user', () => saveEvents(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/events`, {
      method: 'POST', body: JSON.stringify({ events: [{ type: 'focus_lost' }] }),
    }), { params: Promise.resolve({ attemptId: uuid.attempt }) })],
  ] as const)('returns 429 after the per-user %s request budget is exhausted', async (_action, limit, userId, invoke) => {
    mocks.requireApiUser.mockResolvedValue({ id: userId });
    mocks.createServerExamService.mockReturnValue({
      start: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue([]),
      events: vi.fn().mockResolvedValue({ accepted: 1, dropped: 0 }),
    } as unknown as ExamService);

    const responses = [];
    for (let index = 0; index <= limit; index += 1) responses.push(await invoke());

    expect(responses.slice(0, limit).every(({ status }) => status === 200)).toBe(true);
    expect(responses[limit].status).toBe(429);
    await expect(responses[limit].json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});

describe('internal exam sweep route', () => {
  it('returns 401 when CRON_SECRET is unset', async () => {
    mocks.createServerExamService.mockReturnValue({ sweepExpired: vi.fn() } as unknown as ExamService);

    const response = await sweepAttempts(new Request('http://localhost/api/v1/internal/exams/sweep', {
      method: 'POST', headers: { authorization: 'Bearer any-value' },
    }));

    expect(response.status).toBe(401);
    expect(mocks.createServerExamService).not.toHaveBeenCalled();
  });

  it('requires a constant-time CRON_SECRET credential and accepts the matching bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-value';
    const sweepExpired = vi.fn().mockResolvedValue([{ attemptId: uuid.attempt, status: 'graded' }]);
    mocks.createServerExamService.mockReturnValue({ sweepExpired } as unknown as ExamService);

    const denied = await sweepAttempts(new Request('http://localhost/api/v1/internal/exams/sweep', { method: 'POST' }));
    const allowed = await sweepAttempts(new Request('http://localhost/api/v1/internal/exams/sweep', {
      method: 'POST', headers: { authorization: 'Bearer cron-secret-value' },
    }));

    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ data: [{ attemptId: uuid.attempt, status: 'graded' }] });
    expect(sweepExpired).toHaveBeenCalledTimes(1);
  });

  it('supports Vercel cron GET invocations with the same secret boundary', async () => {
    process.env.CRON_SECRET = 'cron-secret-value';
    const sweepExpired = vi.fn().mockResolvedValue([]);
    mocks.createServerExamService.mockReturnValue({ sweepExpired } as unknown as ExamService);

    const response = await scheduledSweep(new Request('http://localhost/api/v1/internal/exams/sweep', {
      headers: { authorization: 'Bearer cron-secret-value' },
    }));

    expect(response.status).toBe(200);
    expect(sweepExpired).toHaveBeenCalledTimes(1);
  });
});

describe('studio exam route permissions', () => {
  beforeEach(() => {
    mocks.requirePermission.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
  });

  it('requires branch-scoped exam.release or submission.grade to list attempts', async () => {
    const response = await listAttempts(new Request(
      `http://localhost/api/v1/studio/exams/exam-all/attempts?branchId=${uuid.branch}&courseVersionId=${uuid.version}`,
    ), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith('exam.release', { branchId: uuid.branch });
    expect(mocks.requirePermission).toHaveBeenCalledWith('submission.grade', { branchId: uuid.branch });
    expect(mocks.listStudioExamAttempts).not.toHaveBeenCalled();
  });

  it('allows a branch-scoped grader to list attempts without release permission', async () => {
    const grader = { userId: instructor.id, roles: [{ role: 'instructor' as const, branchId: uuid.branch }] };
    mocks.requirePermission
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'))
      .mockResolvedValueOnce(grader);
    mocks.listStudioExamAttempts.mockResolvedValueOnce({ attempts: [], skipped: { unassigned: 0 } });

    const response = await listAttempts(new Request(
      `http://localhost/api/v1/studio/exams/exam-all/attempts?branchId=${uuid.branch}&courseVersionId=${uuid.version}`,
    ), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission.mock.calls).toEqual([
      ['exam.release', { branchId: uuid.branch }],
      ['submission.grade', { branchId: uuid.branch }],
    ]);
    expect(mocks.listStudioExamAttempts).toHaveBeenCalledWith(grader, 'exam-all', uuid.branch, uuid.version);
  });

  it('still requires branch-scoped exam.release to release attempts', async () => {
    const response = await releaseAttempts(new Request('http://localhost/api/v1/studio/exams/exam-all/release', {
      method: 'POST', body: JSON.stringify({ branchId: uuid.branch, courseVersionId: uuid.version }),
    }), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith('exam.release', { branchId: uuid.branch });
    expect(mocks.createServerExamService).not.toHaveBeenCalled();
  });

  it('requires branch-scoped submission.grade for manual grading and grants only that permission', async () => {
    const permissionActor = { userId: instructor.id, roles: [{ role: 'instructor' as const, branchId: uuid.branch }] };
    mocks.requirePermission.mockResolvedValueOnce(permissionActor);
    mocks.createServerExamService.mockReturnValue({
      manualGrade: vi.fn().mockResolvedValue({ attemptId: uuid.attempt }),
    } as unknown as ExamService);

    const response = await manualGrade(new Request(`http://localhost/api/v1/studio/exams/attempts/${uuid.attempt}/manual-grade`, {
      method: 'POST',
      body: JSON.stringify({ branchId: uuid.branch, questionId: 'section/question', points: 1, feedback: {} }),
    }), { params: Promise.resolve({ id: uuid.attempt }) });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith('submission.grade', { branchId: uuid.branch });
    expect(mocks.studioExamActor).toHaveBeenCalledWith(permissionActor, uuid.branch, 'submission.grade');
  });

  it('maps a manual grade above the question maximum to a client error', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: instructor.id, roles: [{ role: 'admin', branchId: null }] });
    mocks.createServerExamService.mockReturnValue({
      manualGrade: vi.fn().mockRejectedValue(new RangeError('Manual points must be between 0 and 2.')),
    } as unknown as ExamService);

    const response = await manualGrade(new Request(`http://localhost/api/v1/studio/exams/attempts/${uuid.attempt}/manual-grade`, {
      method: 'POST',
      body: JSON.stringify({ branchId: uuid.branch, questionId: 'section/question', points: 3, feedback: {} }),
    }), { params: Promise.resolve({ id: uuid.attempt }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INVALID_GRADE', message: 'Manual points must be between 0 and 2.' },
    });
  });

  it('lists attempts only for the requested course version', async () => {
    const result = {
      attempts: [{ attemptId: uuid.attempt, courseVersionId: uuid.version }],
      skipped: { unassigned: 0 },
    };
    mocks.requirePermission.mockResolvedValueOnce({ userId: instructor.id, roles: [{ role: 'admin', branchId: null }] });
    mocks.listStudioExamAttempts.mockResolvedValueOnce(result);

    const response = await listAttempts(new Request(
      `http://localhost/api/v1/studio/exams/exam-all/attempts?branchId=${uuid.branch}&courseVersionId=${uuid.version}`,
    ), { params: Promise.resolve({ itemId: 'exam-all' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: result });
    expect(mocks.listStudioExamAttempts).toHaveBeenCalledWith(
      expect.objectContaining({ userId: instructor.id }),
      'exam-all',
      uuid.branch,
      uuid.version,
    );
  });
});

describe('exam route source boundaries', () => {
  const routeRoot = join(process.cwd(), 'src', 'app', 'api', 'v1');
  const learnerRoutes = [
    'exams/[itemId]/attempts/route.ts',
    'exams/attempts/[attemptId]/answers/route.ts',
    'exams/attempts/[attemptId]/events/route.ts',
    'exams/attempts/[attemptId]/submit/route.ts',
    'exams/attempts/[attemptId]/review/route.ts',
  ];
  const releaseRoutes = [
    'studio/exams/[itemId]/attempts/route.ts',
    'studio/exams/[itemId]/release/route.ts',
  ];

  it.each(learnerRoutes)('%s exists and authenticates inside withHandler', (relativePath) => {
    const path = join(routeRoot, ...relativePath.split('/'));
    expect(existsSync(path), `missing ${relativePath}`).toBe(true);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect(source).toMatch(/withHandler\s*\(/);
    expect(source).toMatch(/requireApiUser\s*\(/);
  });

  it.each(releaseRoutes)('%s exists and checks exam.release inside withHandler', (relativePath) => {
    const path = join(routeRoot, ...relativePath.split('/'));
    expect(existsSync(path), `missing ${relativePath}`).toBe(true);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect(source).toMatch(/withHandler\s*\(/);
    expect(source).toMatch(/requirePermission\s*\(\s*['"]exam\.release['"]\s*,\s*\{\s*branchId/);
  });

  it('checks submission.grade inside the manual-grade handler', () => {
    const path = join(routeRoot, 'studio', 'exams', 'attempts', '[id]', 'manual-grade', 'route.ts');
    const source = readFileSync(path, 'utf8');
    expect(source).toMatch(/withHandler\s*\(/);
    expect(source).toMatch(/requirePermission\s*\(\s*['"]submission\.grade['"]\s*,\s*\{\s*branchId/);
  });


});

describe('exam error mapping', () => {
  it.each([
    ['EXAM_CLOSED', 409],
    ['NO_ATTEMPTS', 409],
    ['EXAM_CAPACITY', 503],
    ['EXAM_STARTS_PAUSED', 503],
    ['ATTEMPT_NOT_ACTIVE', 409],
    ['DEADLINE_PASSED', 409],
    ['SECTION_DEADLINE_PASSED', 409],
    ['FORBIDDEN', 403],
    ['LOCALE_UNAVAILABLE', 409],
    ['INVALID_EXAM_CONFIGURATION', 422],
    ['POOL_UNSATISFIABLE', 422],
  ] as const)('maps %s to HTTP %s', async (code, status) => {
    mocks.requireApiUser.mockResolvedValueOnce({ id: `error-${code.toLowerCase()}` });
    mocks.createServerExamService.mockReturnValue({
      submit: vi.fn().mockRejectedValue(new ExamError(code, 'mapped failure')),
    } as unknown as ExamService);

    const response = await submitAttempt(new Request(`http://localhost/api/v1/exams/attempts/${uuid.attempt}/submit`, { method: 'POST' }), {
      params: Promise.resolve({ attemptId: uuid.attempt }),
    });

    expect(response.status).toBe(status);
    if (status === 503) expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({ error: { code, message: 'mapped failure' } });
  });
});
