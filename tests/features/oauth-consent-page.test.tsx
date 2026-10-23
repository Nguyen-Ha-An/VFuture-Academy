import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  studioPageContext: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  isMcpAccessBlocked: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/workspace/context', () => ({ studioPageContext: mocks.studioPageContext }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: async () => ({ auth: { oauth: { getAuthorizationDetails: mocks.getAuthorizationDetails } } }),
  supabaseService: () => ({ from: vi.fn() }),
}));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ isMcpAccessBlocked: mocks.isMcpAccessBlocked }));

import StudioConnectPage from '@/app/studio/connect/authorize/page';
import { ConsentPanel } from '@/features/oauth-consent/ConsentPanel';

const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const details = {
  authorization_id: 'authorization-1',
  redirect_uri: callback,
  client: { id: 'client-1', name: 'Quiz helper', uri: null, logo_uri: null },
  user: { id: 'editor', email: 'editor@example.com' },
  scope: 'openid email offline_access',
};

async function stateFor(authorizationId?: string) {
  const element = await StudioConnectPage({
    searchParams: Promise.resolve(authorizationId ? { authorization_id: authorizationId } : {}),
  });
  expect(element.type).toBe(ConsentPanel);
  return element.props.state;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STUDIO_MCP_ENABLED', '1');
  mocks.studioPageContext.mockReset().mockResolvedValue({ actor: { userId: 'editor', roles: [{ role: 'editor', branchId: null }] } });
  mocks.getAuthorizationDetails.mockReset().mockResolvedValue({ data: details, error: null });
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
});

describe('/studio/connect/authorize', () => {
  it('shows access blocked before reading authorization details for a blocked user', async () => {
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    expect(await stateFor('authorization-1')).toEqual({ kind: 'access' });
    expect(mocks.isMcpAccessBlocked).toHaveBeenCalledWith('editor', expect.anything());
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('does not show an existing grant redirect when the block lookup fails', async () => {
    mocks.isMcpAccessBlocked.mockRejectedValue(new Error('private database details'));
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=old` }, error: null });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'unavailable' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('shows unavailable with no OAuth call when the MCP kill switch is off', async () => {
    vi.stubEnv('STUDIO_MCP_ENABLED', '0');
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=old` }, error: null });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'unavailable' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('does not call Supabase when the authorization ID is missing', async () => {
    expect(await stateFor()).toEqual({ kind: 'missing' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('blocks a non-tester before asking Auth for authorization details', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', 'another-user');
    expect(await stateFor('authorization-1')).toEqual({ kind: 'tester' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('blocks consent when the tester setting exists but is blank', async () => {
    vi.stubEnv('MCP_TESTER_USER_IDS', '  ');
    expect(await stateFor('authorization-1')).toEqual({ kind: 'tester' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('blocks a Studio contributor without course READ authority', async () => {
    mocks.studioPageContext.mockResolvedValue({ actor: { userId: 'editor', roles: [{ role: 'contributor', branchId: null }] } });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'access' });
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('uses the verified host, client name, and space-separated scopes', async () => {
    expect(await stateFor('authorization-1')).toEqual({
      kind: 'ready',
      authorizationId: 'authorization-1',
      callback,
      host: 'chatgpt.com',
      clientName: 'Quiz helper',
      scopes: ['openid', 'email', 'offline_access'],
      accountEmail: 'editor@example.com',
    });
  });

  it('shows consent for a ChatGPT connection with a callback ID', async () => {
    const chatgptCallback = 'https://chatgpt.com/connector/oauth/AbCd1234EfGh';
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: chatgptCallback }, error: null });
    expect(await stateFor('authorization-1')).toMatchObject({
      kind: 'ready', callback: chatgptCallback, host: 'chatgpt.com',
    });
  });

  it('shows a deny-only state for an unsafe redirect URI', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { ...details, redirect_uri: 'https://evil.example/callback' }, error: null });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'unsafe', authorizationId: 'authorization-1' });
  });

  it('validates a preapproved redirect before navigating', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${callback}?code=abc` }, error: null });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'redirect', redirectUrl: `${callback}?code=abc` });
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: 'https://evil.example/callback?code=abc' }, error: null });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'unsafe', authorizationId: 'authorization-1' });
  });

  it('explains an expired authorization rather than showing consent', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: { status: 404 } });
    expect(await stateFor('authorization-1')).toEqual({ kind: 'expired' });
  });
});
