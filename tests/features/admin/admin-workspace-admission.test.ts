import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  cookie: undefined as string | undefined,
  listBranches: vi.fn(),
  setCookie: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.cookie === undefined ? undefined : { value: mocks.cookie }, set: mocks.setCookie }) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden, unstable_rethrow: () => {} }));
vi.mock('@/lib/auth', () => ({ loginDestination: vi.fn(async () => '/login') }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/admin/branches', () => ({
  createSupabaseBranchRepository: vi.fn(() => ({ list: mocks.listBranches })),
}));

import {
  adminPageContext,
  adminWorkspacePageContext,
  getAdminContext,
  getAdminWorkspaceContext,
} from '@/features/admin/context';
import type { Actor, Permission, Scope } from '@/lib/permissions';
import { workspaceNavigationFor } from '@/lib/workspace-navigation';
import { POST as changeScope } from '@/app/api/v1/admin/scope/route';

function actor(grants: Array<{ permissions: Permission[]; scope: Scope }>): Actor {
  const branchIds = [...new Set(grants.flatMap(({ scope }) => scope.kind === 'branch' ? [scope.branchId] : []))];
  return {
    userId: 'operator', roles: [],
    authorization: {
      source: 'database', accountStatus: 'active',
      memberships: branchIds.map((branchId) => ({ branchId, status: 'active' as const })),
      assignments: grants.map(({ permissions, scope }, index) => ({ roleDefinitionId: `role-${index}`, scope, permissions })),
    },
  };
}

const central: Scope = { kind: 'central' };
const schoolA: Scope = { kind: 'branch', branchId: 'school-a' };
const schoolB: Scope = { kind: 'branch', branchId: 'school-b' };

/** A publisher whose only administrative work is enrollment-version migration. */
const publisher = () => actor([{ permissions: ['course.publish', 'course.read'], scope: central }]);

