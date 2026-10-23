import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listGrants: vi.fn(),
  getLocale: vi.fn(),
  readWorkspaceTheme: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: async () => ({ auth: { oauth: { listGrants: mocks.listGrants } } }),
}));
vi.mock('next-intl/server', () => ({ getLocale: mocks.getLocale }));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: mocks.readWorkspaceTheme }));

import ConnectedAppsPage, { generateMetadata } from '@/app/account/connected-apps/page';
import { ConnectedAppsPanel } from '@/features/account/connected-apps/ConnectedAppsPanel';

const clientId = '00000000-0000-4000-8000-000000000123';

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: 'former-studio-editor', email: 'editor@example.com' });
  mocks.listGrants.mockReset().mockResolvedValue({ data: [{
    client: { id: clientId, name: 'Course helper', uri: 'javascript:alert(1)', logo_uri: 'https://evil.example/logo' },
    scopes: ['openid', 'email'], granted_at: '2026-09-20T00:00:00Z',
  }], error: null });
  mocks.getLocale.mockReset().mockResolvedValue('en');
  mocks.readWorkspaceTheme.mockReset().mockResolvedValue('system');
});

describe('/account/connected-apps', () => {
  it('localizes the private page title', async () => {
    expect(await generateMetadata()).toMatchObject({ title: 'Connected apps | VFuture Academy', robots: { index: false } });
    mocks.getLocale.mockResolvedValue('vi');
    expect(await generateMetadata()).toMatchObject({ title: 'Ứng dụng đã kết nối | VFuture Academy', robots: { index: false } });
  });

  it('reads the current user grants without Studio admission or tester checks', async () => {
    const element = await ConnectedAppsPage();
    expect(element.type).toBe(ConnectedAppsPanel);
    expect(mocks.requireUser).toHaveBeenCalledExactlyOnceWith('/account/connected-apps');
    expect(mocks.listGrants).toHaveBeenCalledOnce();
    expect(element.props).toMatchObject({
      accountEmail: 'editor@example.com', locale: 'en', theme: 'system',
      state: { kind: 'ready', apps: [{ clientId, name: 'Course helper', scopes: ['openid', 'email'], grantedAt: '2026-09-20T00:00:00Z' }] },
    });
    expect(JSON.stringify(element.props)).not.toContain('javascript:');
    expect(JSON.stringify(element.props)).not.toContain('evil.example');
  });

  it('does not misreport an Auth failure as no connections', async () => {
    mocks.listGrants.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const element = await ConnectedAppsPage();
    expect(element.props.state).toEqual({ kind: 'unavailable' });
  });

  it('rejects malformed grant data rather than presenting an empty list', async () => {
    mocks.listGrants.mockResolvedValue({ data: [{ client: { name: 'No ID' } }], error: null });
    const element = await ConnectedAppsPage();
    expect(element.props.state).toEqual({ kind: 'unavailable' });
  });
});
