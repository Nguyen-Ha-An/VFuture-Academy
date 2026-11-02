import { jwtVerify, createRemoteJWKSet } from 'jose';
import { assertClaims } from './core.mjs';
export function extensionKeys(config) {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.ciamlogin.com') || issuer.pathname !== `/${config.tenantId}/v2.0` || issuer.search || issuer.hash || issuer.username || issuer.password) throw new Error('Invalid extension issuer');
  return createRemoteJWKSet(new URL(`https://${issuer.hostname}/${config.tenantId}/discovery/v2.0/keys`), { timeoutDuration: 1000 });
}
export async function verifyExtensionToken(token, config, keys) {
  const { payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], issuer: config.issuer, audience: config.audience, requiredClaims: ['exp', 'iat', 'nbf', 'tid', 'azp', 'ver'], clockTolerance: 30 });
  assertClaims(payload, config);
  return payload;
}
