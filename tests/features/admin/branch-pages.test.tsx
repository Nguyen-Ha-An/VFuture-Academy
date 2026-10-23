import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  directory: vi.fn(),
  overview: vi.fn(),
  members: vi.fn(),
  permissions: [] as string[],
  notFound: vi.fn(() => { throw new Error('not-found'); }),
  forbidden: vi.fn(() => { throw new Error('forbidden'); }),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/features/admin/context', () => ({ adminPageContext: mocks.context }));
vi.mock('@/app/admin/branches/data', () => ({ schoolsDirectory: mocks.directory, schoolOverview: mocks.overview, schoolMembers: mocks.members }));
vi.mock('@/features/admin/actions', () => ({ enterSchoolWorkspace: vi.fn() }));
vi.mock('@/features/admin/branches', () => ({ BranchIdSchema: { safeParse: (value: string) => /^[a-z0-9-]+$/.test(value) ? { success: true, data: value } : { success: false } } }));
vi.mock('@/lib/permissions', () => ({
  can: (_actor: unknown, permission: string) => mocks.permissions.includes(permission),
  effectivePermissions: () => mocks.permissions,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) => `${namespace.split('.').at(-1)}.${key}${values ? `:${Object.values(values).join(',')}` : ''}`,
  getFormatter: async () => ({ number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en', options).format(value) }),
  getLocale: async () => 'vi',
}));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  forbidden: mocks.forbidden,
  usePathname: () => '/admin/branches/ans',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import BranchesPage from '@/app/admin/branches/page';
import BranchPage from '@/app/admin/branches/[branchId]/page';

const school = { id: 'ans', name: 'ANS', city: 'Ha Noi', createdAt: '2026-09-01' };
const cells = { activeLearners30d: 12, enrollments: 40, completedEnrollments: 10, completionPercent: 25, pendingGrading: 3, averagePercent: 81.5 };

function html(page: ReactElement) {
  return renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}>{page}</NextIntlClientProvider>);
}

function branchPage(search: Record<string, string> = {}) {
  return BranchPage({ params: Promise.resolve({ branchId: 'ans' }), searchParams: Promise.resolve(search) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = ['branch.read', 'member.read', 'report.branch.read'];
  mocks.context.mockImplementation(async () => ({ scope: { kind: 'central' }, actor: {}, permissions: ['branch.read', 'branch.manage', 'report.global.read'], branches: [school] }));
  mocks.directory.mockResolvedValue({ branches: [school], reports: { state: 'ready', rows: { ans: cells } } });
  mocks.overview.mockResolvedValue({ counts: { members: 7, enrollments: 40 }, report: { state: 'ready', cells } });
  mocks.members.mockResolvedValue({ items: [], page: 1, pageSize: 50, hasMore: false });
});

describe('/admin/branches', () => {
  it('reads schools with reports for a global report reader and lets central managers edit', async () => {
    const page = await BranchesPage();
    expect(mocks.context).toHaveBeenCalledWith('branch.read');
    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), { withReports: true });
    expect(page.props).toMatchObject({ initialBranches: [school], reports: { ans: cells }, canManage: true });
  });

  it('hides report columns without report permission and marks failed reports unavailable', async () => {
    mocks.context.mockImplementation(async () => ({ scope: { kind: 'branch', branchId: 'ans' }, actor: {}, permissions: ['branch.read', 'branch.manage'], branches: [school] }));
    mocks.directory.mockResolvedValue({ branches: [school], reports: { state: 'hidden' } });
    const hidden = await BranchesPage();
    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), { withReports: false });
    expect(hidden.props.reports).toBeUndefined();
    expect(hidden.props.canManage).toBe(false);

    mocks.directory.mockResolvedValue({ branches: [school], reports: { state: 'unavailable' } });
    expect((await BranchesPage()).props.reports).toBe('unavailable');
  });
});

