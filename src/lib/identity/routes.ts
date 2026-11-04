import 'server-only';
import { POPUP_ATTEMPT_PATTERN } from './popup-contract';
import { popupCompletionResponse } from './popup-server';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createAzureDataClient } from '@/lib/database/azure-client';
import { enforceRequestRateLimit } from '@/lib/rate-limit';
import { routes } from '@/lib/routes';
import { authorizationRequest, encryptRefreshToken, exchangeTokens, getOidcMetadata, getSigningKeys, hashToken, isIdentityProvider, randomToken, readIdentityConfiguration, readIdentitySessionConfiguration, verifyIdToken } from './oidc';
import { consumeLoginTransaction, createStoredSession, findMicrosoftStaffUser, resolveIdentityUser, storeLoginTransaction } from './store';
import { LOGIN_COOKIE, SESSION_COOKIE, revokeAzureSession, sessionCookieOptions } from './server';

function noStore(response: NextResponse) { response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); return response; }
export async function azureLogin(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const config = readIdentityConfiguration(process.env, url.searchParams.get('provider') === 'microsoft' ? 'microsoft' : 'external-id');
  // OIDC callback is registered on the canonical host; do not set host-bound cookies elsewhere.
  if (url.origin !== config.appOrigin) return noStore(NextResponse.redirect(new URL(`/auth/login${url.search}`, config.appOrigin), 303));
  if (!['google','microsoft'].includes(url.searchParams.get('provider') || '')) {
    const path=url.searchParams.get('mode')==='recovery'?'/forgot-password':url.searchParams.get('mode')==='signup'?routes.auth.signup({next:url.searchParams.get('next')}):routes.auth.login({next:url.searchParams.get('next')});
    return noStore(NextResponse.redirect(new URL(path,config.appOrigin),303));
  }
  try {
    if (url.searchParams.get('popup') === '1' && !POPUP_ATTEMPT_PATTERN.test(url.searchParams.get('attempt') || '')) throw new Error('Invalid popup attempt');
    await enforceRequestRateLimit(createAzureDataClient('service_role'), 'identity-login', request, { limit: 20, windowSeconds: 60 });
    const metadata = await getOidcMetadata(config);
    const { url: destination, transaction } = authorizationRequest(config, metadata.authorization_endpoint, { next: url.searchParams.get('next'), provider: url.searchParams.get('provider') || undefined, mode: url.searchParams.get('mode') || undefined, popupAttempt: url.searchParams.get('popup') === '1' ? url.searchParams.get('attempt') || undefined : undefined });
    const browserToken = randomToken();
    await storeLoginTransaction(hashToken(transaction.state), hashToken(browserToken), transaction);
    const response = noStore(NextResponse.redirect(destination, 303));
    response.cookies.set(LOGIN_COOKIE, browserToken, { ...sessionCookieOptions, maxAge: 600 });
    return response;
  } catch (error) {
    const attempt = url.searchParams.get('attempt');
    if (url.searchParams.get('popup') === '1' && attempt && POPUP_ATTEMPT_PATTERN.test(attempt)) return popupCompletionResponse(config.appOrigin, attempt, 'error');
    const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 429 ? 429 : 503;
    return noStore(NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, { status }));
  }
}
export async function azureCallback(request: Request): Promise<NextResponse> {
  const appOrigin = readIdentitySessionConfiguration().appOrigin;
  const url = new URL(request.url);
  // Callback responses never mutate the shared login cookie: a later retry may
  // already own it. Consumed database state and the ten-minute expiry prevent replay.
  let popupAttempt: string | null = null;
  const failure = () => { const response = popupAttempt ? popupCompletionResponse(appOrigin, popupAttempt, 'error') : noStore(NextResponse.redirect(new URL(routes.auth.login({ error: 'provider' }), appOrigin), 303)); return response; };
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const browserToken = (await cookies()).get(LOGIN_COOKIE)?.value;
  if (url.origin !== appOrigin || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browserToken || !/^[A-Za-z0-9_-]{43}$/.test(browserToken)) return failure();
  try {
    // DELETE ... RETURNING consumes state atomically before any authorization-code exchange.
    const transaction = await consumeLoginTransaction(hashToken(state), hashToken(browserToken));
    if (!transaction || !isIdentityProvider(transaction.provider) || transaction.state !== state) return failure();
    popupAttempt = transaction.popupAttempt && POPUP_ATTEMPT_PATTERN.test(transaction.popupAttempt) ? transaction.popupAttempt : null;
    if (!code || code.length > 8192 || url.searchParams.has('error')) return failure();
    const config = readIdentityConfiguration(process.env, transaction.provider);
    const metadata = await getOidcMetadata(config);
    const tokens = await exchangeTokens(config, metadata, { code, verifier: transaction.verifier });
    const claims = await verifyIdToken(tokens.idToken, config, await getSigningKeys(metadata), transaction.nonce);
    const user = transaction.provider === 'microsoft' ? await findMicrosoftStaffUser(claims.iss, claims.oid) : await resolveIdentityUser(claims);
    if (!user) return failure();
    const sessionToken = randomToken(); const hash = hashToken(sessionToken);
    const expiresAt = Math.floor(Date.now() / 1000) + config.sessionMaxAge;
    await createStoredSession(hash, { provider: transaction.provider, user, issuer: claims.iss, subject: claims.oid, oidcSubject: claims.sub, expiresAt,
      tokenExpiresAt: claims.exp, refreshCiphertext: tokens.refreshToken ? encryptRefreshToken(tokens.refreshToken, hash, config) : null });
    await revokeAzureSession();
    // Welcome already checks the profile and forwards complete accounts to their saved next path.
    const response = popupAttempt ? popupCompletionResponse(appOrigin, popupAttempt, 'success') : noStore(NextResponse.redirect(new URL(routes.auth.welcome({ next: transaction.next }), appOrigin), 303));

    response.cookies.set(SESSION_COOKIE, sessionToken, { ...sessionCookieOptions, maxAge: config.sessionMaxAge });
    return response;
  } catch { return failure(); }
}
export async function azureLogout(request: Request): Promise<NextResponse> {
  const appOrigin = readIdentitySessionConfiguration().appOrigin;
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.has('origin') && request.headers.get('origin') !== new URL(request.url).origin)) {
    return noStore(NextResponse.json({ error: 'Cross-origin request denied' }, { status: 403 }));
  }
  const provider = await revokeAzureSession();
  let destination = new URL('/login', appOrigin);
  try {
    const config = readIdentityConfiguration(process.env, provider || 'external-id');
    const metadata = await getOidcMetadata(config);
    destination = new URL(metadata.end_session_endpoint);
    destination.searchParams.set('post_logout_redirect_uri', new URL('/login', appOrigin).toString());
    destination.searchParams.set('client_id', config.clientId);
  } catch { /* Local revocation still succeeds if the provider logout endpoint is unavailable. */ }
  const response = noStore(NextResponse.redirect(destination, 303));
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  response.cookies.set(LOGIN_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
