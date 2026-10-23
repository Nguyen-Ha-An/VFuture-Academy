import { ConsentPanel, type ConsentPanelState } from '@/features/oauth-consent/ConsentPanel';
import { hasStudioConsentAccess, isConsentTester } from '@/features/oauth-consent/admission';
import { allowedConsentCallback, allowedConsentReturn } from '@/features/oauth-consent/redirect-allowlist';
import { mcpEnabled } from '@/features/studio-mcp/config';
import { isMcpAccessBlocked } from '@/features/studio-mcp/auth/access-block';
import { studioPageContext } from '@/features/workspace/context';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
};

export default async function StudioConnectPage({ searchParams }: PageProps) {
  const { actor } = await studioPageContext();
  const query = await searchParams;
  const authorizationId = query.authorization_id;
  let state: ConsentPanelState;

  if (!mcpEnabled()) {
    state = { kind: 'unavailable' };
  } else if (typeof authorizationId !== 'string' || authorizationId.length === 0 || authorizationId.length > 256) {
    state = { kind: 'missing' };
  } else if (!hasStudioConsentAccess(actor)) {
    state = { kind: 'access' };
  } else if (!isConsentTester(actor.userId)) {
    state = { kind: 'tester' };
  } else {
    try {
      if (await isMcpAccessBlocked(actor.userId, supabaseService())) {
        state = { kind: 'access' };
      } else {
        const client = await supabaseUser();
        const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
        if (error || !data) {
          state = error?.status === 400 || error?.status === 404 || error?.status === 410
            ? { kind: 'expired' }
            : { kind: 'unavailable' };
        } else if ('redirect_url' in data) {
          const redirectUrl = allowedConsentReturn(data.redirect_url);
          state = redirectUrl ? { kind: 'redirect', redirectUrl } : { kind: 'unsafe', authorizationId };
        } else if (data.authorization_id !== authorizationId || data.user?.id !== actor.userId) {
          state = { kind: 'unavailable' };
        } else {
          const callback = allowedConsentCallback(data.redirect_uri);
          if (!callback) {
            state = { kind: 'unsafe', authorizationId };
          } else if (typeof data.scope !== 'string' || data.scope.length > 2_048 || typeof data.client?.name !== 'string') {
            state = { kind: 'unavailable' };
          } else {
            state = {
              kind: 'ready',
              authorizationId,
              callback: callback.uri,
              host: callback.host,
              // DCR clients supply their own names. Remove controls and keep it subordinate to the verified host.
              clientName: data.client.name.normalize('NFC').replace(/\p{C}/gu, '').slice(0, 120),
              scopes: data.scope.trim().split(/\s+/u).filter(Boolean),
              accountEmail: typeof data.user.email === 'string' ? data.user.email : '',
            };
          }
        }
      }
    } catch {
      state = { kind: 'unavailable' };
    }
  }

  return <ConsentPanel state={state} />;
}
