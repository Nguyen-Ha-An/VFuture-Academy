import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  asStudioDatabase,
  McpWriteAttemptError,
  mcpGetDraft,
  wrapReadOnlyDatabase,
} from '@/features/studio-mcp/db/read-only-database';
import { canMcpAuthor, canMcpRead, mcpCapability } from '@/features/studio-mcp/authz/capabilities';
import { validateMcpOrigin } from '@/features/studio-mcp/http/origin';
import { readBoundedJson } from '@/features/studio-mcp/http/handle-request';
import type { Actor } from '@/lib/permissions';
import { ActorResolutionError, getActorForUserId } from '@/lib/permissions';
import { defineStudioTool } from '@/features/studio-mcp/tools/define-tool';
import { z } from 'zod';
import { isAllowedMcpRedirectUri, resetMcpClientCacheForTests, validateMcpClient } from '@/features/studio-mcp/auth/client-allowlist';
import { resetMcpJwksCacheForTests, verifyMcpToken } from '@/features/studio-mcp/auth/verify-token';
import { resolveMcpPrincipal } from '@/features/studio-mcp/auth/principal';
import { mcpResourceUrl, mcpTesterUserIds } from '@/features/studio-mcp/config';
import { logMcpEvent, reportMcpInternalError } from '@/features/studio-mcp/log';
import { mcpErrorPayload, StudioMcpError } from '@/features/studio-mcp/errors';

function fakeQuery() {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    then: vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null }))),
    insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  return query;
}

describe('MCP read-only database', () => {
  it('preserves the Supabase query builder receiver for selected reads', async () => {
    const query = { marker: 'bound', select(this: { marker: string }, _columns: string) {
      if (this.marker !== 'bound') throw new Error('receiver lost');
      return this;
    }, eq(this: { marker: string }, _column: string, _value: unknown) {
      if (this.marker !== 'bound') throw new Error('receiver lost');
      return this;
    }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: [], error: null })); } };
    const client = { from: () => query, rpc: vi.fn(), auth: { admin: { oauth: { getClient: vi.fn() } } } };
    await expect(wrapReadOnlyDatabase(client).from('courses').select('id').eq('id', 'a')).resolves.toMatchObject({ data: [] });
  });

  it('allows selected reads and the four specified RPCs', async () => {
    const query = fakeQuery();
    const client = { from: vi.fn(() => query), rpc: vi.fn(async () => ({ data: true, error: null })), auth: { admin: { oauth: { getClient: vi.fn(async () => ({ data: null, error: null })) } } } };
    const db = wrapReadOnlyDatabase(client);
    await db.from('courses').select('id').eq('id', 'a');
    await db.rpc('cms_assert_content_access', { p_content_id: 'a' });
    expect(client.from).toHaveBeenCalledWith('courses');
    expect(query.select).toHaveBeenCalledWith('id');
    expect(client.rpc).toHaveBeenCalledWith('cms_assert_content_access', { p_content_id: 'a' });
  });

  it('allows the per-user MCP block read while keeping the table read-only', async () => {
    const query = fakeQuery();
    const client = { from: vi.fn(() => query), rpc: vi.fn(), auth: { admin: { oauth: { getClient: vi.fn() } } } };
    const db = wrapReadOnlyDatabase(client);
    await db.from('studio_mcp_access_blocks').select('user_id').eq('user_id', 'user-a');
    expect(client.from).toHaveBeenCalledWith('studio_mcp_access_blocks');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(() => (db.from('studio_mcp_access_blocks').select('user_id') as unknown as { delete: () => unknown }).delete())
      .toThrow(McpWriteAttemptError);
  });

  it('rejects table mutations, unselected queries, and unlisted RPCs before reaching the client', () => {
    const query = fakeQuery();
    const client = { from: vi.fn(() => query), rpc: vi.fn(), auth: { admin: { oauth: { getClient: vi.fn() } } } };
    const db = wrapReadOnlyDatabase(client);
    expect(() => db.from('audit_log')).toThrow(McpWriteAttemptError);
    expect(() => (db.from('courses') as unknown as { insert: (v: unknown) => unknown }).insert({})).toThrow(McpWriteAttemptError);
    expect(() => (db.from('courses').select('id') as unknown as { update: (v: unknown) => unknown }).update({})).toThrow(McpWriteAttemptError);
    expect(() => db.rpc('studio_save_workspace', {})).toThrow(McpWriteAttemptError);
    expect(() => (db as unknown as { storage: unknown }).storage).toThrow(McpWriteAttemptError);
    expect(() => (db.auth.admin.oauth as unknown as { deleteClient: (id: string) => unknown }).deleteClient('client-1')).toThrow(McpWriteAttemptError);
    expect(query.insert).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('keeps the guarded database when adapted for Studio draft reads', async () => {
    const query = fakeQuery();
    const client = { from: vi.fn(() => query), rpc: vi.fn(async () => ({ data: { id: 'draft-1', course_id: 'course-1', manifest: {}, items: {}, updated_at: '2026-01-01T00:00:00Z' }, error: null })), auth: { admin: { oauth: { getClient: vi.fn() } } } };
    const db = wrapReadOnlyDatabase(client);
    const draft = await mcpGetDraft(db, 'course-1');
    expect(draft.id).toBe('draft-1');
    expect(client.rpc).toHaveBeenCalledWith('studio_get_draft_snapshot', { course_id: 'course-1' });
    expect(() => asStudioDatabase(db).from('courses').insert({})).toThrow(McpWriteAttemptError);
  });
});

