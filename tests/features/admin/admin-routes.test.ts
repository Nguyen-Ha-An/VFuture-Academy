import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  legacyAdminContext: vi.fn(),
  assertSameOrigin: vi.fn(),
  assertRequestScope: vi.fn(),
  assertAdminPermission: vi.fn(),
  managementRead: vi.fn(),
  managementWrite: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/admin/context', () => ({
  getAdminContext: mocks.getAdminContext,
  assertSameOrigin: mocks.assertSameOrigin,
  assertRequestScope: mocks.assertRequestScope,
  assertAdminPermission: mocks.assertAdminPermission,
}));
vi.mock('@/features/admin/legacy-context', () => ({ legacyAdminContext: mocks.legacyAdminContext }));
vi.mock('@/features/admin/management', () => ({
  managementRead: mocks.managementRead,
  managementWrite: mocks.managementWrite,
}));

import { GET as listBranches, POST as createBranch } from '@/app/api/v1/studio/branches/route';
import { PUT as updateBranch } from '@/app/api/v1/studio/branches/[branchId]/route';
import { GET as searchUsers } from '@/app/api/v1/studio/users/route';
import { PUT as assignBranch } from '@/app/api/v1/studio/users/[userId]/branch/route';
import { PUT as setRole } from '@/app/api/v1/studio/users/[userId]/roles/route';

const actor = { userId: 'admin-1', roles: [] };
const centralContext = { actor, scope: { kind: 'central' as const }, permissions: ['member.manage'], options: [], branches: [] };
const branchContext = { actor, scope: { kind: 'branch' as const, branchId: 'vinsmc' }, permissions: ['member.manage'], options: [], branches: [] };
const userId = '11111111-1111-4111-8111-111111111111';
const userRoute = { params: Promise.resolve({ userId }) };

