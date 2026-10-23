import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: { scope: { kind: 'branch' as const, branchId: 'ans' }, actor: {}, options: [], permissions: ['member.read', 'role.definition.read'], branches: [] },
  adminPageContext: vi.fn(async () => mocks.context),
  forbidden: vi.fn(),
  stats: { members: 12, learners: 9, suspended: null, pendingInvitations: 2 },
  memberStats: vi.fn(async () => mocks.stats),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden }));
vi.mock('@/features/admin/context', () => ({ adminPageContext: mocks.adminPageContext }));
vi.mock('@/features/admin/member-stats', () => ({ memberStats: mocks.memberStats }));
vi.mock('@/features/admin/components/MembersDirectory', () => ({ MembersDirectory: vi.fn(() => null) }));
vi.mock('@/features/admin/components/MemberProfile', () => ({ MemberProfile: vi.fn(() => null) }));
vi.mock('@/features/admin/components/RoleManager', () => ({ RoleManager: vi.fn(() => null) }));

import UsersPage from '@/app/admin/users/page';
import MemberPage from '@/app/admin/users/[userId]/page';
import RolesPage from '@/app/admin/roles/page';

describe('member management server pages', () => {
  it('uses the page context wrapper before rendering the directory', async () => {
    const page = await UsersPage();
    expect(mocks.adminPageContext).toHaveBeenCalledWith('member.read');
    expect(page.props.scope).toEqual(mocks.context.scope);
  });

  it('reads the member KPIs through the one stats module and hands them to the directory', async () => {
    const page = await UsersPage();
    expect(mocks.memberStats).toHaveBeenCalledWith(mocks.context);
    expect(page.props.stats).toEqual(mocks.stats);
  });

  it('uses the page context wrapper before rendering a profile', async () => {
    const page = await MemberPage({ params: Promise.resolve({ userId: 'member-1' }) });
    expect(mocks.adminPageContext).toHaveBeenCalledWith('member.read');
    expect(page.props.userId).toBe('member-1');
  });

  it('allows a branch role assigner to view its assignable roles', async () => {
    mocks.context.permissions = ['role.assignment.branch'];
    const page = await RolesPage();
    expect(mocks.adminPageContext).toHaveBeenCalledWith();
    expect(page.props.scope).toEqual(mocks.context.scope);
  });

  it('renders the forbidden response when no role view capability is present', async () => {
    mocks.context.permissions = [];
    await RolesPage();
    expect(mocks.forbidden).toHaveBeenCalled();
  });
});
