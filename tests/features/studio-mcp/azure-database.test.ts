import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get() { throw new Error('MCP Azure must not read legacy credentials'); } }) }));

import { createReadOnlyDatabase, McpWriteAttemptError } from '@/features/studio-mcp/db/read-only-database';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Azure MCP database facade', () => {
  it('uses the authenticated Azure PostgREST transport and blocks content writes and OAuth discovery', async () => {
    vi.stubEnv('ACADEMY_BACKEND', 'azure');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
    vi.stubEnv('AZURE_POSTGREST_URL', 'https://data.example.test/');
    vi.stubEnv('AZURE_POSTGREST_JWT_SECRET', 'a'.repeat(40));
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://data.example.test/courses?select=id');
      const bearer = new Headers(init.headers).get('authorization')!;
      const claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
      expect(claims).toMatchObject({ role: 'service_role', aud: 'academy-data' });
      return Response.json([{ id: 'course' }]);
    });
    vi.stubGlobal('fetch', fetcher);
    const db = createReadOnlyDatabase();
    await expect(db.from('courses').select('id')).resolves.toMatchObject({ data: [{ id: 'course' }], error: null });
    expect(() => Reflect.get(db.from('courses'), 'update')).toThrow(McpWriteAttemptError);
    expect(() => db.rpc('studio_save', {})).toThrow(McpWriteAttemptError);
    expect(() => db.auth.admin.oauth.getClient('client')).toThrow(McpWriteAttemptError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