describe('narrow Administration admission for a course.publish publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie = undefined;
    mocks.listBranches.mockResolvedValue([{ id: 'school-a', name: 'School A' }]);
  });

  it('opens the Administration shell for enrollment-version migration', async () => {
    mocks.getActor.mockResolvedValue(publisher());

    const context = await getAdminWorkspaceContext();

    expect(context.workspace).toBe('admin');
    expect(context.scope).toEqual(central);
    expect(context.entries.admin).toBe('/admin');
  });

  it('shows only the enrollment-version destination, never members, roles or audit', async () => {
    mocks.getActor.mockResolvedValue(publisher());

    const context = await getAdminWorkspaceContext();

    expect(workspaceNavigationFor('admin', context.permissions).map((item) => item.href))
      .toEqual(['/admin/enrollment-migration']);
    expect(context.permissions).not.toContain('admin.access');
    expect(context.permissions).not.toContain('member.read');
    expect(context.permissions).not.toContain('audit.read');
  });

  it('still denies the strict Administration context every page and API uses', async () => {
    mocks.getActor.mockResolvedValue(publisher());

    await expect(getAdminContext()).rejects.toMatchObject({ status: 403 });
    await expect(adminPageContext('member.read')).rejects.toThrow('forbidden:403');
    await expect(adminPageContext('role.definition.read')).rejects.toThrow('forbidden:403');
    await expect(adminPageContext('audit.read')).rejects.toThrow('forbidden:403');
  });

  it('keeps course.publish as the only action permission the publisher gained', async () => {
    mocks.getActor.mockResolvedValue(publisher());

    const context = await adminWorkspacePageContext();

    expect(context.permissions.filter((permission) => permission !== 'course.read'))
      .toEqual(['course.publish']);
  });

  it('allows the shell to select a destination-authorized scope without granting management access', async () => {
    mocks.getActor.mockResolvedValue(publisher());
    const response = await changeScope(new Request('http://localhost/api/v1/admin/scope', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'branch:school-a' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.setCookie).toHaveBeenCalledWith('vfuture-admin-scope', 'branch:school-a', expect.any(Object));
    await expect(getAdminContext()).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a scope absent from the shell options', async () => {
    mocks.getActor.mockResolvedValue(publisher());
    const response = await changeScope(new Request('http://localhost/api/v1/admin/scope', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'branch:unknown' }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});

describe('strict Administration admission is unchanged for administrators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie = undefined;
    mocks.listBranches.mockResolvedValue([
      { id: 'school-a', name: 'School A' },
      { id: 'school-b', name: 'School B' },
    ]);
  });

  it('lists every administered school for a central administrator', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['admin.access', 'member.read', 'audit.read'], scope: central }]));

    const context = await getAdminContext();

    expect(context.scope).toEqual(central);
    expect(context.options.map((option) => option.scope))
      .toEqual([central, { kind: 'branch', branchId: 'school-a' }, { kind: 'branch', branchId: 'school-b' }]);
    expect(context.branches.map((branch) => branch.id)).toEqual(['school-a', 'school-b']);
  });

  it('keeps a school administrator inside its own school', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['admin.access', 'member.read'], scope: schoolA }]));

    const context = await getAdminContext();

    expect(context.scope).toEqual(schoolA);
    expect(context.options.map((option) => option.scope)).toEqual([schoolA]);
  });

  it.each([central, schoolA])('rejects a custom member reader without admin.access in %o', async (scope) => {
    const reader = actor([{ permissions: ['member.read'], scope }]);
    mocks.getActor.mockResolvedValue(reader);

    await expect(getAdminWorkspaceContext()).rejects.toMatchObject({ status: 403 });
    await expect(getAdminContext()).rejects.toMatchObject({ status: 403 });
    await expect(adminPageContext('member.read')).rejects.toThrow('forbidden:403');
    expect(reader.authorization?.assignments[0].permissions).toEqual(['member.read']);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('keeps shell and strict page in school A when a stale cookie selects non-admin school B', async () => {
    mocks.getActor.mockResolvedValue(actor([
      { permissions: ['admin.access', 'member.read'], scope: schoolA },
      { permissions: ['member.read'], scope: schoolB },
    ]));
    mocks.cookie = 'branch:school-b';

    const shell = await getAdminWorkspaceContext();
    const strict = await getAdminContext();

    expect(shell.scope).toEqual(schoolA);
    expect(strict.scope).toEqual(schoolA);
    expect(shell.options.map((option) => option.scope)).toEqual([schoolA]);
    expect(strict.options.map((option) => option.scope)).toEqual([schoolA]);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('rejects a school B scope switch when B only holds member.read', async () => {
    mocks.getActor.mockResolvedValue(actor([
      { permissions: ['admin.access', 'member.read'], scope: schoolA },
      { permissions: ['member.read'], scope: schoolB },
    ]));
    mocks.cookie = 'branch:school-a';

    const response = await changeScope(new Request('http://localhost/api/v1/admin/scope', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'branch:school-b' }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each([
    ['another-operator', 'branch:school-a', 'ACTOR_CHANGED'],
    ['operator', 'branch:school-b', 'SCOPE_CHANGED'],
  ])('does not mutate scope for stale navigation actor=%s scope=%s', async (actorId, scope, code) => {
    mocks.getActor.mockResolvedValue(actor([
      { permissions: ['admin.access', 'member.read'], scope: schoolA },
      { permissions: ['admin.access', 'member.read'], scope: schoolB },
    ]));
    mocks.cookie = 'branch:school-a';
    const query = new URLSearchParams({ actorId, scope });
    const response = await changeScope(new Request(`http://localhost/api/v1/admin/scope?${query}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'branch:school-b' }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each(['branch:school-b', ''])('rejects a changed saved preference even if the authorized context still resolves to A (%s)', async (expectedSaved) => {
    mocks.getActor.mockResolvedValue(actor([
      { permissions: ['admin.access', 'member.read'], scope: schoolA },
      { permissions: ['admin.access', 'member.read'], scope: schoolB },
    ]));
    mocks.cookie = 'branch:school-a';
    const response = await changeScope(new Request('http://localhost/api/v1/admin/scope?actorId=operator&scope=branch%3Aschool-a', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-vfuture-expected-saved-scope': expectedSaved },
      body: JSON.stringify({ scope: 'branch:school-b' }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'SCOPE_CHANGED' } });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('prefers a scope holding admin.access so the shell and management pages agree', async () => {
    mocks.getActor.mockResolvedValue(actor([
      { permissions: ['course.publish'], scope: central },
      { permissions: ['admin.access', 'member.read'], scope: schoolA },
    ]));

    const shell = await getAdminWorkspaceContext();
    const strict = await getAdminContext();

    expect(shell.scope).toEqual(schoolA);
    expect(strict.scope).toEqual(schoolA);
  });

  it('denies Administration to an operator with no administrative destination', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['submission.grade', 'report.branch.read'], scope: schoolA }]));

    await expect(getAdminWorkspaceContext()).rejects.toMatchObject({ status: 403 });
    await expect(getAdminContext()).rejects.toMatchObject({ status: 403 });
  });
});
