import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ studio: vi.fn(), combined: vi.fn(), set: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock('@/features/workspace/context', () => ({
  getStudioContext: mocks.studio,
  getWorkspaceContext: mocks.combined,
  assertWorkspaceSameOrigin: vi.fn(),
}));
import { POST } from '@/app/api/v1/studio/scope/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.studio.mockResolvedValue({ options: [{ scope: { kind: 'branch', branchId: 'authoring-school' } }] });
  mocks.combined.mockResolvedValue({ options: [
    { scope: { kind: 'branch', branchId: 'authoring-school' } },
    { scope: { kind: 'branch', branchId: 'grading-school' } },
  ] });
});

const request = (scope: string) => new Request('https://example.test/api/v1/studio/scope', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope }),
});

describe('Studio scope selection', () => {
  it('rejects a grading-only school rather than storing a preference Studio cannot activate', async () => {
    const response = await POST(request('branch:grading-school'));
    expect(response.status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.combined).not.toHaveBeenCalled();
  });

  it('sets an authoring scope that the Studio page and content APIs can actually resolve', async () => {
    const response = await POST(request('branch:authoring-school'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { scope: 'branch:authoring-school' } });
    expect(mocks.studio).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), 'branch:authoring-school', expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  });
});
