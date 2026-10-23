import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import {
  createBranchAdmin,
  type Branch,
  type BranchRepository,
} from '@/features/admin/branches';
import {
  createAdminUsersService,
  matchesUserSearch,
  RoleMutationSchema,
  UserSearchSchema,
  type AdminUser,
  type AdminUserRepository,
} from '@/features/admin/users';

const admin: Actor = { userId: 'admin-1', roles: [{ role: 'admin', branchId: null }] };
const lead: Actor = { userId: 'lead-1', roles: [{ role: 'branch_lead', branchId: 'vinsmc' }] };
const editor: Actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };

function branchRepository(initial: Branch[] = []): BranchRepository & { mutations: string[] } {
  const branches = [...initial];
  const mutations: string[] = [];
  return {
    mutations,
    async list() { return [...branches]; },
    async create(input, actorId) {
      const value = { ...input, createdAt: '2026-09-03T00:00:00.000Z' };
      branches.push(value);
      mutations.push(`create:${value.id}:${actorId}`);
      return value;
    },
    async update(id, input, actorId) {
      const index = branches.findIndex((branch) => branch.id === id);
      if (index < 0) return null;
      branches[index] = { ...branches[index], ...input };
      mutations.push(`update:${id}:${actorId}`);
      return branches[index];
    },
  };
}

function userRepository(initial: AdminUser[]): AdminUserRepository & { mutations: string[] } {
  const users = new Map(initial.map((user) => [user.id, structuredClone(user)]));
  const mutations: string[] = [];
  return {
    mutations,
    async consumeSearchToken() { return { allowed: true, retryAfterSeconds: 0 }; },
    async search(input) {
      const { page, pageSize } = input;
      const filtered = [...users.values()].filter((user) => matchesUserSearch(user, input));
      const start = (page - 1) * pageSize;
      return { items: filtered.slice(start, start + pageSize), page, pageSize, hasMore: filtered.length > start + pageSize };
    },
    async get(id) { return structuredClone(users.get(id) ?? null); },
    async updateBranch(id, branchId, actorId) {
      const user = users.get(id);
      if (!user) return;
      user.branchId = branchId;
      mutations.push(`branch:${id}:${branchId}:${actorId}`);
    },
    async setRole(userId, role, enabled, actorId) {
      const user = users.get(userId)!;
      if (enabled) user.roles.push(role);
      else user.roles = user.roles.filter((candidate) => candidate.role !== role.role || candidate.branchId !== role.branchId);
      mutations.push(`${enabled ? 'grant' : 'revoke'}:${role.role}:${role.branchId}:${actorId}`);
    },
  };
}

const learner = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'learner-1',
  email: 'learner@example.com',
  handle: 'learner',
  displayName: 'Learner',
  branchId: 'vinsmc',
  roles: [],
  ...overrides,
});

