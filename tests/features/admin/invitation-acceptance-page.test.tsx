import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor, Permission } from '@/lib/authorization';

const mocks = vi.hoisted(() => ({
  actor: null as unknown,
  redirect: vi.fn(),
  notFound: vi.fn(),
  loginDestination: vi.fn(async (next: string) => `/login?next=${encodeURIComponent(next)}`),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: vi.fn(async () => mocks.actor),
}));
vi.mock('@/features/admin/components/InvitationAcceptance', () => ({ InvitationAcceptance: vi.fn(() => null) }));

import InvitePage from '@/app/invite/[token]/page';

const token = 'a'.repeat(43);

function invitee(permissions: Permission[]): Actor {
  return {
    userId: 'invitee', roles: [],
    authorization: {
      source: 'database', accountStatus: 'active',
      memberships: [{ branchId: 'school-a', status: 'active' }],
      assignments: [{ roleDefinitionId: 'role', scope: { kind: 'branch', branchId: 'school-a' }, permissions }],
    },
  };
}

describe('invitation acceptance page', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['a content editor', ['content.read', 'course.read'], '/studio', false],
    ['a grading-only teacher', ['submission.grade'], '/grading', false],
    ['a report-only operator', ['report.branch.read'], '/grading', false],
    ['an administrator', ['admin.access', 'member.read'], '/admin', true],
    ['a learner with no staff workspace', [], '/app', false],
  ] as const)('continues %s to their own workspace', async (_name, permissions, destination, canAccessAdmin) => {
    mocks.actor = invitee([...permissions]);

    const page = await InvitePage({ params: Promise.resolve({ token }) });

    expect(page.props.destination).toBe(destination);
    expect(page.props.canAccessAdmin).toBe(canAccessAdmin);
    expect(page.props.token).toHaveLength(43);
  });

  it('prefers Studio when an invitee can enter more than one workspace', async () => {
    mocks.actor = invitee(['course.read', 'submission.grade', 'admin.access']);

    const page = await InvitePage({ params: Promise.resolve({ token }) });

    expect(page.props.destination).toBe('/studio');
    expect(page.props.canAccessAdmin).toBe(true);
  });

  it('requires authentication while preserving only the invite return path', async () => {
    mocks.actor = null;
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });

    await expect(InvitePage({ params: Promise.resolve({ token }) }))
      .rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    expect(mocks.loginDestination).toHaveBeenCalledWith(`/invite/${token}`);
  });

  it('rejects malformed tokens before rendering an acceptance control', async () => {
    mocks.actor = invitee(['admin.access']);
    mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });

    await expect(InvitePage({ params: Promise.resolve({ token: 'not-valid' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
