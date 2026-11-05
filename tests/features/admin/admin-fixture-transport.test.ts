// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminTransport, FIXTURE_ACTOR_ID } from '../../e2e/admin-harness/src/admin-transport';
import { BUILT_IN_ROLE_PERMISSIONS } from '@/lib/authorization';
import type { MemberSummary, ManagedRoleDefinition } from '@/features/admin/management-contracts';

beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/admin/users'); });
function boot(query = 'scenario=dense') {
  const members: MemberSummary[] = [{ id: '00000000-0000-4000-8000-000000000101', displayName: 'Fixture learner', email: 'learner@example.test', handle: null, branchId: 'ans', accountStatus: 'active', createdAt: '2026-10-01T00:00:00Z', assignments: [], memberships: [{ branchId: 'ans', branchName: 'ANS', status: 'active', isPrimary: true }] }];
  const roles: ManagedRoleDefinition[] = [{ id: 'mentor', name: 'Mentor', description: '', scopeKind: 'branch', permissions: ['member.read', 'learning.read'], builtIn: false, grantableBySchool: true, version: 3, assignmentCount: 0 }];
  return createAdminTransport({ members, roles, getScope: () => ({ kind: 'central' }), getPermissions: () => BUILT_IN_ROLE_PERMISSIONS.central_admin, azure: true, search: new URLSearchParams(query) });
}
async function call(transport: ReturnType<typeof boot>, path: string, body?: Record<string, unknown>, method = 'POST') {
  const response = await transport(path, body ? { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : undefined);
  expect(response).toBeDefined();
  return { status: response!.status, body: await response!.json() };
}

describe('explicitly synthetic Admin fixture transport continuity', () => {
  it('retains a created school and edited role across a fresh fixture entry', async () => {
    const transport = boot();
    expect((await call(transport, '/api/v1/studio/branches', { id: 'qa-school', name: 'Learning lab', city: 'HCM' })).status).toBe(201);
    const role = { name: 'Reviewed mentor', description: '', scopeKind: 'branch', permissions: ['member.read'], grantableBySchool: true, version: 3 };
    expect((await call(transport, '/api/v1/admin/roles/mentor?scope=central', role, 'PATCH')).status).toBe(200);
    boot();
    const snapshot = window.__adminFixture.readModel();
    expect(snapshot.schools.find((school) => school.id === 'qa-school')?.name).toBe('Learning lab');
    expect(snapshot.roles.find((entry) => entry.id === 'mentor')).toMatchObject({ name: 'Reviewed mentor', version: 4, permissions: ['member.read'] });
  });

  it('persists invitation revocation and scopes counts from the same records', async () => {
    const transport = boot();
    const created = await call(transport, '/api/v1/admin/invitations?scope=central', { email: 'new@example.test', branchId: 'dewey', roleId: null });
    await call(transport, `/api/v1/admin/invitations/${created.body.data.id}/revoke?scope=central`, {});
    boot();
    const school = window.__adminFixture.readModel({ kind: 'branch', branchId: 'dewey' });
    expect(school.members).toHaveLength(0);
    expect(school.invitations.find((entry) => entry.email === 'new@example.test')?.status).toBe('revoked');
    expect(window.__adminFixture.readModel({ kind: 'branch', branchId: 'ans' }).members).toHaveLength(1);
  });

  it('resumes a failed account operation with its original id and creates no duplicate login', async () => {
    const operationId = '00000000-0000-4000-8000-000000000888';
    const failed = await call(boot('scenario=dense&failOnce=accounts-write'), `/api/v1/admin/accounts?scope=central&actorId=${FIXTURE_ACTOR_ID}`, { action: 'create', operationId, displayName: 'Backup learner', email: 'backup@example.test' });
    expect(failed.status).toBe(503);
    const transport = boot('scenario=dense&failOnce=accounts-write');
    const resumed = await call(transport, '/api/v1/admin/accounts?scope=central', { action: 'retry', operationId });
    expect(resumed.status).toBe(200);
    await call(transport, '/api/v1/admin/accounts?scope=central', { action: 'retry', operationId });
    boot();
    expect(window.__adminFixture.readModel().members.filter((entry) => entry.email === 'backup@example.test')).toHaveLength(1);
  });

  it('consumes reset only for the current synthetic namespace', async () => {
    const transport = boot();
    await call(transport, '/api/v1/studio/branches', { id: 'qa-school', name: 'Learning lab', city: null });
    sessionStorage.setItem('unrelated-preference', 'keep');
    history.replaceState(null, '', '/admin/users?scenario=dense&reset=1');
    boot('scenario=dense&reset=1');
    expect(window.__adminFixture.readModel().schools.some((school) => school.id === 'qa-school')).toBe(false);
    expect(new URL(location.href).searchParams.has('reset')).toBe(false);
    expect(sessionStorage.getItem('unrelated-preference')).toBe('keep');
  });
});
