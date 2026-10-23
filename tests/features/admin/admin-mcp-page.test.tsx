import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminPageContext: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden }));
vi.mock('@/features/admin/context', () => ({ adminPageContext: mocks.adminPageContext }));
vi.mock('@/features/admin/components/McpBlockView', () => ({ McpBlockView: vi.fn(() => null) }));

import AdminMcpPage from '@/app/admin/mcp/page';
import { McpBlockView } from '@/features/admin/components/McpBlockView';

const memberId = '00000000-0000-4000-8000-000000000123';
const adminId = '00000000-0000-4000-8000-000000000456';
const centralContext = { scope: { kind: 'central' as const }, actor: { userId: adminId } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminPageContext.mockResolvedValue(centralContext);
});

describe('/admin/mcp', () => {
  it('requires global user management and passes the prefilled member ID and actor to the client', async () => {
    const page = await AdminMcpPage({ searchParams: Promise.resolve({ userId: memberId }) });

    expect(mocks.adminPageContext).toHaveBeenCalledWith('user.manage.global');
    expect(page.type).toBe(McpBlockView);
    expect(page.props).toEqual({ initialUserId: memberId, actorId: adminId });
  });

  it('starts without a selected member when no ID is provided', async () => {
    const page = await AdminMcpPage({ searchParams: Promise.resolve({}) });

    expect(page.props.initialUserId).toBe('');
  });

  it('forbids a branch scope even when its context resolves', async () => {
    mocks.adminPageContext.mockResolvedValue({
      ...centralContext,
      scope: { kind: 'branch', branchId: 'ans' },
    });

    await expect(AdminMcpPage({ searchParams: Promise.resolve({ userId: memberId }) }))
      .rejects.toThrow('forbidden:403');
    expect(mocks.adminPageContext).toHaveBeenCalledWith('user.manage.global');
    expect(mocks.forbidden).toHaveBeenCalledOnce();
  });
});
