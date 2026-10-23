import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const analyticsService = { branch: vi.fn() };
  return {
    requirePermission: vi.fn(),
    createAdminAnalyticsService: vi.fn(() => analyticsService),
    createSupabaseAnalyticsRepository: vi.fn(() => ({})),
    analyticsService,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/admin/analytics', () => ({
  createAdminAnalyticsService: mocks.createAdminAnalyticsService,
  createSupabaseAnalyticsRepository: mocks.createSupabaseAnalyticsRepository,
}));

import { GET } from '@/app/api/v1/studio/analytics/branch/[branchId]/route';

const context = { params: Promise.resolve({ branchId: 'vinsmc' }) };
const actor = { userId: 'lead-1', roles: [{ role: 'branch_lead', branchId: 'vinsmc' }] };

describe('branch analytics route scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.analyticsService.branch.mockResolvedValue({ branchId: 'vinsmc' });
  });

  it('checks analytics.branch.read at the requested branch before data access', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));

    const response = await GET(new Request('http://localhost/api/v1/studio/analytics/branch/vinsmc'), context);

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith('report.branch.read', { kind: 'branch', branchId: 'vinsmc' });
    expect(mocks.createAdminAnalyticsService).not.toHaveBeenCalled();
  });

  it('returns the scoped branch analytics envelope to an authorized actor', async () => {
    const response = await GET(new Request('http://localhost/api/v1/studio/analytics/branch/vinsmc'), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { branchId: 'vinsmc' } });
    expect(mocks.analyticsService.branch).toHaveBeenCalledWith(actor, 'vinsmc');
  });

  it('rejects a non-kebab-case branch path before permission or data access', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/studio/analytics/branch/Bad_Branch'),
      { params: Promise.resolve({ branchId: 'Bad_Branch' }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.analyticsService.branch).not.toHaveBeenCalled();
  });
});
