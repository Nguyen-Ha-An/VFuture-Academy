import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';

import { ConnectedAppsPanel, type ConnectedApp, type ConnectedAppsState } from '@/features/account/connected-apps/ConnectedAppsPanel';
import { readWorkspaceTheme } from '@/features/workspace-ui/theme.server';
import { requireUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: `${locale === 'en' ? 'Connected apps' : 'Ứng dụng đã kết nối'} | VFuture Academy`,
    robots: { index: false, follow: false },
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asConnectedApps(value: unknown): ConnectedApp[] | null {
  if (!Array.isArray(value)) return null;
  const apps: ConnectedApp[] = [];
  for (const grant of value) {
    if (!grant || typeof grant !== 'object' || !('client' in grant) || !grant.client || typeof grant.client !== 'object') return null;
    const client = grant.client as Record<string, unknown>;
    if (typeof client.id !== 'string' || !uuid.test(client.id)
      || typeof client.name !== 'string' || !client.name.trim()
      || !('scopes' in grant) || !Array.isArray(grant.scopes)
      || !grant.scopes.every((scope: unknown) => typeof scope === 'string')
      || !('granted_at' in grant) || typeof grant.granted_at !== 'string'
      || Number.isNaN(Date.parse(grant.granted_at))) return null;
    apps.push({ clientId: client.id, name: client.name, scopes: grant.scopes, grantedAt: grant.granted_at });
  }
  return apps;
}

export default async function ConnectedAppsPage() {
  const [user, locale, theme] = await Promise.all([
    requireUser('/account/connected-apps'), getLocale(), readWorkspaceTheme(),
  ]);
  let state: ConnectedAppsState = { kind: 'unavailable' };
  try {
    const client = await supabaseUser();
    const result = await client.auth.oauth.listGrants();
    const apps = result.error ? null : asConnectedApps(result.data);
    if (apps) state = { kind: 'ready', apps };
  } catch {
    // A failed read must never be shown as an empty account.
  }
  return <ConnectedAppsPanel state={state} accountEmail={user.email ?? user.id} locale={locale === 'en' ? 'en' : 'vi'} theme={theme} />;
}
