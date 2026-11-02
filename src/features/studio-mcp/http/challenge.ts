import { mcpResourceUrl } from '@/features/studio-mcp/config';
import { env } from '@/lib/env';
import { academyBackend } from '@/lib/identity/provider';
import { readMcpEntraConfiguration } from '../auth/entra-config';

const REQUIRED_SCOPES = ['openid', 'email'] as const;

/** The discovery document served at both protected-resource metadata paths. */
export function mcpProtectedResourceMetadata(): Record<string, unknown> {
  const entra = academyBackend() === 'azure' ? readMcpEntraConfiguration() : null;
  return {
    resource: mcpResourceUrl().toString(),
    authorization_servers: [entra?.issuer ?? new URL('/auth/v1', env.NEXT_PUBLIC_SUPABASE_URL).toString()],
    scopes_supported: entra ? [entra.scope] : [...REQUIRED_SCOPES],
    bearer_methods_supported: ['header'],
  };
}

/** Sent in WWW-Authenticate on requests that need an MCP bearer token. */
export function mcpBearerChallenge(): string {
  const metadataUrl = new URL('/.well-known/oauth-protected-resource/api/mcp', mcpResourceUrl());
  const scopes = academyBackend() === 'azure' ? readMcpEntraConfiguration().scope : REQUIRED_SCOPES.join(' ');
  return `Bearer resource_metadata="${metadataUrl.toString()}", scope="${scopes}"`;
}
