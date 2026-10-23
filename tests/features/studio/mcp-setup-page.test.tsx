import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  studioPageContext: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
  isMcpAccessBlocked: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden }));
vi.mock('@/features/workspace/context', () => ({ studioPageContext: mocks.studioPageContext }));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ isMcpAccessBlocked: mocks.isMcpAccessBlocked }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import StudioMcpPage from '@/app/studio/mcp/page';
import { McpSetupView } from '@/features/studio/ui/McpSetupView';

const userId = '00000000-0000-4000-8000-000000000001';
const editor = { userId, roles: [{ role: 'editor', branchId: null }] };

async function state() {
  const element = await StudioMcpPage();
  expect(element.type).toBe(McpSetupView);
  return element.props.state;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('MCP_RESOURCE_URL', 'https://academy.example/api/mcp');
  vi.stubEnv('STUDIO_MCP_ENABLED', '1');
  mocks.studioPageContext.mockReset().mockResolvedValue({ actor: editor });
  mocks.forbidden.mockClear();
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
  mocks.supabaseService.mockReset().mockReturnValue({});
});

describe('/studio/mcp', () => {
  it('uses the canonical configured endpoint when the server is enabled', async () => {
    expect(await state()).toEqual({ kind: 'enabled', endpoint: 'https://academy.example/api/mcp' });
    expect(mocks.studioPageContext).toHaveBeenCalledOnce();
  });

  it('shows the endpoint as disabled while the kill switch is off', async () => {
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');
    expect(await state()).toEqual({ kind: 'disabled', endpoint: 'https://academy.example/api/mcp' });
  });

  it('blocks a Studio contributor who cannot read courses', async () => {
    mocks.studioPageContext.mockResolvedValue({ actor: { userId, roles: [{ role: 'contributor', branchId: null }] } });
    await expect(StudioMcpPage()).rejects.toThrow('forbidden:403');
    expect(mocks.forbidden).toHaveBeenCalledOnce();
  });

  it('does not offer setup when the optional tester list excludes this user', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', '00000000-0000-4000-8000-000000000002');
    expect(await state()).toEqual({ kind: 'restricted' });
  });

  it('hides the endpoint when Central Admin blocks this user', async () => {
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    expect(await state()).toEqual({ kind: 'restricted' });
    expect(mocks.isMcpAccessBlocked).toHaveBeenCalledWith(userId, expect.anything());
  });

  it('hides the endpoint when the access check is unavailable', async () => {
    mocks.isMcpAccessBlocked.mockRejectedValue(new Error('database unavailable'));
    expect(await state()).toEqual({ kind: 'unavailable' });
  });

  it('allows a user named in the optional tester list', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', userId);
    expect(await state()).toEqual({ kind: 'enabled', endpoint: 'https://academy.example/api/mcp' });
  });

  it('fails closed for a blank tester list', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', '  ');
    expect(await state()).toEqual({ kind: 'restricted' });
  });

  it('does not invent an endpoint when server configuration is unavailable', async () => {
    vi.stubEnv('MCP_RESOURCE_URL', 'https://academy.example/api/mcp/');
    expect(await state()).toEqual({ kind: 'unavailable' });
  });
});
