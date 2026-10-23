import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminPageContext: vi.fn(),
  managementRead: vi.fn(),
  redirect: vi.fn(),
  supabaseService: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
}));

const context = {
  actor: { userId: 'lead-1', roles: [] },
  scope: { kind: 'branch' as const, branchId: 'vinsmc' },
  options: [], permissions: ['member.read', 'report.branch.read'], branches: [],
};

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden, redirect: mocks.redirect }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock('@/features/admin/context', () => ({ adminPageContext: mocks.adminPageContext }));
vi.mock('@/features/admin/management', () => ({ managementRead: mocks.managementRead }));
// Page contracts must never construct a configured client or depend on ambient env.
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/admin/components/MembersDirectory', () => ({ MembersDirectory: vi.fn(() => null) }));

import AnalyticsPage from '@/app/admin/analytics/page';
import UsersPage from '@/app/admin/users/page';

describe('scoped Admin server pages', () => {
  const database = { from: vi.fn(() => { throw new Error('Unit database reads unavailable'); }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminPageContext.mockResolvedValue(context);
    mocks.managementRead.mockResolvedValue({ members: 7 });
    mocks.supabaseService.mockReturnValue(database);
    // Next redirect terminates the server render; the mock preserves that contract.
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('renders the member directory from its authorized server scope', async () => {
    mocks.adminPageContext.mockResolvedValue(context);

    const page = await UsersPage();

    expect(mocks.adminPageContext).toHaveBeenCalledWith('member.read');
    expect(page.props.scope).toBe(context.scope);
    expect(page.props.stats).toEqual({ members: 7, learners: null, suspended: null });
    expect(mocks.managementRead).toHaveBeenCalledExactlyOnceWith(context, 'dashboard', {}, database);
  });

  it('redirects the old report entry to Assessment & grading while retaining filters', async () => {
    await expect(AnalyticsPage({ searchParams: Promise.resolve({ branchId: 'vinsmc', from: '2026-09-01' }) }))
      .rejects.toThrow('redirect:/grading/reports?branchId=vinsmc&from=2026-09-01');
    expect(mocks.redirect).toHaveBeenCalledWith('/grading/reports?branchId=vinsmc&from=2026-09-01');
    expect(mocks.managementRead).not.toHaveBeenCalled();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });
});
