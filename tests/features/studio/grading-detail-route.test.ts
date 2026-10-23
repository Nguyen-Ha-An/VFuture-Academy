import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), exam: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(() => 'correlation') }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('@/features/grading/detail', () => ({
  createServerGradingDetailService: vi.fn(() => ({ exam: mocks.exam })),
}));

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
