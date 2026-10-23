import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  forbidden: vi.fn(() => {
    throw new Error('forbidden:403');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden }));

import { requireStudioPermission } from '@/app/studio/requireStudioPermission';

describe('Studio page authorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts permission denials into the Next 403 control-flow interrupt', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));

    await expect(requireStudioPermission('bank.edit')).rejects.toThrow('forbidden:403');
    expect(mocks.forbidden).toHaveBeenCalledTimes(1);
  });

  it('does not hide unexpected authorization failures', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('identity database unavailable'));

    await expect(requireStudioPermission('bank.edit')).rejects.toThrow('identity database unavailable');
    expect(mocks.forbidden).toHaveBeenCalledTimes(0);
  });
});
