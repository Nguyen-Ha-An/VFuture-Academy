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
  it('advertises the Entra issuer and delegated API scope in Azure mode', () => {
    vi.stubEnv('ACADEMY_BACKEND', 'azure');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
    vi.stubEnv('ENTRA_TENANT_ID', '11111111-1111-4111-8111-111111111111');
    vi.stubEnv('ENTRA_ISSUER', 'https://tenant.ciamlogin.com/11111111-1111-4111-8111-111111111111/v2.0');
    vi.stubEnv('ENTRA_AUTHORITY', 'https://tenant.ciamlogin.com/11111111-1111-4111-8111-111111111111/v2.0');
    vi.stubEnv('STUDIO_MCP_ENTRA_AUDIENCE', '22222222-2222-4222-8222-222222222222');
    vi.stubEnv('STUDIO_MCP_ENTRA_SCOPE', 'api://22222222-2222-4222-8222-222222222222/Studio.Read');
    vi.stubEnv('STUDIO_MCP_ENTRA_ALLOWED_CLIENT_IDS', '33333333-3333-4333-8333-333333333333');
    expect(mcpProtectedResourceMetadata()).toMatchObject({
      authorization_servers: ['https://tenant.ciamlogin.com/11111111-1111-4111-8111-111111111111/v2.0'],
      scopes_supported: ['api://22222222-2222-4222-8222-222222222222/Studio.Read'],
    });
    expect(mcpBearerChallenge()).toContain('scope="api://22222222-2222-4222-8222-222222222222/Studio.Read"');
  });

  it('fails closed for incomplete Azure registration settings instead of falling back to Supabase', async () => {
    vi.stubEnv('ACADEMY_BACKEND', 'azure');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
    const response = await getMcpMetadata();
    expect(response.status).toBe(503);
  });
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