describe('legacy administration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(centralContext);
    mocks.legacyAdminContext.mockResolvedValue(centralContext);
    mocks.managementRead.mockImplementation(async (_context: unknown, operation: string) => {
      if (operation === 'branches') return [{ id: 'vinsmc', name: 'VinSMC', city: null }];
      if (operation === 'users') return { items: [], page: 1, pageSize: 20, hasMore: false };
      return { id: userId, assignments: [] };
    });
    mocks.managementWrite.mockResolvedValue({ id: userId, assignments: [] });
  });

  it('follows branch re-exports into the Admin handler and passes only its server context to management', async () => {
    await listBranches(new Request('http://localhost/api/v1/studio/branches'));
    await createBranch(new Request('http://localhost/api/v1/studio/branches', {
      method: 'POST', body: '{"id":"hcmc","name":"HCMC","city":null}',
    }));
    await updateBranch(new Request('http://localhost/api/v1/studio/branches/vinsmc', {
      method: 'PUT', body: '{"name":"New VinSMC"}',
    }), { params: Promise.resolve({ branchId: 'vinsmc' }) });

    expect(mocks.getAdminContext).toHaveBeenCalledTimes(3);
    expect(mocks.managementRead).toHaveBeenCalledWith(centralContext, 'branches');
    expect(mocks.managementWrite).toHaveBeenCalledWith(centralContext, 'branch.create', {
      branchId: 'hcmc', name: 'HCMC', city: null,
    });
    expect(mocks.managementWrite).toHaveBeenLastCalledWith(centralContext, 'branch.update', {
      branchId: 'vinsmc', name: 'New VinSMC',
    });
  });

  it('propagates a denied Admin context and never invokes a management service', async () => {
    mocks.getAdminContext.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));

    const response = await createBranch(new Request('http://localhost/api/v1/studio/branches', {
      method: 'POST', body: '{"id":"hcmc","name":"HCMC","city":null}',
    }));

    expect(response.status).toBe(403);
    expect(mocks.managementRead).not.toHaveBeenCalled();
    expect(mocks.managementWrite).not.toHaveBeenCalled();
  });

  it('keeps member lookup in its explicitly supplied legacy scope, accepts an empty query, and never accepts a client actor', async () => {
    mocks.legacyAdminContext.mockResolvedValueOnce(branchContext);

    const response = await searchUsers(new Request('http://localhost/api/v1/studio/users?branchId=vinsmc'));

    expect(response.status).toBe(200);
    expect(mocks.legacyAdminContext).toHaveBeenCalledWith('vinsmc');
    expect(mocks.managementRead).toHaveBeenCalledWith(branchContext, 'users', {
      query: '', page: 1, pageSize: 20,
    });
    expect(mocks.managementRead.mock.calls[0]?.[0]).toBe(branchContext);
  });

  it('rejects malformed legacy route input after authorization and before a management call', async () => {
    const malformedBody = await assignBranch(new Request(`http://localhost/api/v1/studio/users/${userId}/branch`, {
      method: 'PUT', body: '{"branchId":"vinsmc","actorId":"forged"}',
    }), userRoute);
    const malformedPath = await assignBranch(new Request('http://localhost/api/v1/studio/users/not-a-uuid/branch', {
      method: 'PUT', body: '{"branchId":"vinsmc"}',
    }), { params: Promise.resolve({ userId: 'not-a-uuid' }) });

    expect(malformedBody.status).toBe(400);
    expect(malformedPath.status).toBe(400);
    expect(mocks.managementWrite).not.toHaveBeenCalled();
  });

  it('uses the active Central context for a legacy transfer and does not write when that context is denied', async () => {
    await assignBranch(new Request(`http://localhost/api/v1/studio/users/${userId}/branch`, {
      method: 'PUT', body: '{"branchId":"vinsmc"}',
    }), userRoute);
    expect(mocks.managementWrite).toHaveBeenCalledWith(centralContext, 'user.transfer', { userId, branchId: 'vinsmc' });

    vi.clearAllMocks();
    mocks.getAdminContext.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Central scope required'));
    const response = await assignBranch(new Request(`http://localhost/api/v1/studio/users/${userId}/branch`, {
      method: 'PUT', body: '{"branchId":"vinsmc"}',
    }), userRoute);
    expect(response.status).toBe(403);
    expect(mocks.managementWrite).not.toHaveBeenCalled();
  });

  it('maps legacy grants only to built-in roles and preserves an existing legacy role id for revocation', async () => {
    await setRole(new Request(`http://localhost/api/v1/studio/users/${userId}/roles`, {
      method: 'PUT', body: '{"role":"instructor","branchId":"vinsmc","enabled":true}',
    }), userRoute);
    expect(mocks.legacyAdminContext).toHaveBeenCalledWith('vinsmc');
    expect(mocks.managementWrite).toHaveBeenCalledWith(centralContext, 'user.role', {
      userId, roleId: 'teacher', branchId: 'vinsmc', enabled: true,
    });

    mocks.managementRead.mockResolvedValueOnce({
      id: userId,
      assignments: [{ roleId: 'legacy_contributor_branch', scope: { kind: 'branch', branchId: 'vinsmc' } }],
    });
    await setRole(new Request(`http://localhost/api/v1/studio/users/${userId}/roles`, {
      method: 'PUT', body: '{"role":"contributor","branchId":"vinsmc","enabled":false}',
    }), userRoute);
    expect(mocks.managementWrite).toHaveBeenLastCalledWith(centralContext, 'user.role', {
      userId, roleId: 'legacy_contributor_branch', branchId: 'vinsmc', enabled: false,
    });
  });

  it('denies an unauthorized branch role scope before it can read or mutate a member', async () => {
    mocks.legacyAdminContext.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));

    const response = await setRole(new Request(`http://localhost/api/v1/studio/users/${userId}/roles`, {
      method: 'PUT', body: '{"role":"instructor","branchId":"unmanaged-school","enabled":true}',
    }), userRoute);

    expect(response.status).toBe(403);
    expect(mocks.managementRead).not.toHaveBeenCalled();
    expect(mocks.managementWrite).not.toHaveBeenCalled();
  });
});