describe('/admin/branches/[branchId]', () => {
  it('shows the school header with Enter school, its KPI row and a Reports tab to grading reports', async () => {
    const markup = html(await branchPage());
    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'branch', branchId: 'ans' } }), 'ans', { withReports: true });
    expect(markup).toContain('centralAdmin.enterSchool');
    expect(markup).toContain('name="scope" value="branch:ans"');
    expect(markup).toContain('schoolDetail.stats.members');
    expect(markup).not.toContain('schoolDetail.stats.pendingGrading');
    expect(markup).toContain('25%');
    expect(markup).toContain('81.5%');
    expect(markup).toContain('href="/grading/reports?branchId=ans"');
  });

  it('says Unavailable for a failed dashboard or report read instead of 0', async () => {
    mocks.overview.mockResolvedValue({ counts: null, report: { state: 'unavailable' } });
    const markup = html(await branchPage());
    expect(markup.match(/schoolDetail\.unavailable/g)).toHaveLength(6);
  });

  it('pages members with ?page= instead of a 50-row cap', async () => {
    mocks.members.mockResolvedValue({
      items: [{ id: 'm-1', displayName: 'Lan', email: 'lan@example.test', accountStatus: 'active', memberships: [{ branchId: 'ans', status: 'active' }], assignments: [{ roleName: 'Teacher' }] }],
      page: 2, pageSize: 50, hasMore: true,
    });
    const markup = html(await branchPage({ tab: 'members', page: '2' }));
    expect(mocks.members).toHaveBeenCalledWith(expect.anything(), { page: 2, staff: false });
    expect(markup).toContain('Lan');
    expect(markup).toContain('Teacher');
    expect(markup).toContain('Page 2');
    expect(markup).toContain('href="/admin/branches/ans?tab=members&amp;page=3"');
    expect(markup).toContain('href="/admin/branches/ans?tab=members"');
    expect(markup).toContain('value="/admin/users"');
  });

  it('shows the membership status in this school, not only the account status', async () => {
    mocks.members.mockResolvedValue({
      items: [
        { id: 'm-1', displayName: 'Lan', email: 'lan@example.test', accountStatus: 'active', memberships: [{ branchId: 'other', status: 'active' }, { branchId: 'ans', status: 'suspended' }], assignments: [] },
        { id: 'm-2', displayName: 'Minh', email: 'minh@example.test', accountStatus: 'active', memberships: [{ branchId: 'ans', status: 'active' }], assignments: [] },
      ],
      page: 1, pageSize: 50, hasMore: false,
    });
    const markup = html(await branchPage({ tab: 'members' }));
    const lan = markup.slice(markup.indexOf('Lan'), markup.indexOf('Minh'));
    expect(lan).toContain('data-tone="danger"');
    expect(markup.slice(markup.indexOf('Minh'))).toContain('data-tone="success"');
  });

    it('fills the overview with a members preview and the school\'s recent activity', async () => {
    mocks.overview.mockResolvedValue({
      counts: { members: 7, recentActivity: [{ id: 'a1', action: 'user.role_granted', actorId: 'actor-1', targetType: 'user', targetId: 'm-1', at: '2026-09-20T00:00:00.000Z' }] },
      report: { state: 'hidden' },
      actors: { 'actor-1': { name: 'Trần Gia Bảo', avatarUrl: null }, 'm-1': { name: 'Lan', avatarUrl: null } },
    });
    mocks.members.mockResolvedValue({
      items: Array.from({ length: 8 }, (_, index) => ({ id: `m-${index}`, displayName: `Member ${index}`, email: `m${index}@example.test`, accountStatus: 'active', memberships: [{ branchId: 'ans', status: 'active' }], assignments: [] })),
      page: 1, pageSize: 50, hasMore: true,
    });
    const markup = html(await branchPage());
    expect(mocks.members).toHaveBeenCalledWith(expect.anything(), { page: 1, staff: false });
    expect(markup).toContain('schoolDetail.activityTitle');
    expect(markup).toContain('Trần Gia Bảo');
    expect(markup).toContain('đã cấp vai trò');
    // Five rows preview the list; the full list is one link away.
    expect(markup).toContain('Member 4');
    expect(markup).not.toContain('Member 5');
    expect(markup).toContain('href="/admin/branches/ans?tab=members"');
  });

  it('keeps the staff filter and hides tabs the actor cannot read', async () => {
    mocks.permissions = ['branch.read', 'member.read'];
    const markup = html(await branchPage({ tab: 'staff' }));
    expect(mocks.members).toHaveBeenCalledWith(expect.anything(), { page: 1, staff: true });
    expect(markup).not.toContain('/grading/reports');
    expect(markup).not.toContain('centralAdmin.cms');
  });

  it('rejects unknown schools and schools outside the actor scope', async () => {
    await expect(BranchPage({ params: Promise.resolve({ branchId: 'other' }), searchParams: Promise.resolve({}) })).rejects.toThrow('not-found');
    mocks.permissions = [];
    await expect(branchPage()).rejects.toThrow('forbidden');
  });
});
