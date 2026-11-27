import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  assertContentAccess: vi.fn(),
  assertWorkspacePermission: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/features/admin/content-review-production', () => ({ typedContentContext: mocks.context }));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: mocks.assertContentAccess }));
vi.mock('@/features/workspace/context', () => ({ assertWorkspacePermission: mocks.assertWorkspacePermission }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({}) }));
vi.mock('@/features/resources/files-pilot', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/resources/files-pilot')>(),
  createResourceFilesPilot: () => ({ submit: mocks.submit, status: mocks.status, refresh: mocks.refresh }),
}));
vi.mock('server-only', () => ({}));

import { GET, PATCH, POST } from '@/app/api/v1/studio/resources/[id]/files/route';

const actor = { userId: '4f32b9b4-c439-4244-872f-1f2b63227ab4' };
const makeContext = (id = 'teacher-guide') => ({ params: Promise.resolve({ id }) });

function request(method: string, origin = 'https://academy.example') {
  const headers = { origin };
  return new Request('https://academy.example/api/v1/studio/resources/teacher-guide/files', { method, headers });
}

describe('Academy Studio Files route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ACADEMY_FILES_PILOT_RESOURCE_ID', 'teacher-guide');
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'true');
    mocks.context.mockResolvedValue({ context: { actor, scope: { kind: 'central' } } });
    mocks.assertContentAccess.mockResolvedValue(undefined);
    mocks.assertWorkspacePermission.mockReturnValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('denies cross-origin uploads and branch workspaces before any service request', async () => {
    const deniedOrigin = await POST(request('POST', 'https://example.test'), makeContext());
    expect(deniedOrigin.status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
    mocks.context.mockResolvedValue({ context: { actor, scope: { kind: 'branch', branchId: 'test' } } });
    expect((await POST(request('POST'), makeContext())).status).toBe(403);
    expect(mocks.assertContentAccess).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('uses the Studio publish and edit guards, including per-resource authorization', async () => {
    mocks.assertContentAccess.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const upload = request('POST');
    expect((await POST(upload, makeContext())).status).toBe(403);
    expect(mocks.context).toHaveBeenCalledWith(upload, 'content.publish', 'resource.publish', true);
    expect(mocks.assertWorkspacePermission).toHaveBeenCalledWith(expect.objectContaining({ actor }), 'resource.edit');
    expect(mocks.assertContentAccess).toHaveBeenCalledWith({}, actor, 'resource', 'teacher-guide', 'content.edit');
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects disabled and unrelated uploads and preserves read and refresh actions', async () => {
    expect((await POST(request('POST'), makeContext('other-guide'))).status).toBe(404);
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'false');
    expect((await POST(request('POST'), makeContext())).status).toBe(404);
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.status.mockResolvedValue({ status: 'review' });
    mocks.refresh.mockResolvedValue({ status: 'withdrawn' });
    const existing = await GET(request('GET'), makeContext());
    expect(existing.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(existing.json()).resolves.toEqual({ data: { status: 'review' } });
    await expect((await PATCH(request('PATCH'), makeContext())).json()).resolves.toEqual({ data: { status: 'withdrawn' } });
  });
});
