import 'server-only';
import { IdentityGrantRejected, decryptRefreshToken, encryptRefreshToken, exchangeTokens, getOidcMetadata, getSigningKeys, randomToken, readIdentityConfiguration, readIdentitySessionConfiguration, verifyIdToken, NATIVE_REFRESH_PREFIX } from './oidc';
import { decodeGoogleRefresh, encodeGoogleRefresh, GOOGLE_REFRESH_PREFIX, readGoogleConfiguration, exchangeGoogleTokens, getGoogleMetadata, verifyGoogleIdToken, googleIdentityDisplayName } from './google';
import { createGoogleDirectory } from './google-directory';
import { claimSessionRefresh, findIdentityUser, readStoredSession, releaseSessionRefresh, revokeSessionRefresh, rotateStoredSession, type StoredSession } from './store';

/** A different process owns the grant. Never redeem it concurrently or accept an expired token. */
async function awaitFreshSession(hash: string, version: number): Promise<StoredSession | null> {
  const signal = AbortSignal.timeout(10_000);
  const delays = [0, 100, 200, 400, 800, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  for (const delay of delays) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const latest = await readStoredSession(hash, signal);
    if (!latest || latest.expiresAt <= Date.now() / 1000) return null;
    if (latest.version > version && latest.tokenExpiresAt > Date.now() / 1000) return latest;
  }
  // A transient failure or slow owner is an outage, not a revoked login.
  throw new Error('Session refresh is temporarily unavailable');
}

/** Database lease/fencing protects independent server instances, not just concurrent render calls. */
export async function refreshAzureSession(hash: string, session: StoredSession): Promise<StoredSession | null> {
  const lease = randomToken();
  if (!await claimSessionRefresh(hash, session.version, lease)) return awaitFreshSession(hash, session.version);
  try {
    if (!session.refreshCiphertext) {
      if (await revokeSessionRefresh(hash, session.version, lease)) return null;
      return await awaitFreshSession(hash, session.version);
    }
    const encryption = { ...readIdentitySessionConfiguration(), provider:session.provider };
    const credential = decryptRefreshToken(session.refreshCiphertext,hash,encryption);
    let expiresAt: number;
    let nextCredential: string;
    try {
      if (credential.startsWith(GOOGLE_REFRESH_PREFIX)) {
        if (session.provider !== 'external-id') throw new Error('Session identity changed');
        const previous = decodeGoogleRefresh(credential);
        const config = readGoogleConfiguration();
        if (previous.clientId !== config.clientId || previous.subject !== session.oidcSubject) {
          await revokeSessionRefresh(hash,session.version,lease);
          throw new Error('Session identity changed');
        }
        if (!previous.refreshToken) throw new IdentityGrantRejected();
        const metadata = await getGoogleMetadata();
        const tokens = await exchangeGoogleTokens(config,{refreshToken:previous.refreshToken});
        const identity = await verifyGoogleIdToken(tokens.idToken,config,await getSigningKeys(metadata));
        if (identity.subject !== previous.subject) {
          await revokeSessionRefresh(hash,session.version,lease);
          throw new Error('Session identity changed');
        }
        const binding = await createGoogleDirectory().resolve(identity,false);
        const mappedUser = await findIdentityUser(binding.issuer,binding.objectId);
        if (binding.issuer !== session.issuer || binding.objectId !== session.subject || mappedUser?.id !== session.user.id) {
          await revokeSessionRefresh(hash,session.version,lease);
          throw new Error('Session identity changed');
        }
        expiresAt = identity.expiresAt;
        nextCredential = encodeGoogleRefresh({clientId:config.clientId,subject:identity.subject,email:identity.email,displayName:googleIdentityDisplayName(identity),refreshToken:tokens.refreshToken||previous.refreshToken});
      } else {
        const config = readIdentityConfiguration(process.env,session.provider);
        const metadata = await getOidcMetadata(config);
        const native = credential.startsWith(NATIVE_REFRESH_PREFIX);
        const previous = native ? credential.slice(NATIVE_REFRESH_PREFIX.length) : credential;
        const tokens = await exchangeTokens(config,metadata,{refreshToken:previous,...(native?{native:true}:{})});
        const claims = await verifyIdToken(tokens.idToken,config,await getSigningKeys(metadata));
        if (claims.iss !== session.issuer || claims.oid !== session.subject || claims.sub !== session.oidcSubject) {
          await revokeSessionRefresh(hash,session.version,lease);
          throw new Error('Session identity changed');
        }
        expiresAt = claims.exp;
        nextCredential = (native?NATIVE_REFRESH_PREFIX:'')+(tokens.refreshToken||previous);
      }
    } catch (error) {
      if (error instanceof IdentityGrantRejected) {
        // Only the active lease owner may revoke. An expired worker cannot destroy
        // a newer owner, even when both workers observed the same session version.
        if (await revokeSessionRefresh(hash,session.version,lease)) return null;
        return await awaitFreshSession(hash,session.version);
      }
      throw error;
    }
    const rotated = await rotateStoredSession(hash,session.version,expiresAt,encryptRefreshToken(nextCredential,hash,encryption),lease);
    if (!rotated) return await awaitFreshSession(hash, session.version);
    const updated = await readStoredSession(hash);
    if (!updated || updated.expiresAt <= Date.now() / 1000) return null;
    if (updated.tokenExpiresAt <= Date.now() / 1000) throw new Error('Session refresh is temporarily unavailable');
    return updated;
  } finally {
    // Fenced release is harmless after rotation/revocation and cannot release a
    // successor's lease. Network/provider failures preserve the session for retry.
    await releaseSessionRefresh(hash, session.version, lease);
  }
}