const branchEditor: Actor = {
  userId: '51bda642-e203-42e2-9f6e-fb0b2f5c4c77', roles: [],
  authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'branch-b', status: 'active' }],
    assignments: [{ roleDefinitionId: 'school_editor', scope: { kind: 'branch', branchId: 'branch-b' }, permissions: ['course.read', 'course.edit'] }],
  },
};

describe('MCP capability calculation', () => {
  it('checks permission in the selected scope, not merely scope membership', () => {
    expect(canMcpRead(branchEditor, { kind: 'central' })).toBe(false);
    expect(canMcpRead(branchEditor, { kind: 'branch', branchId: 'branch-b' })).toBe(true);
    expect(canMcpAuthor(branchEditor, { kind: 'branch', branchId: 'branch-b' })).toBe(true);
    expect(mcpCapability(branchEditor)).toEqual({ read: true, author: true });
  });
});

describe('MCP HTTP guards', () => {
  it('allows absent Origin and rejects any present Origin outside the exact allowlist', () => {
    expect(validateMcpOrigin(null, [])).toBeNull();
    expect(validateMcpOrigin('https://allowed.example', ['https://allowed.example'])).toBe('https://allowed.example');
    expect(() => validateMcpOrigin('https://allowed.example.evil', ['https://allowed.example'])).toThrow();
    expect(() => validateMcpOrigin('null', ['https://allowed.example'])).toThrow();
  });

  it('rejects oversized and deeply nested JSON before parsing into a tool call', async () => {
    const large = new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(3 * 1024 * 1024 + 1) });
    await expect(readBoundedJson(large)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    const deep = new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `${'['.repeat(65)}0${']'.repeat(65)}` });
    await expect(readBoundedJson(deep)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('cancels an oversized streaming body after crossing the cap', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(3 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('https://example.test/api/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    await expect(readBoundedJson(request)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
});

describe('live actor resolution', () => {
  it('distinguishes a missing account from an authorization outage without leaking database details', async () => {
    const missing = { rpc: vi.fn(async () => ({ data: null, error: { code: '23503', message: 'Authorization account is missing' } })) };
    await expect(getActorForUserId(branchEditor.userId, missing)).rejects.toMatchObject({ reason: 'missing_account', message: 'Unable to load authorization' });
    const unavailable = { rpc: vi.fn(async () => ({ data: null, error: { code: '500', message: 'secret database details' } })) };
    await expect(getActorForUserId(branchEditor.userId, unavailable)).rejects.toBeInstanceOf(ActorResolutionError);
    await expect(getActorForUserId(branchEditor.userId, unavailable)).rejects.toMatchObject({ reason: 'unavailable', message: 'Unable to load authorization' });
  });
});

describe('tool wrapper', () => {
  it('re-resolves role assignments on every call and never invokes a revoked handler', async () => {
    let assignments = branchEditor.authorization!.assignments;
    const db = {
      rpc: vi.fn(async (name: string) => ({
        data: name === 'authorization_actor'
          ? { accountStatus: 'active', memberships: branchEditor.authorization!.memberships, assignments }
          : true,
        error: null,
      })),
    };
    let callback: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    let registration: Record<string, unknown> | undefined;
    const server = { registerTool: vi.fn((_name: string, config: Record<string, unknown>, cb: typeof callback) => { registration = config; callback = cb; }) };
    const handler = vi.fn(async () => ({ value: 'safe' }));
    defineStudioTool(server as never, {
      db: db as never, userId: branchEditor.userId, clientId: 'client-1', correlationId: 'correlation-1',
      registeredToolNames: [], resourceOrigin: 'https://example.test',
    }, {
      name: 'test_read', description: 'Read a test value', inputSchema: z.strictObject({}),
      capability: 'read', rateLimit: 'read', nextStep: 'Call the next tool.', handler,
    });
    expect(registration?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const success = await callback!({}) as { structuredContent: Record<string, unknown> };
    expect(success.structuredContent).toMatchObject({ value: 'safe', nextStep: 'Call the next tool.' });
    expect(handler).toHaveBeenCalledTimes(1);
    assignments = [];
    const denied = await callback!({}) as { isError: boolean; content: Array<{ text: string }> };
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0].text).error.code).toBe('PERMISSION_DENIED');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('caps the combined text and structured output without logging or returning content', async () => {
    const db = { rpc: vi.fn(async (name: string) => ({ data: name === 'authorization_actor'
      ? { accountStatus: 'active', memberships: [], assignments: [] } : true, error: null })) };
    let callback: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    const server = { registerTool: vi.fn((_name: string, _config: unknown, cb: typeof callback) => { callback = cb; }) };
    defineStudioTool(server as never, { db: db as never, userId: branchEditor.userId,
      clientId: 'client-1', correlationId: 'correlation-1', registeredToolNames: [], resourceOrigin: 'https://example.test' }, {
      name: 'large_test', description: 'Test output cap', inputSchema: z.strictObject({}),
      capability: 'whoami', rateLimit: 'read', nextStep: 'Done.',
      handler: async () => ({ blob: 'CONTENT_SECRET_MARKER' + 'x'.repeat(140_000) }),
    });
    const result = await callback!({}) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe('OUTPUT_TOO_LARGE');
    expect(result.content[0].text).not.toContain('CONTENT_SECRET_MARKER');
  });

  it('logs the validated item identifier as metadata without the result body', async () => {
    const db = { rpc: vi.fn(async (name: string) => ({ data: name === 'authorization_actor'
      ? { accountStatus: 'active', memberships: [], assignments: [] } : true, error: null })) };
    let callback: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    const server = { registerTool: vi.fn((_name: string, _config: unknown, cb: typeof callback) => { callback = cb; }) };
    defineStudioTool(server as never, { db: db as never, userId: branchEditor.userId,
      clientId: 'client-1', correlationId: 'correlation-1', registeredToolNames: [], resourceOrigin: 'https://example.test' }, {
      name: 'item_test', description: 'Test logging', inputSchema: z.strictObject({ itemId: z.string() }),
      capability: 'whoami', rateLimit: 'read', nextStep: 'Done.', handler: async () => ({ value: 'CONTENT_SECRET_MARKER' }),
    });
    const write = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await callback!({ itemId: 'lesson-1' });
      const line = write.mock.calls.map(([value]) => String(value)).find((value) => value.includes('"tool":"item_test"'));
      expect(JSON.parse(line!).itemId).toBe('lesson-1');
      expect(line).not.toContain('CONTENT_SECRET_MARKER');
    } finally { write.mockRestore(); }
  });
});

describe('OAuth client allowlist', () => {
  it('accepts only exact hosted callbacks or Claude Code loopback callback', () => {
    expect(isAllowedMcpRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedMcpRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedMcpRedirectUri('http://localhost:43127/callback')).toBe(true);
    for (const uri of [
      'https://claude.ai.evil/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.test',
      'https://evil.test@claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://localhost:43127/other',
      'http://192.168.1.1:43127/callback',
    ]) expect(isAllowedMcpRedirectUri(uri)).toBe(false);
  });

  it('accepts ChatGPT per-connection callback IDs with a bounded base64url-style segment', () => {
    for (const uri of [
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh',
      'https://chatgpt.com/connector/oauth/Abc_123-',
      `https://chatgpt.com/connector/oauth/${'A'.repeat(128)}`,
    ]) expect(isAllowedMcpRedirectUri(uri)).toBe(true);
  });

  it('rejects malformed ChatGPT per-connection callback URLs', () => {
    for (const uri of [
      'https://chatgpt.com/connector/oauth/',
      'https://chatgpt.com/connector/oauth/short',
      `https://chatgpt.com/connector/oauth/${'A'.repeat(129)}`,
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh?next=https://evil.test',
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh#fragment',
      'https://evil.test@chatgpt.com/connector/oauth/AbCd1234EfGh',
      'https://chatgpt.com:443/connector/oauth/AbCd1234EfGh',
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh/',
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh/extra',
      'https://chatgpt.com.evil.test/connector/oauth/AbCd1234EfGh',
      'https://CHATGPT.COM/connector/oauth/AbCd1234EfGh',
      'https://chatgpt.com./connector/oauth/AbCd1234EfGh',
      'https://chatgpt.com/connector/%6fauth/AbCd1234EfGh',
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh%2fextra',
      'https://chatgpt.com/connector/oauth/AbCd1234EfGh\n',
    ]) expect(isAllowedMcpRedirectUri(uri)).toBe(false);
  });

  it('accepts a registered ChatGPT dynamic callback but rejects the entire client when another URI is unsafe', async () => {
    resetMcpClientCacheForTests();
    const callback = 'https://chatgpt.com/connector/oauth/AbCd1234EfGh';
    const getClient = vi.fn(async (_clientId: string) => ({ data: {
      client_id: 'chatgpt-client', redirect_uris: [callback],
    }, error: null }));
    const db = { auth: { admin: { oauth: { getClient } } } };
    await expect(validateMcpClient(db as never, 'chatgpt-client')).resolves.toBeUndefined();
    expect(getClient).toHaveBeenCalledWith('chatgpt-client');

    resetMcpClientCacheForTests();
    getClient.mockResolvedValue({ data: {
      client_id: 'chatgpt-client', redirect_uris: [callback, 'https://evil.test/callback'],
    }, error: null });
    await expect(validateMcpClient(db as never, 'chatgpt-client')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a registered client if any redirect URI is outside the allowlist', async () => {
    const db = { auth: { admin: { oauth: { getClient: vi.fn(async () => ({ data: {
      client_id: 'client-bad', redirect_uris: [
        'https://claude.ai/api/mcp/auth_callback', 'https://evil.test/callback',
      ],
    }, error: null })) } } } };
    await expect(validateMcpClient(db as never, 'client-bad')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('fails closed with a service error when the OAuth client lookup is unavailable', async () => {
    const db = { auth: { admin: { oauth: { getClient: vi.fn(async () => { throw new Error('network down'); }) } } } };
    await expect(validateMcpClient(db as never, 'client-error')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('treats a deleted OAuth client as unauthenticated', async () => {
    const db = { auth: { admin: { oauth: { getClient: vi.fn(async () => ({ data: null, error: { status: 404 } })) } } } };
    await expect(validateMcpClient(db as never, 'client-deleted')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('MCP bearer token verification', () => {
  const userId = '51bda642-e203-42e2-9f6e-fb0b2f5c4c77';
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'key-a', typ: 'JWT' })).toString('base64url');
  const token = `${header}.e30.sig`;
  const claims = {
    iss: 'https://project.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated',
    sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) - 1,
    client_id: 'client-good', session_id: 'session-good', is_anonymous: false,
  };
  const fetchJwks = vi.fn(async () => ({ ok: true, json: async () => ({ keys: [{ kid: 'key-a', kty: 'EC', crv: 'P-256', alg: 'ES256' }] }) }));
  const auth = {
    getClaims: vi.fn(async () => ({ data: { header: { alg: 'ES256', kid: 'key-a' }, claims }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
  };

  it('rejects malformed headers before an Auth or JWKS network call', async () => {
    resetMcpJwksCacheForTests();
    auth.getClaims.mockClear(); fetchJwks.mockClear();
    await expect(verifyMcpToken('a.b.c', auth as never, { supabaseUrl: 'https://project.supabase.co', fetchJwks: fetchJwks as never })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchJwks).not.toHaveBeenCalled();
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it('checks verified claims and current Auth user after kid precheck', async () => {
    resetMcpJwksCacheForTests();
    const verified = await verifyMcpToken(token, auth as never, { supabaseUrl: 'https://project.supabase.co', fetchJwks: fetchJwks as never });
    expect(verified).toMatchObject({ userId, clientId: 'client-good', sessionId: 'session-good' });
    expect(auth.getUser).toHaveBeenCalledWith(token);
  });

  it('rejects first-party tokens without client_id', async () => {
    resetMcpJwksCacheForTests();
    const invalid = { ...auth, getClaims: vi.fn(async () => ({ data: { header: { alg: 'ES256', kid: 'key-a' }, claims: { ...claims, client_id: undefined } }, error: null })) };
    await expect(verifyMcpToken(token, invalid as never, { supabaseUrl: 'https://project.supabase.co', fetchJwks: fetchJwks as never })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(invalid.getClaims).toHaveBeenCalled();
  });
});

describe('MCP principal', () => {
  it('requires a Bearer token before an authorization or rate-limit database call', async () => {
    const db = { rpc: vi.fn() };
    await expect(resolveMcpPrincipal(new Request('https://example.test/api/mcp'), db as never)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('temporary tester gate configuration', () => {
  it('allows an absent gate for launch mode but rejects a configured blank gate', () => {
    expect(mcpTesterUserIds({ ...process.env, MCP_TESTER_USER_IDS: undefined }).size).toBe(0);
    expect(() => mcpTesterUserIds({ ...process.env, MCP_TESTER_USER_IDS: '' })).toThrow();
    expect(() => mcpTesterUserIds({ ...process.env, MCP_TESTER_USER_IDS: ' , ' })).toThrow();
  });
});

describe('canonical MCP resource URL', () => {
  it('rejects a trailing slash configuration that would change the advertised resource', () => {
    expect(mcpResourceUrl({ ...process.env, MCP_RESOURCE_URL: 'https://academy.example/api/mcp' }).href)
      .toBe('https://academy.example/api/mcp');
    expect(() => mcpResourceUrl({ ...process.env, MCP_RESOURCE_URL: 'https://academy.example/api/mcp/' })).toThrow();
  });
});

describe('MCP metadata logging', () => {
  it('keeps Vietnamese client names but omits controls and token-like values', () => {
    const write = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logMcpEvent({ event: 'consent', outcome: 'approved', clientId: 'client-1', clientName: 'Trường Việt' });
      logMcpEvent({ event: 'consent', outcome: 'denied', clientId: 'client-2', clientName: 'Bad\nName' });
      logMcpEvent({ event: 'consent', outcome: 'denied', clientId: 'client-3', clientName: 'eyJhbGci' });
      expect(JSON.parse(write.mock.calls[0][0] as string).clientName).toBe('Trường Việt');
      expect(JSON.parse(write.mock.calls[1][0] as string).clientName).toBeUndefined();
      expect(JSON.parse(write.mock.calls[2][0] as string).clientName).toBeUndefined();
    } finally { write.mockRestore(); }
  });

  it('never sends arbitrary exception text to the error sink', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reportMcpInternalError(new Error('COURSE_TEXT_SECRET_MARKER'), 'correlation-1');
      expect(JSON.stringify(write.mock.calls)).not.toContain('COURSE_TEXT_SECRET_MARKER');
    } finally { write.mockRestore(); }
  });

  it('limits error issues to codes and pointers without proposed content', () => {
    const payload = mcpErrorPayload(new StudioMcpError('VALIDATION_FAILED', {
      issues: [{ code: 'E_SCHEMA', pointer: '/title', message: 'COURSE_TEXT_SECRET_MARKER' }],
    }));
    expect(JSON.stringify(payload)).not.toContain('COURSE_TEXT_SECRET_MARKER');
    expect(payload.error.issues).toEqual([{ code: 'E_SCHEMA', pointer: '/title' }]);
  });
});
