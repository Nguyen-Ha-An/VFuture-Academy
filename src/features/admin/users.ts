import 'server-only';

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiError } from '@/lib/api';
import type { AuditTarget } from '@/lib/audit';
import { hasPermission, type Actor, type Role } from '@/lib/permissions';

export type ManagedRole = { role: Role; branchId: string | null };

export type AdminUser = {
  id: string;
  email: string;
  handle: string | null;
  displayName: string;
  branchId: string | null;
  roles: ManagedRole[];
};

export type UserSearchInput = {
  query: string;
  branchId?: string;
  includeUnassigned?: boolean;
  page: number;
  pageSize: number;
};

export type UserSearchResult = {
  items: AdminUser[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export const UserSearchSchema = z.object({
  query: z.string().trim().min(3).max(160).regex(/^[\p{L}\p{N}@._+\-\s]+$/u),
  branchId: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const BranchAssignmentSchema = z.object({
  branchId: z.string().trim().min(1).max(64).nullable(),
}).strict();

export const RoleMutationSchema = z.object({
  role: z.enum(['contributor', 'editor', 'instructor', 'branch_lead', 'admin']),
  branchId: z.string().trim().min(1).max(64).nullable(),
  enabled: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.enabled && value.branchId !== null && ['contributor', 'editor'].includes(value.role)) {
    context.addIssue({
      code: 'custom',
      path: ['branchId'],
      message: 'Contributor and editor roles require Global scope',
    });
  }
});

export type RoleMutation = z.output<typeof RoleMutationSchema>;

export interface AdminUserRepository {
  consumeSearchToken(actorId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  search(input: UserSearchInput): Promise<UserSearchResult>;
  get(id: string): Promise<AdminUser | null>;
  updateBranch(id: string, branchId: string | null, actorId: string): Promise<void>;
  setRole(userId: string, role: ManagedRole, enabled: boolean, actorId: string): Promise<void>;
}

type AuditWriter = (
  actor: Actor,
  action: string,
  target: AuditTarget,
  before: unknown,
  after: unknown,
) => Promise<void>;

type ProfileRow = {
  id: string;
  handle: string | null;
  display_name: string;
  branch_id: string | null;
};

type RoleRow = { user_id: string; role: Role; branch_id: string | null };
type EmailRow = { id: string; email: string };
type ExactUserRow = ProfileRow & { email: string };
type RateLimitRow = { allowed: boolean; retry_after_seconds: number | string };

function failDatabase(message: string): never {
  throw new Error(message);
}

function rolesByUser(rows: RoleRow[]) {
  const result = new Map<string, ManagedRole[]>();
  for (const row of rows) {
    const values = result.get(row.user_id) ?? [];
    values.push({ role: row.role, branchId: row.branch_id });
    result.set(row.user_id, values);
  }
  return result;
}

function assembleUser(authUser: User, profile: ProfileRow, roles: Map<string, ManagedRole[]>): AdminUser {
  return {
    id: authUser.id,
    email: authUser.email ?? '',
    handle: profile.handle,
    displayName: profile.display_name,
    branchId: profile.branch_id,
    roles: roles.get(authUser.id) ?? [],
  };
}

function assembleSqlUser(
  profile: ProfileRow,
  email: string,
  roles: Map<string, ManagedRole[]>,
): AdminUser {
  return {
    id: profile.id,
    email,
    handle: profile.handle,
    displayName: profile.display_name,
    branchId: profile.branch_id,
    roles: roles.get(profile.id) ?? [],
  };
}

function isExactEmail(query: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
}

/** Applies branch visibility while allowing exact, role-less unassigned learner lookup. */
export function matchesUserSearch(user: AdminUser, input: UserSearchInput): boolean {
  const query = input.query.toLocaleLowerCase('en-US');
  const email = user.email.toLocaleLowerCase('en-US');
  const handle = user.handle?.toLocaleLowerCase('en-US') ?? null;
  const displayName = user.displayName.toLocaleLowerCase('en-US');
  const partialMatch = email.includes(query) || (handle?.includes(query) ?? false) || displayName.includes(query);
  if (!input.branchId) return partialMatch;
  if (user.branchId === input.branchId) return partialMatch;
  const exactUnassignedMatch = query.length > 0 && (email === query || handle === query);
  return Boolean(
    input.includeUnassigned
    && user.branchId === null
    && user.roles.length === 0
    && exactUnassignedMatch,
  );
}

async function loadProfilesAndRoles(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return { profiles: new Map<string, ProfileRow>(), roles: new Map<string, ManagedRole[]>() };
  const [profileResult, roleResult] = await Promise.all([
    client.from('profiles').select('id, handle, display_name, branch_id').in('id', ids),
    client.from('user_roles').select('user_id, role, branch_id').in('user_id', ids),
  ]);
  if (profileResult.error || roleResult.error) failDatabase('Unable to load managed users');
  return {
    profiles: new Map(((profileResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])),
    roles: rolesByUser((roleResult.data ?? []) as RoleRow[]),
  };
}

async function loadRoles(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, ManagedRole[]>();
  const { data, error } = await client.from('user_roles').select('user_id, role, branch_id').in('user_id', ids);
  if (error) failDatabase('Unable to load managed user roles');
  return rolesByUser((data ?? []) as RoleRow[]);
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === 'object' ? value as T : null;
}

function mutationError(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return;
  if (error.code === 'P0001' && error.message?.includes('cannot revoke final global admin')) {
    throw new ApiError(409, 'LAST_ADMIN', 'The final global admin cannot be revoked');
  }
  failDatabase(fallback);
}

export function createSupabaseAdminUserRepository(client: SupabaseClient): AdminUserRepository {
  return {
    async consumeSearchToken(actorId) {
      const { data, error } = await client.rpc('admin_consume_user_search_token', { p_actor_id: actorId });
      if (error) failDatabase('Unable to apply user search rate limit');
      const row = firstRow<RateLimitRow>(data);
      if (!row) failDatabase('Unable to apply user search rate limit');
      return { allowed: row.allowed, retryAfterSeconds: Number(row.retry_after_seconds) };
    },
    async search(input) {
      const normalizedQuery = input.query.toLocaleLowerCase('en-US');
      const pageSize = Math.min(input.pageSize, 50);
      const page = Math.max(input.page, 1);

      if (isExactEmail(normalizedQuery)) {
        if (page > 1) return { items: [], page, pageSize, hasMore: false };
        const { data, error } = await client.rpc('admin_find_user_by_email', { p_email: normalizedQuery });
        if (error) failDatabase('Unable to search users');
        const row = firstRow<ExactUserRow>(data);
        if (!row) return { items: [], page, pageSize, hasMore: false };
        const roles = await loadRoles(client, [row.id]);
        const user = assembleSqlUser(row, row.email, roles);
        const items = matchesUserSearch(user, { ...input, query: normalizedQuery }) ? [user] : [];
        return { items, page, pageSize, hasMore: false };
      }

      const start = (page - 1) * pageSize;
      let query = client
        .from('profiles')
        .select('id, handle, display_name, branch_id')
        .or(`handle.ilike.%${normalizedQuery}%,display_name.ilike.%${normalizedQuery}%`);
      if (input.branchId) {
        query = query.or(
          `branch_id.eq.${input.branchId},and(branch_id.is.null,handle.eq.${normalizedQuery})`,
        );
      }
      const { data, error } = await query
        .order('display_name', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + pageSize);
      if (error) failDatabase('Unable to search users');
      const rows = (data ?? []) as ProfileRow[];
      const hasMore = rows.length > pageSize;
      const profiles = rows.slice(0, pageSize);
      const ids = profiles.map((profile) => profile.id);
      const [{ data: emailData, error: emailError }, roles] = await Promise.all([
        client.rpc('admin_user_emails', { p_user_ids: ids }),
        loadRoles(client, ids),
      ]);
      if (emailError) failDatabase('Unable to load managed user emails');
      const emails = new Map(((emailData ?? []) as EmailRow[]).map((row) => [row.id, row.email]));
      const items = profiles
        .map((profile) => assembleSqlUser(profile, emails.get(profile.id) ?? '', roles))
        .filter((user) => matchesUserSearch(user, { ...input, query: normalizedQuery }));
      return {
        items,
        page,
        pageSize,
        hasMore,
      };
    },
    async get(id) {
      const [{ data: authData, error: authError }, { profiles, roles }] = await Promise.all([
        client.auth.admin.getUserById(id),
        loadProfilesAndRoles(client, [id]),
      ]);
      if (authError) {
        if (authError.status === 404) return null;
        failDatabase('Unable to load managed user');
      }
      const profile = profiles.get(id);
      return authData.user && profile ? assembleUser(authData.user, profile, roles) : null;
    },
    async updateBranch(id, branchId, actorId) {
      const { error } = await client.rpc('admin_apply_mutation', {
        p_operation: 'user.branch.assign',
        p_actor_id: actorId,
        p_target_id: id,
        p_payload: { branchId },
      });
      mutationError(error, 'Unable to assign branch');
    },
    async setRole(userId, role, enabled, actorId) {
      const { error } = await client.rpc('admin_apply_mutation', {
        p_operation: 'user.role.set',
        p_actor_id: actorId,
        p_target_id: userId,
        p_payload: { role: role.role, branchId: role.branchId, enabled },
      });
      mutationError(error, 'Unable to update role');
    },
  };
}

function isSameRole(left: ManagedRole, right: ManagedRole) {
  return left.role === right.role && left.branchId === right.branchId;
}

function assertCanSearch(actor: Actor, branchId?: string) {
  const allowed = branchId
    ? hasPermission(actor, 'user.manage.branch', { branchId })
    : hasPermission(actor, 'user.manage.global');
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
}

function assertPotentialRoleManager(actor: Actor, mutation: RoleMutation) {
  if (hasPermission(actor, 'user.manage.global')) return 'global' as const;
  if (!mutation.branchId
    || (mutation.enabled ? mutation.role !== 'instructor' : !['instructor', 'contributor'].includes(mutation.role))
    || !hasPermission(actor, 'user.manage.branch', { branchId: mutation.branchId })) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  return 'branch' as const;
}

export function createAdminUsersService(dependencies: { repository: AdminUserRepository; audit: AuditWriter }) {
  const { repository, audit } = dependencies;
  return {
    async search(actor: Actor, input: UserSearchInput) {
      assertCanSearch(actor, input.branchId);
      const rateLimit = await repository.consumeSearchToken(actor.userId);
      if (!rateLimit.allowed) {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many user searches');
      }
      if (input.branchId && !hasPermission(actor, 'user.manage.global') && isExactEmail(input.query)) {
        await audit(
          actor,
          'user.exact_email_lookup',
          { type: 'branch', id: input.branchId },
          null,
          { queryLength: input.query.length },
        );
      }
      return repository.search({
        ...input,
        includeUnassigned: Boolean(input.branchId && !hasPermission(actor, 'user.manage.global')),
      });
    },
    async assignBranch(actor: Actor, userId: string, branchId: string | null) {
      const global = hasPermission(actor, 'user.manage.global');
      if (!global && (!branchId || !hasPermission(actor, 'user.manage.branch', { branchId }))) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      const before = await repository.get(userId);
      if (!before) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
      if (!global && before.branchId === null && before.roles.length > 0) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      if (!global && before.branchId !== null && before.branchId !== branchId) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      if (before.branchId === branchId) return before;
      await repository.updateBranch(userId, branchId, actor.userId);
      const after = await repository.get(userId);
      if (!after) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
      return after;
    },
    async setRole(actor: Actor, userId: string, mutation: RoleMutation) {
      const managerScope = assertPotentialRoleManager(actor, mutation);
      if (mutation.enabled && mutation.branchId !== null && ['contributor', 'editor'].includes(mutation.role)) {
        throw new ApiError(400, 'INVALID_ROLE_SCOPE', 'Contributor and editor roles require Global scope');
      }
      const before = await repository.get(userId);
      if (!before) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
      if (managerScope === 'branch' && before.branchId !== mutation.branchId) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      const role = { role: mutation.role, branchId: mutation.branchId } satisfies ManagedRole;
      const present = before.roles.some((candidate) => isSameRole(candidate, role));
      if (present === mutation.enabled) return before;
      await repository.setRole(userId, role, mutation.enabled, actor.userId);
      const after = await repository.get(userId);
      if (!after) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
      return after;
    },
  };
}