describe('branch administration', () => {
  it('allows only global managers to list and mutate branches and audits mutations', async () => {
    const audit = vi.fn(async () => undefined);
    const repository = branchRepository([{ id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' }]);
    const service = createBranchAdmin({ repository });

    await expect(service.list(lead)).rejects.toBeInstanceOf(ApiError);
    await expect(service.create(admin, { id: 'hcmc', name: 'HCMC', city: 'Ho Chi Minh City' })).resolves.toMatchObject({ id: 'hcmc' });
    await expect(service.update(admin, 'hcmc', { name: 'VFuture HCMC', city: null })).resolves.toMatchObject({ name: 'VFuture HCMC' });

    expect(repository.mutations).toEqual(['create:hcmc:admin-1', 'update:hcmc:admin-1']);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('admin user permission matrix', () => {
  it('lets a branch lead grant scoped instructors and revoke a legacy scoped contributor', async () => {
    const audit = vi.fn(async () => undefined);
    const repository = userRepository([learner({ roles: [{ role: 'contributor', branchId: 'vinsmc' }] })]);
    const service = createAdminUsersService({ repository, audit });

    await service.setRole(lead, 'learner-1', { role: 'instructor', branchId: 'vinsmc', enabled: true });
    await expect(service.setRole(lead, 'learner-1', { role: 'contributor', branchId: 'vinsmc', enabled: true }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await service.setRole(lead, 'learner-1', { role: 'contributor', branchId: 'vinsmc', enabled: false });

    expect(repository.mutations).toEqual(['grant:instructor:vinsmc:lead-1', 'revoke:contributor:vinsmc:lead-1']);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ['admin', null],
    ['editor', null],
    ['branch_lead', 'vinsmc'],
    ['instructor', 'ans'],
    ['contributor', 'ans'],
  ] as const)('denies a branch lead changing %s at scope %s', async (role, branchId) => {
    const repository = userRepository([learner()]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.setRole(lead, 'learner-1', { role, branchId, enabled: true })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repository.mutations).toEqual([]);
  });

  it('allows an admin to manage privileged global roles and scoped branch roles', async () => {
    const repository = userRepository([learner()]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await service.setRole(admin, 'learner-1', { role: 'editor', branchId: null, enabled: true });
    await service.setRole(admin, 'learner-1', { role: 'branch_lead', branchId: 'vinsmc', enabled: true });

    expect(repository.mutations).toEqual(['grant:editor:null:admin-1', 'grant:branch_lead:vinsmc:admin-1']);
  });

  it.each(['contributor', 'editor'] as const)('rejects a new branch-scoped %s grant without promoting it globally', async (role) => {
    const repository = userRepository([learner()]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    expect(RoleMutationSchema.safeParse({ role, branchId: 'vinsmc', enabled: true }).success).toBe(false);
    await expect(service.setRole(admin, 'learner-1', { role, branchId: 'vinsmc', enabled: true }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_ROLE_SCOPE' });
    expect(repository.mutations).toEqual([]);
  });

  it('allows a global manager to revoke an existing legacy branch-scoped editor', async () => {
    const repository = userRepository([learner({ roles: [{ role: 'editor', branchId: 'vinsmc' }] })]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await service.setRole(admin, 'learner-1', { role: 'editor', branchId: 'vinsmc', enabled: false });

    expect(repository.mutations).toEqual(['revoke:editor:vinsmc:admin-1']);
  });

  it('denies editors all user role changes', async () => {
    const repository = userRepository([learner()]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.setRole(editor, 'learner-1', { role: 'contributor', branchId: 'vinsmc', enabled: true })).rejects.toMatchObject({ status: 403 });
    expect(repository.mutations).toEqual([]);
  });

  it('does not write or audit an idempotent grant', async () => {
    const audit = vi.fn(async () => undefined);
    const repository = userRepository([learner({ roles: [{ role: 'instructor', branchId: 'vinsmc' }] })]);
    const service = createAdminUsersService({ repository, audit });

    await service.setRole(lead, 'learner-1', { role: 'instructor', branchId: 'vinsmc', enabled: true });

    expect(repository.mutations).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('branch assignment scope', () => {
  it('requires safe search text with at least three characters', () => {
    expect(UserSearchSchema.safeParse({ query: 'ab', page: 1, pageSize: 20 }).success).toBe(false);
    expect(UserSearchSchema.safeParse({ query: 'learner', page: 1, pageSize: 20 }).success).toBe(true);
    expect(UserSearchSchema.safeParse({ query: 'learner),branch_id.not.is.null', page: 1, pageSize: 20 }).success).toBe(false);
  });

  it('lets a branch lead discover unassigned learners they are allowed to place in their branch', async () => {
    const repository = userRepository([learner({ branchId: null })]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.search(lead, {
      query: 'learner', branchId: 'vinsmc', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'learner-1', branchId: null })] });
  });

  it('rejects searches when the per-actor token bucket is empty', async () => {
    const search = vi.fn();
    const repository = {
      ...userRepository([]),
      search,
      async consumeSearchToken() { return { allowed: false, retryAfterSeconds: 2 }; },
    };
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.search(lead, {
      query: 'learner', branchId: 'vinsmc', page: 1, pageSize: 20,
    })).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(search).not.toHaveBeenCalled();
  });

  it('audits branch-lead exact-email lookups without storing the address', async () => {
    const audit = vi.fn(async () => undefined);
    const repository = userRepository([learner({ branchId: null })]);
    const service = createAdminUsersService({ repository, audit });

    await service.search(lead, {
      query: 'learner@example.com', branchId: 'vinsmc', page: 1, pageSize: 20,
    });

    expect(audit).toHaveBeenCalledWith(
      lead,
      'user.exact_email_lookup',
      { type: 'branch', id: 'vinsmc' },
      null,
      { queryLength: 19 },
    );
  });

  it('does not enumerate or assign privileged unassigned accounts through a branch-scoped workflow', async () => {
    const privileged = learner({
      id: 'global-editor',
      branchId: null,
      roles: [{ role: 'editor', branchId: null }],
    });
    const repository = userRepository([privileged]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.search(lead, {
      query: '', branchId: 'vinsmc', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ items: [] });
    await expect(service.search(lead, {
      query: 'learner@example.com', branchId: 'vinsmc', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ items: [] });
    await expect(service.assignBranch(lead, 'global-editor', 'vinsmc')).rejects.toMatchObject({ status: 403 });
    expect(repository.mutations).toEqual([]);
  });

  it('lets a branch lead assign an unassigned learner into their own branch and audits with the actor', async () => {
    const audit = vi.fn(async () => undefined);
    const repository = userRepository([learner({ branchId: null })]);
    const service = createAdminUsersService({ repository, audit });

    await service.assignBranch(lead, 'learner-1', 'vinsmc');

    expect(repository.mutations).toEqual(['branch:learner-1:vinsmc:lead-1']);
    expect(audit).not.toHaveBeenCalled();
  });

  it('prevents a branch lead from claiming a learner in another branch or moving one away', async () => {
    const repository = userRepository([learner({ branchId: 'ans' })]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await expect(service.assignBranch(lead, 'learner-1', 'vinsmc')).rejects.toMatchObject({ status: 403 });
    await expect(service.assignBranch(lead, 'learner-1', null)).rejects.toMatchObject({ status: 403 });
    expect(repository.mutations).toEqual([]);
  });

  it('allows a global admin to move or unassign a learner', async () => {
    const repository = userRepository([learner({ branchId: 'ans' })]);
    const service = createAdminUsersService({ repository, audit: vi.fn(async () => undefined) });

    await service.assignBranch(admin, 'learner-1', 'vinsmc');
    await service.assignBranch(admin, 'learner-1', null);

    expect(repository.mutations).toEqual(['branch:learner-1:vinsmc:admin-1', 'branch:learner-1:null:admin-1']);
  });
});
