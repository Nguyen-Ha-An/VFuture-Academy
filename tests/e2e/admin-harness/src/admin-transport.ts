/** Local UI transport only. This is not a substitute for production authorization/SQL tests. */
import type { Branch } from '@/features/admin/branches';
import type { ManagedInvitation, ManagedRoleDefinition, MemberDetail, MemberSummary } from '@/features/admin/management-contracts';
import { InvitationSchema, MemberMutationSchema, RoleDefinitionSchema, RoleUpdateSchema } from '@/features/admin/management-schemas';
import { CENTRAL_ONLY_PERMISSIONS, type Permission } from '@/lib/authorization';
import { scopeKey, type AdminScope } from '@/lib/admin-scope';

export const FIXTURE_ACTOR_ID = '00000000-0000-4000-8000-000000000901';
const memberNames = ['Nguyễn Minh Anh', 'Trần Gia Bảo', 'Lê Thu Hà', 'Phạm Quốc Huy', 'Hoàng Ngọc Diệp', 'Vũ Đức Thắng', 'Đặng Thảo Vy', 'Bùi Khánh Linh', 'Đỗ Hải Nam', 'Ngô Phương Thảo', 'Dương Tuấn Kiệt', 'Lý Mỹ Duyên', 'Hồ Thanh Tùng', 'Mai Anh Thư', 'Trịnh Công Sơn', 'Phan Bảo Ngọc', 'Tạ Minh Khôi', 'Cao Thùy Linh', 'Lương Gia Huy', 'Châu Ngọc Hân', 'Tôn Nữ Minh Châu', 'Kiều Trọng Nghĩa', 'Quách Thảo Nguyên', 'Âu Dương Phong', 'Lâm Khánh Chi', 'Giang Hải Yến'];
export const FIXTURE_PEOPLE: Array<[string, string, string]> = memberNames.map((name, index) => [
  `00000000-0000-4000-8000-${String(index < 3 ? 101 + index : 201 + index - 3).padStart(12, '0')}`, name,
  index < 3 ? ['minh.anh@example.test', 'gia.bao@example.test', 'thu.ha@example.test'][index] : `hoc.vien${index - 2}@example.test`,
]);
export const FIXTURE_SCHOOLS: Branch[] = [
  { id: 'ans', name: 'ANS · Hà Nội', city: 'Hà Nội', createdAt: '2025-08-01T00:00:00Z' },
  { id: 'dewey', name: 'Dewey · Cầu Giấy', city: 'Hà Nội', createdAt: '2025-09-12T00:00:00Z' },
  { id: 'lqd', name: 'Lê Quý Đôn · Đà Nẵng', city: 'Đà Nẵng', createdAt: '2025-10-03T00:00:00Z' },
  { id: 'ntmk', name: 'Nguyễn Thị Minh Khai · TP.HCM', city: 'TP. Hồ Chí Minh', createdAt: '2026-01-15T00:00:00Z' },
  { id: 'hue', name: 'Quốc Học · Huế', city: 'Huế', createdAt: '2026-03-02T00:00:00Z' },
  { id: 'can-tho', name: 'Châu Văn Liêm · Cần Thơ', city: null, createdAt: '2026-06-20T00:00:00Z' },
];
export type FixtureRequest = { path: string; method: string; scope: string | null; body: Record<string, unknown> };
export type FixtureReadModel = { members: MemberSummary[]; schools: Branch[]; roles: ManagedRoleDefinition[]; invitations: ManagedInvitation[] };
declare global { interface Window { __adminFixture: { requests: FixtureRequest[]; releaseBusy: () => void; readModel: (scope?: AdminScope) => FixtureReadModel } } }

const success = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'Content-Type': 'application/json' } });

