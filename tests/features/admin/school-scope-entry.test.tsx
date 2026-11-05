import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  cookie: 'branch:school-a' as string | undefined,
  setCookie: vi.fn(),
  admin: vi.fn(),
  grading: vi.fn(),
  studio: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
  notFound: vi.fn(() => { throw new Error('not-found:404'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: () => mocks.cookie === undefined ? undefined : { value: mocks.cookie },
  set: mocks.setCookie,
}) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden, notFound: mocks.notFound }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/features/admin/context', () => ({ adminPageContext: mocks.admin }));
vi.mock('@/features/workspace/context', () => ({ gradingPageContext: mocks.grading, studioPageContext: mocks.studio }));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: async () => 'light' }));

import SchoolScopeEntry from '@/app/account/school-context/page';
import { SchoolScopeContinue } from '@/features/admin/components/SchoolScopeNavigation';

const memberId = '00000000-0000-4000-8000-000000000101';
const activeScope = { kind: 'branch' as const, branchId: 'school-a' };
const targetScope = { kind: 'branch' as const, branchId: 'school-b' };

function context() {
  return {
    actor: { userId: 'operator' },
    scope: activeScope,
    options: [
      { scope: activeScope, label: 'School A', permissions: ['admin.access', 'member.read', 'report.branch.read', 'content.read'] },
      { scope: targetScope, label: 'School B', permissions: ['admin.access', 'member.read', 'report.branch.read', 'content.read'] },
    ],
  };
}

function open(query: Record<string, string | string[] | undefined>) {
  return SchoolScopeEntry({ searchParams: Promise.resolve(query) });
}

function continuation(node: ReactNode): { label?: string; navigation?: unknown } | null {
  if (!isValidElement<{ children?: ReactNode; label?: string; navigation?: unknown }>(node)) return null;
  if (node.type === SchoolScopeContinue) return node.props;
  for (const child of Children.toArray(node.props.children)) {
    const found = continuation(child);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie = 'branch:school-a';
  mocks.admin.mockResolvedValue(context());
  mocks.grading.mockResolvedValue(context());
  mocks.studio.mockResolvedValue(context());
});

describe('read-only school scope entry', () => {
  it.each([
    [{ branchId: 'school-b', target: 'member', userId: memberId }, `/admin/users/${memberId}`],
    [{ branchId: 'school-b', target: 'members' }, '/admin/users'],
    [{ branchId: 'school-b', target: 'overview' }, '/admin'],
    [{ branchId: 'school-b', target: 'reports' }, '/grading/reports?branchId=school-b'],
    [{ branchId: 'school-b', target: 'library' }, '/studio/library'],
  ] as const)('redirects an already saved and authorized scope to its exact canonical target %o', async (query, destination) => {
    mocks.cookie = 'branch:school-b';
    await expect(open(query)).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('requires explicit continuation when another school is saved, without changing it on GET', async () => {
    const page = await open({ branchId: 'school-b', target: 'member', userId: memberId });
    expect(continuation(page)).toEqual(expect.objectContaining({
      label: 'Continue to School B',
      navigation: expect.objectContaining({
        actorId: 'operator', workspace: 'admin', activeScope, targetScope,
        savedScopeKey: 'branch:school-a', schoolName: 'School B', destination: `/admin/users/${memberId}`,
      }),
    }));
    expect(mocks.admin).toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not mistake a fallback context for a saved school preference', async () => {
    mocks.admin.mockResolvedValue({ ...context(), scope: targetScope });
    await open({ branchId: 'school-b', target: 'members' });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each([
    { branchId: 'school-b', target: 'member', userId: 'not-a-uuid' },
    { branchId: 'school-b', target: 'member' },
    { branchId: 'school-b', target: 'reports', userId: memberId },
    { branchId: 'school-b', target: 'https://evil.example' },
    { branchId: 'school-b', target: '/auth/signout' },
    { branchId: 'school-b', target: 'members', destination: '/auth/signout' },
    { branchId: 'school-b', target: 'members', workspace: 'grading' },
    { branchId: ['school-a', 'school-b'], target: 'members' },
    { branchId: '../school-b', target: 'members' },
  ])('rejects malformed or arbitrary destinations %o', async (query) => {
    await expect(open(query)).rejects.toThrow('not-found:404');
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('rejects a foreign school even if a target URL names it', async () => {
    mocks.admin.mockResolvedValue({ ...context(), options: [context().options[0]] });
    await expect(open({ branchId: 'school-b', target: 'member', userId: memberId })).rejects.toThrow('forbidden:403');
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['members', 'admin', ['member.read']],
    ['members', 'admin', ['admin.access']],
    ['reports', 'grading', ['submission.grade']],
    ['library', 'studio', ['submission.grade']],
  ] as const)('keeps the existing %s target page capability gate', async (target, owner, permissions) => {
    mocks[owner].mockResolvedValue({ ...context(), options: [
      context().options[0], { ...context().options[1], permissions: [...permissions] },
    ] });
    await expect(open({ branchId: 'school-b', target })).rejects.toThrow('forbidden:403');
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
