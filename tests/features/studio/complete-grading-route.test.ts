import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), completeExamGrading: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(() => 'correlation') }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('@/features/exams/server', () => ({ completeExamGrading: mocks.completeExamGrading }));

import { POST } from '@/app/api/v1/studio/exams/attempts/[id]/complete-grading/route';
import { ApiError } from '@/lib/api';
import { ExamError } from '@/features/exams/types';

const ATTEMPT = '33333333-3333-4333-8333-333333333333';

const grader = {
  userId: 'grader', roles: [], authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'school-a', status: 'active' }],
    assignments: [{
      roleDefinitionId: 'grader',
      scope: { kind: 'branch', branchId: 'school-a' },
      permissions: ['submission.grade'],
    }],
  },
};

const completed = {
  attempt: {
    attemptId: ATTEMPT,
    userId: 'learner',
    courseVersionId: '22222222-2222-4222-8222-222222222222',
    itemId: 'exam-one',
    branchId: 'school-a',
    attemptNo: 1,
    status: 'graded' as const,
    late: false,
    startedAt: '2026-09-07T00:00:00.000Z',
    deadlineAt: null,
    submittedAt: '2026-09-07T01:00:00.000Z',
    points: 11,
    maxPoints: 12,
    percent: 91.67,
    releasedAt: null,
    resultAvailableAt: '2026-09-07T04:00:00.000Z',
  },
  transitioned: true,
};

function request(body: string | null = '{}') {
  return new Request(`https://example.test/api/v1/studio/exams/attempts/${ATTEMPT}/complete-grading`, {
    method: 'POST',
    ...(body === null ? {} : { body }),
  });
}

const context = { params: Promise.resolve({ id: ATTEMPT }) };

describe('exam complete-grading route', () => {
  it('finalizes on an empty object body and returns the locking DTO', async () => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockResolvedValue(completed);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    // The UI locks from this response, so a success must always carry the final
    // status, the full points and a real availability timestamp.
    await expect(response.json()).resolves.toEqual({
      data: {
        transitioned: true,
        attempt: expect.objectContaining({
          status: 'graded',
          points: 11,
          maxPoints: 12,
          percent: 91.67,
          resultAvailableAt: '2026-09-07T04:00:00.000Z',
          releasedAt: null,
        }),
      },
    });
    expect(mocks.completeExamGrading).toHaveBeenCalledWith(grader, ATTEMPT);
  });

  it('answers 200 with the current final state on an idempotent retry', async () => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockResolvedValue({ ...completed, transitioned: false });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.transitioned).toBe(false);
    expect(body.data.attempt.resultAvailableAt).toBe('2026-09-07T04:00:00.000Z');
  });

  it('rejects a body that carries anything, including a client-nominated branch', async () => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockClear();

    const response = await POST(request(JSON.stringify({ branchId: 'school-a' })), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(mocks.completeExamGrading).not.toHaveBeenCalled();
  });

  it('requires authentication before touching the attempt', async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.completeExamGrading.mockClear();

    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(mocks.completeExamGrading).not.toHaveBeenCalled();
  });

  it('rejects a malformed attempt id', async () => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockClear();

    const response = await POST(request(), { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(response.status).toBe(400);
    expect(mocks.completeExamGrading).not.toHaveBeenCalled();
  });

  it.each([
    ['MANUAL_GRADING_INCOMPLETE', 409],
    ['ATTEMPT_NOT_ACTIVE', 409],
    ['GRADING_CONFLICT', 409],
    ['LEGACY_RESULT_UNRELEASED', 409],
    ['FORBIDDEN', 403],
  ] as const)('maps the %s domain failure to HTTP %i', async (code, status) => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockRejectedValue(new ExamError(code, 'refused'));

    const response = await POST(request(), context);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it('surfaces a missing attempt as 404 and an out-of-range stored score as 400', async () => {
    mocks.getActor.mockResolvedValue(grader);
    mocks.completeExamGrading.mockRejectedValue(
      new ApiError(404, 'EXAM_ATTEMPT_NOT_FOUND', 'Exam attempt not found'),
    );
    const missing = await POST(request(), context);
    expect(missing.status).toBe(404);

    mocks.completeExamGrading.mockRejectedValue(new RangeError('Stored manual points out of range.'));
    const invalid = await POST(request(), context);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'INVALID_GRADE' } });
  });
});
