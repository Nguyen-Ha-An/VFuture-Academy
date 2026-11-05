import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), exam: vi.fn(), assignment: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(() => 'correlation') }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('@/features/submissions/route-auth', () => ({ requireSubmissionGrader: () => mocks.getActor() }));
vi.mock('@/features/grading/detail', () => ({
  createServerGradingDetailService: vi.fn(() => ({ exam: mocks.exam, assignment: mocks.assignment })),
}));

vi.mock('@/features/workspace/context', async (original) => ({
  ...(await original<typeof import('@/features/workspace/context')>()),
  getGradingContext: vi.fn(async () => ({ actor: await mocks.getActor(), scope: { kind: 'branch', branchId: 'school-a' } })),
}));

import { GET as assignmentDetail } from '@/app/api/v1/studio/grading/assignments/[submissionId]/route';
import { GET } from '@/app/api/v1/studio/grading/exams/[attemptId]/route';

describe('exam grading detail route', () => {
  it('rejects a release-only actor before loading answer-key detail', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'releaser', roles: [], authorization: {
        source: 'database', accountStatus: 'active',
        memberships: [{ branchId: 'school-a', status: 'active' }],
        assignments: [{ roleDefinitionId: 'release', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['exam.release'] }],
      },
    });

    const response = await GET(
      new Request('https://example.test/api/v1/studio/grading/exams/33333333-3333-4333-8333-333333333333?branchId=school-a'),
      { params: Promise.resolve({ attemptId: '33333333-3333-4333-8333-333333333333' }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(mocks.exam).not.toHaveBeenCalled();
  });
});

const grader = { userId: 'grader', roles: [{ role: 'instructor' as const, branchId: 'school-a' }] };
const recordId = '33333333-3333-4333-8333-333333333333';
beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue(grader);
  mocks.exam.mockReset().mockResolvedValue({ kind: 'exam' });
  mocks.assignment.mockReset().mockResolvedValue({ kind: 'assignment' });
});

for (const [kind, handler, parameter, load] of [
  ['exams', GET, 'attemptId', mocks.exam],
  ['assignments', assignmentDetail, 'submissionId', mocks.assignment],
] as const) {
  describe(`${kind} grading request guards`, () => {
    it.each([
      ['actorId=old-account&scope=branch%3Aschool-a', 'ACTOR_CHANGED'],
      ['actorId=grader&scope=branch%3Aschool-b', 'SCOPE_CHANGED'],
    ])('rejects stale workspace state: %s', async (query, code) => {
      const response = await handler(new Request(`https://example.test/api/v1/studio/grading/${kind}/${recordId}?branchId=school-a&${query}`), {
        params: Promise.resolve({ [parameter]: recordId }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(load).not.toHaveBeenCalled();
    });

    it('allows an authorized school grader through the matching actor and scope', async () => {
      const response = await handler(new Request(`https://example.test/api/v1/studio/grading/${kind}/${recordId}?branchId=school-a&locale=en&actorId=grader&scope=branch%3Aschool-a`), {
        params: Promise.resolve({ [parameter]: recordId }),
      });
      expect(response.status).toBe(200);
      expect(load).toHaveBeenCalledWith(grader, recordId, 'school-a', ...(kind === 'assignments' ? ['en'] : []));
    });
  });
}
