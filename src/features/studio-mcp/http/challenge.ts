import { mcpResourceUrl } from '@/features/studio-mcp/config';
import { env } from '@/lib/env';

const REQUIRED_SCOPES = ['openid', 'email'] as const;

/** The discovery document served at both protected-resource metadata paths. */
export function mcpProtectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResourceUrl().toString(),
    authorization_servers: [new URL('/auth/v1', env.NEXT_PUBLIC_SUPABASE_URL).toString()],
    scopes_supported: [...REQUIRED_SCOPES],
    bearer_methods_supported: ['header'],
  };
}

/** Sent in WWW-Authenticate on requests that need an MCP bearer token. */
export function mcpBearerChallenge(): string {
  const metadataUrl = new URL('/.well-known/oauth-protected-resource/api/mcp', mcpResourceUrl());
  return `Bearer resource_metadata="${metadataUrl.toString()}", scope="${REQUIRED_SCOPES.join(' ')}"`;
}
