import 'server-only';

import { readIdentityIssuerConfiguration } from '@/lib/identity/oidc';
import { StudioMcpError } from '../errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entra v2 API tokens use the API application's GUID audience and a delegated scope. */
export function readMcpEntraConfiguration(source: NodeJS.ProcessEnv = process.env) {
  try {
    const identity = readIdentityIssuerConfiguration(source);
    const audience = source.STUDIO_MCP_ENTRA_AUDIENCE?.trim() ?? '';
    const scope = source.STUDIO_MCP_ENTRA_SCOPE?.trim() ?? '';
    const prefix = `api://${audience}/`;
    const scopeClaim = scope.startsWith(prefix) ? scope.slice(prefix.length) : '';
    const clients = (source.STUDIO_MCP_ENTRA_ALLOWED_CLIENT_IDS ?? '').split(',').map(value => value.trim());
    if (!UUID.test(audience) || !/^[A-Za-z0-9_.-]{1,128}$/.test(scopeClaim)
      || clients.length > 100 || clients.some(value => !UUID.test(value))) throw new Error('Invalid MCP API registration');
    return { ...identity, audience, scope, scopeClaim, allowedClientIds: new Set(clients) };
  } catch {
    throw new StudioMcpError('SERVICE_UNAVAILABLE');
  }
}
