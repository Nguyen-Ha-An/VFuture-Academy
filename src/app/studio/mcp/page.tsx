import { forbidden } from 'next/navigation';

import { hasStudioConsentAccess, isConsentTester } from '@/features/oauth-consent/admission';
import { mcpEnabled, mcpResourceUrl } from '@/features/studio-mcp/config';
import { isMcpAccessBlocked } from '@/features/studio-mcp/auth/access-block';
import { McpSetupView, type McpSetupState } from '@/features/studio/ui/McpSetupView';
import { studioPageContext } from '@/features/workspace/context';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function StudioMcpPage() {
  const { actor } = await studioPageContext();
  if (!hasStudioConsentAccess(actor)) forbidden();

  let state: McpSetupState;
  if (!isConsentTester(actor.userId)) {
    state = { kind: 'restricted' };
  } else {
    try {
      if (await isMcpAccessBlocked(actor.userId, supabaseService())) {
        state = { kind: 'restricted' };
      } else {
        let endpoint: string | null = null;
        try { endpoint = mcpResourceUrl().toString(); } catch { /* A bad deployment URL must never be offered to clients. */ }
        state = endpoint
          ? { kind: mcpEnabled() ? 'enabled' : 'disabled', endpoint }
          : { kind: 'unavailable' };
      }
    } catch {
      state = { kind: 'unavailable' };
    }
  }

  return <McpSetupView state={state} />;
}
