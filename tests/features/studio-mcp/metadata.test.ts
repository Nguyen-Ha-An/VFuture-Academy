import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test/' },
}));

import {
  mcpBearerChallenge,
  mcpProtectedResourceMetadata,
} from '@/features/studio-mcp/http/challenge';
import { GET as getRootMetadata } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as getMcpMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';

beforeEach(() => {
  vi.stubEnv('STUDIO_MCP_ENABLED', '1');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://mcp.example.test/api/mcp');
});

afterEach(() => vi.unstubAllEnvs());

describe('MCP protected-resource discovery', () => {
  it('advertises the exact configured resource and Supabase Auth issuer', () => {
    expect(mcpProtectedResourceMetadata()).toEqual({
      resource: 'https://mcp.example.test/api/mcp',
      authorization_servers: ['https://auth.example.test/auth/v1'],
      scopes_supported: ['openid', 'email'],
      bearer_methods_supported: ['header'],
    });
  });

  it.each([
    ['root', getRootMetadata],
    ['MCP path', getMcpMetadata],
  ])('serves the same metadata from the %s discovery route', async (_name, get) => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(mcpProtectedResourceMetadata());
  });

  it.each([
    ['root', getRootMetadata],
    ['MCP path', getMcpMetadata],
  ])('hides the %s discovery route when MCP is disabled', async (_name, get) => {
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');

    const response = await get();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('points the bearer challenge at path-specific metadata on the resource origin', () => {
    expect(mcpBearerChallenge()).toBe(
      'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/api/mcp", scope="openid email"',
    );
  });
});
