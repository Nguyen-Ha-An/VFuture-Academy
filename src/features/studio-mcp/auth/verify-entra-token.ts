import 'server-only';

import { getOidcMetadata, getSigningKeys, verifySignedJwt } from '@/lib/identity/oidc';
import { findIdentityUser } from '@/lib/identity/store';
import { StudioMcpError } from '../errors';
import { readMcpEntraConfiguration } from './entra-config';
import type { VerifiedMcpToken } from './verify-token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verifies an actual delegated API access token; neither ID tokens nor app-only grants qualify. */
export async function verifyEntraMcpToken(token: string): Promise<VerifiedMcpToken> {
  const config = readMcpEntraConfiguration();
  // Bound attacker-controlled parsing before discovery/network work.
  if (token.length > 32_768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new StudioMcpError('UNAUTHENTICATED');
  }
  let keys: Awaited<ReturnType<typeof getSigningKeys>>;
  try { keys = await getSigningKeys(await getOidcMetadata(config)); }
  catch { throw new StudioMcpError('SERVICE_UNAVAILABLE'); }
  let claims: Record<string, unknown>;
  try { claims = verifySignedJwt(token, keys); }
  catch { throw new StudioMcpError('UNAUTHENTICATED'); }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer || claims.tid !== config.tenantId || claims.aud !== config.audience
    || claims.ver !== '2.0' || typeof claims.azp !== 'string' || !config.allowedClientIds.has(claims.azp)
    || typeof claims.scp !== 'string' || !claims.scp.split(' ').includes(config.scopeClaim)
    || typeof claims.oid !== 'string' || !UUID.test(claims.oid)
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255
    || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now
    || typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > now + 30
    || typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30
    || claims.exp <= claims.iat || claims.exp <= claims.nbf) {
    throw new StudioMcpError('UNAUTHENTICATED');
  }
  let user: Awaited<ReturnType<typeof findIdentityUser>>;
  try { user = await findIdentityUser(config.issuer, claims.oid); }
  catch { throw new StudioMcpError('SERVICE_UNAVAILABLE'); }
  if (!user) throw new StudioMcpError('ACCOUNT_NOT_PROVISIONED');
  if (!UUID.test(user.id)) throw new StudioMcpError('SERVICE_UNAVAILABLE');
  // Microsoft does not expose Supabase session introspection. Local access blocks and
  // account suspension are checked afresh by principal.ts on every exchange.
  return { userId: user.id, clientId: claims.azp, expiresAt: claims.exp };
}
