import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createStudioServer, serveStudioMcp } from '@/features/studio-mcp/server';
import type { Actor } from '@/lib/permissions';

vi.mock('server-only', () => ({}));

const userId = '51bda642-e203-42e2-9f6e-fb0b2f5c4c77';

function actor(permissions: Array<'course.read' | 'course.edit'>, centralPermissions: Array<'course.read' | 'course.edit'> = []): Actor {
  return { userId, roles: [], authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'branch-b', status: 'active' }],
    assignments: [
      { roleDefinitionId: 'test', scope: { kind: 'branch', branchId: 'branch-b' }, permissions },
      ...(centralPermissions.length ? [{ roleDefinitionId: 'central-test', scope: { kind: 'central' as const }, permissions: centralPermissions }] : []),
    ],
  } };
}

async function listedToolNames(principal: Actor): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createStudioServer({
    db: {} as never, userId, clientId: 'client-1', correlationId: 'correlation-1',
    registeredToolNames: [], resourceOrigin: 'https://academy.example',
  }, principal);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe('Studio MCP registration over the SDK protocol', () => {
  it('lists all nine tools for an editor', async () => {
    expect(await listedToolNames(actor(['course.read', 'course.edit']))).toEqual([
      'whoami', 'list_courses', 'get_course_outline', 'get_item', 'get_authoring_schema',
      'get_authoring_guide', 'validate_item', 'prepare_import', 'verify_import',
    ]);
  });

  it('lists only whoami after course permissions are removed', async () => {
    expect(await listedToolNames(actor([]))).toEqual(['whoami']);
  });

  it('lists only read tools for a reviewer with central read permission', async () => {
    expect(await listedToolNames(actor([], ['course.read']))).toEqual([
      'whoami', 'list_courses', 'get_course_outline', 'get_item', 'get_authoring_schema', 'get_authoring_guide',
    ]);
  });

  it('returns a valid whoami envelope and exact registered tool list over MCP', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const db = { rpc: vi.fn(async (name: string) => ({
      data: name === 'authorization_actor'
        ? { accountStatus: 'active', memberships: [], assignments: [] }
        : true,
      error: null,
    })) };
    const server = createStudioServer({ db: db as never, userId, clientId: 'client-1',
      correlationId: 'correlation-1', registeredToolNames: [], resourceOrigin: 'https://academy.example' }, actor([]));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ userId, clientId: 'client-1', scopes: [], tools: ['whoami'] });
      expect(db.rpc).toHaveBeenCalledWith('authorization_actor', { p_user_id: userId });
      expect(db.rpc).toHaveBeenCalledWith('rate_limit', expect.any(Object));
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('serves a stateless HTTP tools/list exchange through the SDK handler', async () => {
    vi.stubEnv('MCP_RESOURCE_URL', 'https://academy.example/api/mcp');
    const requestBody = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const request = new Request('https://academy.example/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18' },
      body: JSON.stringify(requestBody),
    });
    const principal = {
      token: 'fake-token', verified: { userId, clientId: 'client-1', sessionId: 'session-1', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
      actor: actor([]),
    };
    const response = await serveStudioMcp(request, requestBody, principal, {} as never, 'correlation-1');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('whoami');
    vi.unstubAllEnvs();
  });

  it('keeps simultaneous HTTP registries separate by principal', async () => {
    vi.stubEnv('MCP_RESOURCE_URL', 'https://academy.example/api/mcp');
    const send = async (principal: Actor, id: number) => {
      const requestBody = { jsonrpc: '2.0', id, method: 'tools/list', params: {} };
      const request = new Request('https://academy.example/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18' },
        body: JSON.stringify(requestBody),
      });
      const response = await serveStudioMcp(request, requestBody, {
        token: 'fake-token', verified: { userId: principal.userId, clientId: `client-${id}`, sessionId: `session-${id}`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600 }, actor: principal,
      }, {} as never, `correlation-${id}`);
      return response.text();
    };
    try {
      const [editor, denied] = await Promise.all([send(actor(['course.read', 'course.edit']), 1), send(actor([]), 2)]);
      expect(editor).toContain('prepare_import');
      expect(denied).toContain('whoami');
      expect(denied).not.toContain('prepare_import');
    } finally { vi.unstubAllEnvs(); }
  });
});
