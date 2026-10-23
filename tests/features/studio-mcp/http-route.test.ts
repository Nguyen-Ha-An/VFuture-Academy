import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown | null }> => ({ data: true, error: null })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/studio-mcp/db/read-only-database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/studio-mcp/db/read-only-database')>();
  return { ...original, createReadOnlyDatabase: () => ({ rpc: mocks.rpc }) };
});

import { handleMcpRequest } from '@/features/studio-mcp/http/handle-request';

const url = 'https://academy.example/api/mcp';
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STUDIO_MCP_ENABLED', '1');
  vi.stubEnv('MCP_RESOURCE_URL', url);
  vi.stubEnv('MCP_ALLOWED_ORIGINS', 'https://client.example');
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe('MCP HTTP boundary', () => {
  it('returns a bearer resource challenge for a missing token and limits its IP', async () => {
    const response = await handleMcpRequest(new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.4' }, body,
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata="https://academy.example/.well-known/oauth-protected-resource/api/mcp"');
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mocks.rpc).toHaveBeenCalledWith('rate_limit', expect.objectContaining({ limit: 60, window_seconds: 60 }));
  });

  it('fails closed when the 401 rate limit service is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database down' } });
    const response = await handleMcpRequest(new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('RATE_LIMIT_UNAVAILABLE');
  });

  it('enforces origin, method, and kill switch before database access', async () => {
    const forbidden = await handleMcpRequest(new Request(url, { method: 'GET', headers: { Origin: 'https://evil.example' } }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const get = await handleMcpRequest(new Request(url, { method: 'GET' }));
    const del = await handleMcpRequest(new Request(url, { method: 'DELETE' }));
    expect(get.status).toBe(405);
    expect(del.status).toBe(405);
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');
    expect((await handleMcpRequest(new Request(url, { method: 'GET' }))).status).toBe(404);
  });

  it('adds CORS only for an exact allowlisted browser Origin', async () => {
    const response = await handleMcpRequest(new Request(url, { method: 'OPTIONS', headers: { Origin: 'https://client.example' } }));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
  });
});
