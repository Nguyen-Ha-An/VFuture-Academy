import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGradingContext: vi.fn(),
  set: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock('@/features/workspace/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workspace/context')>()),
  getGradingContext: mocks.getGradingContext,
}));

import { POST } from '@/app/api/v1/grading/scope/route';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://academy.example/api/v1/grading/scope', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://academy.example', ...headers },
    body: JSON.stringify(body),
  });
}

describe('grading workspace scope endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGradingContext.mockResolvedValue({
      workspace: 'grading',
      actor: { userId: 'teacher-1', roles: [] },
      scope: { kind: 'branch', branchId: 'school-a' },
      options: [
        { scope: { kind: 'branch', branchId: 'school-a' }, label: 'School A', permissions: ['submission.grade'] },
        { scope: { kind: 'branch', branchId: 'school-b' }, label: 'School B', permissions: ['report.branch.read'] },
      ],
      permissions: ['submission.grade'], branches: [],
      entries: { studio: null, grading: '/grading', admin: null },
    });
  });

  it('stores an authorized grading scope without leaving the workspace cookie behind', async () => {
    const response = await POST(request({ scope: 'branch:school-b' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { scope: 'branch:school-b' } });
    expect(mocks.set).toHaveBeenCalledWith('vfuture-admin-scope', 'branch:school-b', expect.objectContaining({
      httpOnly: true, sameSite: 'lax', path: '/',
    }));
  });

  it('rejects a scope the grading workspace did not authorize', async () => {
    const response = await POST(request({ scope: 'branch:other-school' }));

    expect(response.status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects a Central scope that only Administration would offer', async () => {
    const response = await POST(request({ scope: 'central' }));

    expect(response.status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin scope change before resolving the workspace', async () => {
    const response = await POST(request({ scope: 'branch:school-b' }, { origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    expect(mocks.getGradingContext).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects a malformed body before resolving the workspace', async () => {
    const response = await POST(request({ scope: 42 }));

    expect(response.status).toBe(400);
    expect(mocks.getGradingContext).not.toHaveBeenCalled();
  });
});