type AccountState = { userId: string; status: 'active' | 'disabled' | 'deleted'; operation: { id: string; action: string } | null };
type PendingOperation = { userId: string; action: string; body: Record<string, unknown> };
type StoredFixture = FixtureReadModel & { schema: 1; accounts: Array<[string, AccountState]>; completed: Array<[string, string]>; pending: Array<[string, PendingOperation]>; history: NonNullable<MemberDetail['history']>; migrated: boolean; nextId: number; revisionConflict: boolean; conflictOccurred: boolean; failingOnce: string | null };
export function createAdminTransport({ members, roles, getScope, getPermissions, azure, search }: {
  members: MemberSummary[]; roles: ManagedRoleDefinition[]; getScope: () => AdminScope;
  getPermissions: () => readonly Permission[]; azure: boolean; search: URLSearchParams;
}) {
  const scenario = search.get('scenario') ?? 'dense';
  const storageKey = `academy-admin-synthetic-v1:${azure ? 'azure' : 'legacy'}:${scenario}`;
  let stored: StoredFixture | undefined;
  try {
    if (search.get('reset') === '1') { sessionStorage.removeItem(storageKey); search.delete('reset'); const url = new URL(location.href); url.searchParams.delete('reset'); history.replaceState(history.state, '', url); }
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as StoredFixture | null;
    if (parsed?.schema === 1 && Array.isArray(parsed.members) && Array.isArray(parsed.roles) && Array.isArray(parsed.schools) && Array.isArray(parsed.invitations)) stored = parsed;
  } catch { /* Private/blocked storage keeps the same explicitly synthetic in-memory fixture. */ }
  if (stored) { members.splice(0, members.length, ...stored.members); roles.splice(0, roles.length, ...stored.roles); }
  const schools = stored?.schools ?? structuredClone(FIXTURE_SCHOOLS);
  const requests: FixtureRequest[] = [];
  const waiters: Array<() => void> = [];
  const accounts = new Map<string, AccountState>(stored?.accounts ?? []);
  const completedOperations = new Map<string, string>(stored?.completed ?? []);
  const pendingOperations = new Map<string, PendingOperation>(stored?.pending ?? []);
  let failingOnce = stored ? stored.failingOnce : search.get('failOnce');
  let migrated = stored?.migrated ?? false;
  let nextId = stored?.nextId ?? 700;
  let revisionConflict = stored?.revisionConflict ?? scenario === 'revision-conflict';
  let conflictOccurred = stored?.conflictOccurred ?? false;
  const invitations: ManagedInvitation[] = stored?.invitations ?? (scenario === 'empty' ? [] : [
    { id: '00000000-0000-4000-8000-000000000301', email: 'thao.nguyen@example.test', branchId: 'ans', roleId: 'teacher', status: 'pending', createdAt: '2026-09-20T08:00:00Z', expiresAt: '2026-09-27T08:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000302', email: 'quang.le@example.test', branchId: 'ans', roleId: null, status: 'expired', createdAt: '2026-09-01T08:00:00Z', expiresAt: '2026-09-08T08:00:00Z' },
  ]);
  const allowed = (permission: Permission) => getPermissions().includes(permission) && scenario !== 'read-only';
  const canAdminAccounts = () => azure && getScope().kind === 'central' && allowed('admin.access') && allowed('member.manage');
  const inScope = (member: MemberSummary) => {
    const scope = getScope();
    return scope.kind === 'central' || member.memberships.some((membership) => membership.branchId === scope.branchId);
  };
  const memberHistory: NonNullable<MemberDetail['history']> = stored?.history ?? [];
  const readModel = (scope?: AdminScope): FixtureReadModel => ({ members: (scenario === 'empty' ? [] : scenario === 'sparse' ? members.slice(0, 2) : members).filter((member) => !scope || scope.kind === 'central' || member.memberships.some((membership) => membership.branchId === scope.branchId)), schools: schools.filter((school) => !scope || scope.kind === 'central' || school.id === scope.branchId), roles, invitations: invitations.filter((invitation) => !scope || scope.kind === 'central' || invitation.branchId === scope.branchId) });
  window.__adminFixture = { requests, releaseBusy: () => waiters.splice(0).forEach((resolve) => resolve()), readModel };
  const persist = () => {
    for (const role of roles) role.assignmentCount = members.reduce((count, member) => count + member.assignments.filter((assignment) => assignment.roleId === role.id).length, 0);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ schema: 1, members, schools, roles, invitations, accounts: [...accounts], completed: [...completedOperations], pending: [...pendingOperations], history: memberHistory, migrated, nextId, revisionConflict, conflictOccurred, failingOnce } satisfies StoredFixture)); } catch { /* This fixture never falls back to live storage or APIs. */ }
  };
  persist();
  const stateOf = (id: string): AccountState => {
    if (!accounts.has(id)) accounts.set(id, { userId: id, status: 'active', operation: scenario === 'pending' ? { id: '00000000-0000-4000-8000-000000000801', action: 'disable' } : null });
    return accounts.get(id)!;
  };
  const detail = (member: MemberSummary): MemberDetail => {
    const central = getScope().kind === 'central';
    const readLearning = getPermissions().includes('learning.read');
    const readSubmissions = getPermissions().includes('grading.read');
    const readHistory = getPermissions().includes('audit.read');
    return { ...member,
      effectivePermissions: member.assignments.map((assignment) => ({ scope: assignment.scope, permissions: roles.find((role) => role.id === assignment.roleId)?.permissions ?? [] })),
      actors: { [FIXTURE_ACTOR_ID]: { name: 'Nguyễn Thị Thanh Hương', initials: 'TH', avatarUrl: null } },
      actions: { editIdentity: central && allowed('member.manage'), transfer: central && allowed('membership.manage'), suspendAccount: central && allowed('member.manage'), manageMembership: allowed('membership.manage'), assignRole: allowed('role.assignment.branch') || central && allowed('role.assignment.global'), readLearning, readSubmissions, readHistory },
      ...(readLearning ? { learning: scenario === 'empty' ? [] : [{ courseId: 'python-foundations', courseVersionId: 'version-2026-09', title: 'Python cơ bản', displayTitle: 'Python cơ bản / Python foundations', status: 'active', completedLessons: 3, totalLessons: 8, branchId: 'ans' }] } : {}),
      ...(readSubmissions ? { submissions: scenario === 'empty' ? [] : [{ id: 'submission-1', courseVersionId: 'version-2026-09', itemId: 'project:code-review', displayTitle: 'Nhận xét mã nguồn / Code review', status: 'approved', submittedAt: '2026-10-19T08:00:00Z', branchId: 'ans', percent: 87.5 }], examResults: [] } : {}),
      ...(readHistory ? { history: memberHistory.filter((entry) => entry.targetId === member.id) } : {}),
    };
  };

  return async function transport(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
    const url = new URL(String(input), location.origin);
    const method = init?.method ?? 'GET';
    const recognized = /^\/api\/v1\/admin\/(options|roles|users|invitations|accounts)(\/|$)/.test(url.pathname)
      || /^\/api\/v1\/studio\/branches(\/|$)/.test(url.pathname)
      || /^\/api\/v1\/studio\/courses\/[^/]+\/enrollments\/migrate$/.test(url.pathname);
    if (!recognized) return undefined;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const ok = (data: unknown, status = 200) => { persist(); return success(data, status); };
    requests.push({ path: url.pathname, method, scope: url.searchParams.get('scope'), body });
    const scope = getScope();
    const sentScope = url.searchParams.get('scope');
    if (sentScope && sentScope !== scopeKey(scope)) return failure(409, 'SCOPE_MISMATCH', 'The management scope changed. Reload this page.');
    if (url.searchParams.has('actorId') && url.searchParams.get('actorId') !== FIXTURE_ACTOR_ID) return failure(409, 'ACTOR_MISMATCH', 'The signed-in fixture operator changed.');
    const area = url.pathname.includes('/accounts') ? 'accounts' : url.pathname.includes('/roles') ? 'roles' : url.pathname.includes('/branches') ? 'schools' : url.pathname.includes('/migrate') ? 'migration' : url.pathname.includes('/options') ? 'options' : url.pathname.includes('/invitations') ? 'invitations' : 'members';
    const failureKeys = [area, ...(method !== 'GET' ? [`${area}-write`] : [])];
    if (search.get('busy') === area) await new Promise<void>((resolve) => waiters.push(resolve));
    if (failureKeys.includes(search.get('fail') ?? '') || failureKeys.includes(failingOnce ?? '')) {
      failingOnce = null;
      if (area === 'accounts' && method === 'POST' && typeof body.operationId === 'string') {
        const id = url.pathname.split('/')[5] ?? `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
        pendingOperations.set(body.operationId, { userId: id, action: String(body.action), body });
        stateOf(id).operation = { id: body.operationId, action: String(body.action) };
      }
      persist();
      return failure(503, 'FIXTURE_FAILURE', 'The requested fixture operation could not finish. Retry the same operation.');
    }
    if (url.pathname.endsWith('/options')) return ok({ scope,
      azureAccountAdmin: canAdminAccounts(), branches: scope.kind === 'central' ? schools : schools.filter((school) => school.id === scope.branchId),
      roles: roles.filter((role) => scope.kind === 'central' || role.grantableBySchool),
      permissions: scenario === 'read-only' ? getPermissions().filter((permission) => /\.read$/.test(permission)) : getPermissions(),
    });
    if (url.pathname.includes('/accounts')) {
      if (!canAdminAccounts()) return failure(403, 'FORBIDDEN', 'Central member management permission required');
      const userId = url.pathname.split('/')[5];
      if (method === 'GET' && userId) return ok(stateOf(userId));
      const action = String(body.action);
      const operationId = String(body.operationId ?? '');
      if (!operationId) return failure(400, 'INVALID_OPERATION', 'An operation id is required.');
      if (userId === FIXTURE_ACTOR_ID && ['disable', 'delete'].includes(action)) return failure(409, 'SELF_PROTECTED', 'You cannot disable or delete your own account');
      if (action === 'delete' && body.confirmation !== 'DELETE LOGIN') return failure(400, 'CONFIRMATION_REQUIRED', 'Type DELETE LOGIN to confirm.');
      const pendingOperation = pendingOperations.get(operationId);
      const id = userId ?? completedOperations.get(operationId) ?? pendingOperation?.userId ?? `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
      const account = stateOf(id);
      if (completedOperations.has(operationId)) return ok(account);
      if (action === 'retry' && account.operation && account.operation.id !== operationId) return failure(409, 'OPERATION_MISMATCH', 'Retry the pending operation without replacing its id.');
      const resolvedAction = action === 'retry' ? pendingOperation?.action ?? account.operation?.action : action;
      const values = pendingOperation?.body ?? body;
      if (resolvedAction === 'create' && (typeof values.displayName !== 'string' || !values.displayName.trim() || typeof values.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))) return failure(400, 'INVALID_ACCOUNT', 'A display name and valid email are required.');
      if (resolvedAction === 'disable') account.status = 'disabled';
      else if (resolvedAction === 'enable' || resolvedAction === 'create') account.status = 'active';
      else if (resolvedAction === 'delete') account.status = 'deleted';
      else if (resolvedAction === 'edit') {
        const member = members.find((entry) => entry.id === id);
        if (member && typeof values.displayName === 'string') member.displayName = values.displayName;
      } else return failure(400, 'INVALID_OPERATION', 'The fixture does not support that account operation.');
      if (resolvedAction === 'create' && !members.some((member) => member.id === id)) {
        members.unshift({ id, displayName: String(values.displayName ?? ''), email: String(values.email ?? ''), handle: null, branchId: null, accountStatus: 'active', createdAt: new Date().toISOString(), memberships: [], assignments: [] });
      }
      account.operation = null; pendingOperations.delete(operationId); completedOperations.set(operationId, id);
      return ok(account);
    }
    if (url.pathname.includes('/studio/branches')) {
      if (scope.kind !== 'central' || !allowed('branch.manage')) return failure(403, 'FORBIDDEN', 'School management is not permitted in this scope.');
      const id = method === 'POST' ? String(body.id ?? '') : url.pathname.split('/').at(-1)!;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || typeof body.name !== 'string' || !body.name.trim()) return failure(400, 'INVALID_BRANCH', 'Provide a school id and name.');
      const existing = schools.find((school) => school.id === id);
      if (method === 'POST' && existing) return failure(409, 'BRANCH_EXISTS', 'This school id already exists.');
      if (method === 'PUT' && !existing) return failure(404, 'NOT_FOUND', 'The school no longer exists.');
      const saved = { id, name: body.name.trim(), city: typeof body.city === 'string' ? body.city : null, createdAt: existing?.createdAt ?? new Date().toISOString() };
      if (existing) Object.assign(existing, saved); else schools.push(saved);
      return ok(saved, method === 'POST' ? 201 : 200);
    }
    if (url.pathname.includes('/enrollments/migrate')) {
      if (!allowed('course.publish')) return failure(403, 'FORBIDDEN', 'Publishing permission is required.');
      if (!['python-foundations', 'ai-foundations'].some((id) => url.pathname.includes(`/${id}/`))) return failure(404, 'NOT_FOUND', 'The course is not represented by this fixture.');
      const result = migrated ? { migrated: [], skipped: [{ userId: members[0]?.id, handle: members[0]?.handle, reason: 'ALREADY_ON_LATEST_VERSION' }] }
        : { migrated: members.slice(0, 2).map((member) => member.id), skipped: [{ userId: members[2]?.id, handle: members[2]?.handle, reason: 'TARGET_PROGRESS_CONFLICT' }] };
      migrated = true; return ok(result);
    }
    if (/\/roles(?:\/[^/]+)?$/.test(url.pathname)) {
      if (method === 'GET') {
        if (conflictOccurred && search.get('fail') === 'role-reload') return failure(503, 'FIXTURE_FAILURE', 'The latest role could not be loaded.');
        return ok(roles.filter((role) => scope.kind === 'central' || role.grantableBySchool));
      }
      if (!allowed('role.definition.manage')) return failure(403, 'FORBIDDEN', 'Role definition management is not permitted.');
      const parsed = method === 'POST' ? RoleDefinitionSchema.safeParse(body) : RoleUpdateSchema.safeParse(body);
      if (!parsed.success) return failure(400, 'INVALID_ROLE', 'The role definition is invalid.');
      const value = parsed.data;
      if (scope.kind === 'branch' && (value.scopeKind === 'central' || value.permissions.some((permission) => CENTRAL_ONLY_PERMISSIONS.includes(permission)))) return failure(403, 'FORBIDDEN', 'Central permissions cannot be granted by a school.');
      if (method === 'POST') {
        const saved = { ...value, permissions: value.permissions as Permission[], id: `custom-role-${++nextId}`, builtIn: false, version: 1, assignmentCount: 0 };
        roles.push(saved); return ok(saved, 201);
      }
      const existing = roles.find((role) => url.pathname.endsWith(`/${role.id}`));
      if (!existing) return failure(404, 'NOT_FOUND', 'This role no longer exists.');
      if (existing.builtIn) return failure(403, 'BUILT_IN_ROLE', 'Built-in roles cannot be edited.');
      if (revisionConflict) { existing.version += 1; existing.name += ' · updated'; existing.permissions = existing.permissions.filter((permission) => permission !== 'learning.read'); revisionConflict = false; conflictOccurred = true; persist(); return failure(409, 'REVISION_CONFLICT', 'The role changed. Reload before saving.'); }
      if (body.version !== existing.version) return failure(409, 'REVISION_CONFLICT', 'The role changed. Reload before saving.');
      Object.assign(existing, value, { version: existing.version + 1 }); return ok(existing);
    }
    if (url.pathname.includes('/invitations')) {
      if (!allowed('membership.manage')) return failure(403, 'FORBIDDEN', 'Invitation management is not permitted.');
      if (method === 'GET') return ok(invitations.filter((invitation) => scope.kind === 'central' || invitation.branchId === scope.branchId));
      if (url.pathname.endsWith('/revoke')) {
        const invitation = invitations.find((entry) => url.pathname.includes(entry.id));
        if (!invitation) return failure(404, 'NOT_FOUND', 'This invitation no longer exists.');
        invitation.status = 'revoked'; return ok({ revoked: true });
      }
      const parsed = InvitationSchema.safeParse(body);
      if (!parsed.success) return failure(400, 'INVALID_INVITATION', 'The invitation is invalid.');
      if (scope.kind === 'branch' && parsed.data.branchId !== scope.branchId) return failure(403, 'FORBIDDEN', 'This school is outside the active scope.');
      const invitation: ManagedInvitation = { ...parsed.data, id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
      invitations.unshift(invitation); return ok({ ...invitation, inviteUrl: `${location.origin}/invite/local-fixture-${nextId}` }, 201);
    }
    const userId = url.pathname.split('/')[5];
    if (userId) {
      const member = members.find((entry) => entry.id === userId);
      if (!member || !inScope(member)) return failure(404, 'NOT_FOUND', 'The member is not available in this scope.');
      if (method === 'PATCH') {
        const parsed = MemberMutationSchema.safeParse(body);
        if (!parsed.success) return failure(400, 'INVALID_MEMBER', 'The member change is invalid.');
        const value = parsed.data;
        const needed: Permission = value.action === 'role' ? value.branchId === null ? 'role.assignment.global' : 'role.assignment.branch' : value.action === 'membership-status' || value.action === 'transfer' ? 'membership.manage' : 'member.manage';
        if (!allowed(needed)) return failure(403, 'FORBIDDEN', 'This member action is not permitted.');
        if (value.action === 'identity') member.displayName = value.displayName;
        if (value.action === 'account-status') member.accountStatus = value.status;
        if (value.action === 'membership-status') {
          const membership = member.memberships.find((entry) => entry.branchId === value.branchId);
          if (!membership || scope.kind === 'branch' && value.branchId !== scope.branchId) return failure(403, 'FORBIDDEN', 'The membership is outside this school.');
          membership.status = value.status;
        }
        if (value.action === 'transfer') {
          if (scope.kind !== 'central') return failure(403, 'FORBIDDEN', 'School transfer requires central management.');
          const school = schools.find((entry) => entry.id === value.branchId);
          member.branchId = value.branchId;
          member.memberships = school ? [{ branchId: school.id, branchName: school.name, status: 'active', isPrimary: true }] : [];
        }
        if (value.action === 'role') {
          const role = roles.find((entry) => entry.id === value.roleId);
          if (!role || scope.kind === 'branch' && (!role.grantableBySchool || value.branchId !== scope.branchId)) return failure(403, 'FORBIDDEN', 'This role cannot be granted in the active school.');
          member.assignments = member.assignments.filter((entry) => entry.roleId !== value.roleId || scopeKey(entry.scope) !== (value.branchId ? `branch:${value.branchId}` : 'central'));
          if (value.enabled) member.assignments.push({ id: `assignment-${++nextId}`, roleId: role.id, roleName: role.name, scope: value.branchId ? { kind: 'branch', branchId: value.branchId } : { kind: 'central' }, grantedAt: new Date().toISOString(), grantedBy: FIXTURE_ACTOR_ID });
        }
        memberHistory.unshift({ id: `history-${++nextId}`, action: `user.${value.action}`, actorId: FIXTURE_ACTOR_ID, targetType: 'user', targetId: member.id, at: new Date().toISOString() });
      }
      return ok(detail(member));
    }
    const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1), pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const visible = scenario === 'empty' ? [] : scenario === 'sparse' ? members.slice(0, 2) : members;
    const matching = visible.filter((member) => inScope(member) && (member.displayName.toLocaleLowerCase().includes(query) || member.email.includes(query))
      && (!url.searchParams.get('status') || member.accountStatus === url.searchParams.get('status'))
      && (!url.searchParams.get('roleId') || member.assignments.some((assignment) => assignment.roleId === url.searchParams.get('roleId')))
      && (!url.searchParams.get('kind') || (member.assignments.some((assignment) => assignment.roleId !== 'member') ? 'staff' : 'learner') === url.searchParams.get('kind')));
    return ok({ items: matching.slice((page - 1) * pageSize, page * pageSize), page, pageSize, hasMore: matching.length > page * pageSize });
  };
}
