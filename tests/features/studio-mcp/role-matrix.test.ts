import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createStudioServer } from '@/features/studio-mcp/server';
import { BUILT_IN_ROLE_PERMISSIONS, ROLE_PERMISSIONS, type Actor, type Permission, type Scope } from '@/lib/permissions';

const userId = '51bda642-e203-42e2-9f6e-fb0b2f5c4c77';
const readTools = ['whoami', 'list_courses', 'get_course_outline', 'get_item', 'get_authoring_schema', 'get_authoring_guide'];
const allTools = [...readTools, 'validate_item', 'prepare_import', 'verify_import'];

function liveActor(assignments: Array<{ name: string; scope: Scope; permissions: readonly Permission[] }>, membership: 'active' | 'suspended' = 'active'): Actor {
  return {
    userId, roles: [], authorization: {
      source: 'database', accountStatus: 'active',
      memberships: [{ branchId: 'branch-b', status: membership }],
      assignments: assignments.map(({ name, scope, permissions }) => ({ roleDefinitionId: name, scope, permissions: [...permissions] })),
    },
  };
}

const central: Scope = { kind: 'central' };
const branch: Scope = { kind: 'branch', branchId: 'branch-b' };
const role = (name: string, scope: Scope, permissions: readonly Permission[]) => ({ name, scope, permissions });

async function toolNames(actor: Actor): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createStudioServer({
    db: {} as never, userId, clientId: 'client-a', correlationId: 'correlation-a',
    registeredToolNames: [], resourceOrigin: 'https://academy.example',
  }, actor);
  const client = new Client({ name: 'role-matrix-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try { return (await client.listTools()).tools.map((tool) => tool.name); }
  finally { await Promise.all([client.close(), server.close()]); }
}

describe('live permission-key role matrix', () => {
  const cases: Array<[string, Actor, string[]]> = [
    ['central admin', liveActor([role('central_admin', central, BUILT_IN_ROLE_PERMISSIONS.central_admin)]), allTools],
    ['central editor', liveActor([role('central_editor', central, BUILT_IN_ROLE_PERMISSIONS.central_editor)]), allTools],
    ['legacy central editor', liveActor([role('legacy_editor_central', central, ROLE_PERMISSIONS.editor)]), allTools],
    ['school editor', liveActor([role('school_editor', branch, BUILT_IN_ROLE_PERMISSIONS.school_editor)]), allTools],
    ['central reviewer', liveActor([role('central_reviewer', central, BUILT_IN_ROLE_PERMISSIONS.central_reviewer)]), readTools],
    ['legacy central instructor', liveActor([role('legacy_instructor_central', central, ROLE_PERMISSIONS.instructor)]), readTools],
    ['legacy central branch lead', liveActor([role('legacy_branch_lead_central', central, ROLE_PERMISSIONS.branch_lead)]), readTools],
    ['mixed central reviewer and branch editor', liveActor([
      role('central_reviewer', central, BUILT_IN_ROLE_PERMISSIONS.central_reviewer),
      role('school_editor', branch, BUILT_IN_ROLE_PERMISSIONS.school_editor),
    ]), allTools],
    ['school admin', liveActor([role('school_admin', branch, BUILT_IN_ROLE_PERMISSIONS.school_admin)]), ['whoami']],
    ['teacher', liveActor([role('teacher', branch, BUILT_IN_ROLE_PERMISSIONS.teacher)]), ['whoami']],
    ['member', liveActor([role('member', branch, BUILT_IN_ROLE_PERMISSIONS.member)]), ['whoami']],
    ['suspended school membership', liveActor([role('school_editor', branch, BUILT_IN_ROLE_PERMISSIONS.school_editor)], 'suspended'), ['whoami']],
  ];

  it.each(cases)('%s', async (_name, actor, expected) => {
    expect(await toolNames(actor)).toEqual(expected);
  });
});
