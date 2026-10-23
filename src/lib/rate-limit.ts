import 'server-only';

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { ApiError } from '@/lib/api-error';
import { assertRuntimeEnvironment } from '@/lib/env';

export type RateLimitPolicy = Readonly<{ limit: number; windowSeconds: number }>;

export const RATE_LIMITS = {
  import: { limit: 10, windowSeconds: 60 },
  validation: { limit: 60, windowSeconds: 60 },
  upload: { limit: 10, windowSeconds: 60 },
  analytics: { limit: 60, windowSeconds: 60 },
  quizCheck: { limit: 60, windowSeconds: 60 },
  quizSubmit: { limit: 20, windowSeconds: 60 },
  examAnswers: { limit: 120, windowSeconds: 60 },
  examEvents: { limit: 30, windowSeconds: 60 },
  examLifecycle: { limit: 10, windowSeconds: 60 },
  progress: { limit: 120, windowSeconds: 60 },
  profileHandle: { limit: 10, windowSeconds: 3_600 },
  projectInterest: { limit: 60, windowSeconds: 60 },
  mcpUnauthIp: { limit: 60, windowSeconds: 60 },
  mcpRequest: { limit: 300, windowSeconds: 60 },
  mcpRead: { limit: 120, windowSeconds: 60 },
  mcpValidate: { limit: 30, windowSeconds: 60 },
  mcpConsent: { limit: 10, windowSeconds: 60 },
  mcpAdminBlock: { limit: 10, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SESSION_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const DEVELOPMENT_COOKIE_SECRET = 'vfuture-academy-development-rate-limit-cookie-secret';
const MAX_ANONYMOUS_KEYS_PER_CONNECTION = 16;
const MAX_TRACKED_CONNECTIONS = 1_000;
const ANONYMOUS_KEY_WINDOW_MS = Math.max(
  ...Object.values(RATE_LIMITS).map(({ windowSeconds }) => windowSeconds),
) * 1_000;

/**
 * Stands in for every anonymous visitor at once when the deployment exposes no per-client
 * signal: `TRUSTED_PROXY` is unset and the runtime does not populate `Request.ip`. Buckets
 * keyed by it are shared, so they must never be claimed at a single client's policy.
 */
export const SHARED_CONNECTION_IDENTITY = 'anonymous';

/**
 * Ceiling multiplier for the shared fallback bucket. It matches the number of private
 * session buckets a single connection may hold, so an abuser without a session cookie can
 * consume no more than an abuser holding the maximum number of cookies.
 */
export const SHARED_IDENTITY_LIMIT_MULTIPLIER = MAX_ANONYMOUS_KEYS_PER_CONNECTION;

type AnonymousIdentityWindow = {
  identities: Set<string>;
  startedAt: number;
  lastSeenAt: number;
};

const anonymousIdentitiesByConnection = new Map<string, AnonymousIdentityWindow>();

type RateLimitResult = { data: unknown; error: unknown | null };

export interface RateLimitDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RateLimitResult>;
}

function validPolicy(policy: RateLimitPolicy): boolean {
  return Number.isSafeInteger(policy.limit) && policy.limit > 0
    && Number.isSafeInteger(policy.windowSeconds) && policy.windowSeconds > 0;
}

/** Claims one slot from the shared fixed-window limiter, failing closed on database errors. */
export async function enforceRateLimit(
  database: RateLimitDatabase,
  key: string,
  policy: RateLimitPolicy,
  message = 'Too many requests; try again later',
): Promise<void> {
  if (!key || key.length > 512 || !validPolicy(policy)) {
    throw new TypeError('Rate limit configuration is invalid');
  }
  const result = await database.rpc('rate_limit', {
    key,
    limit: policy.limit,
    window_seconds: policy.windowSeconds,
  });
  if (result.error || typeof result.data !== 'boolean') {
    throw new ApiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Rate limit service is unavailable');
  }
  if (!result.data) {
    throw Object.assign(new ApiError(429, 'RATE_LIMITED', message), {
      headers: { 'Retry-After': String(policy.windowSeconds) },
    });
  }
}

export function userRateLimitKey(scope: string, userId: string): string {
  return `${scope}:user:${userId}`;
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const cookie of request.headers.get('cookie')?.split(';') ?? []) {
    const separator = cookie.indexOf('=');
    if (separator === -1 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

function rateLimitCookieSecret(): string | undefined {
  assertRuntimeEnvironment();
  const configured = process.env.RATE_LIMIT_COOKIE_SECRET?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? undefined : DEVELOPMENT_COOKIE_SECRET;
}

function publicSessionSignature(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('base64url');
}

/** Creates a server-authenticated anonymous session value for Set-Cookie. */
export function createSignedPublicSessionCookie(): string | undefined {
  const secret = rateLimitCookieSecret();
  if (!secret) return undefined;
  const token = `${Date.now().toString(36)}_${randomUUID().replaceAll('-', '')}`;
  return `${token}.${publicSessionSignature(token, secret)}`;
}

/** Returns only the authenticated token portion of the anonymous session cookie. */
export function signedPublicSessionCookie(request: Request): string | undefined {
  const secret = rateLimitCookieSecret();
  const value = cookieValue(request, 'vf_public_session');
  if (!secret || !value) return undefined;
  const separator = value.indexOf('.');
  if (separator === -1 || separator !== value.lastIndexOf('.')) return undefined;
  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!SESSION_TOKEN_PATTERN.test(token) || !SESSION_SIGNATURE_PATTERN.test(signature)) return undefined;
  const issuedAtSeparator = token.indexOf('_');
  const issuedAt = Number.parseInt(token.slice(0, issuedAtSeparator), 36);
  const now = Date.now();
  if (issuedAtSeparator <= 0 || !Number.isSafeInteger(issuedAt)
    || issuedAt > now || now - issuedAt > SESSION_TTL_MS) return undefined;

  const expected = Buffer.from(publicSessionSignature(token, secret), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received) ? token : undefined;
}

function trustedProxyIdentity(request: Request): string | undefined {
  if (process.env.TRUSTED_PROXY !== '1') return undefined;
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && realIp.length <= 64 && !realIp.includes(',')) return `proxy:${realIp}`;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded && forwarded.length <= 64 ? `proxy:${forwarded}` : undefined;
}

function connectionIdentity(request: Request): string | undefined {
  const connectionIp = (request as Request & { ip?: unknown }).ip;
  if (typeof connectionIp !== 'string') return undefined;
  const normalized = connectionIp.trim();
  return normalized && normalized.length <= 64 ? `connection:${normalized}` : undefined;
}

/**
 * Keeps identity bookkeeping bounded: expired windows are exact to drop, and the
 * least-recently-seen entry is evicted only once the map is full. Eviction can reset a
 * connection's churn budget, so the map is sized well above the number of connections a
 * single instance serves inside one window.
 */
function makeRoomForConnection(connection: string, now: number): void {
  for (const [key, tracked] of anonymousIdentitiesByConnection) {
    if (key !== connection && now - tracked.startedAt >= ANONYMOUS_KEY_WINDOW_MS) {
      anonymousIdentitiesByConnection.delete(key);
    }
  }
  if (anonymousIdentitiesByConnection.size < MAX_TRACKED_CONNECTIONS) return;

  let leastRecentlyUsed: string | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;
  for (const [key, tracked] of anonymousIdentitiesByConnection) {
    if (key !== connection && tracked.lastSeenAt < oldestSeen) {
      leastRecentlyUsed = key;
      oldestSeen = tracked.lastSeenAt;
    }
  }
  if (leastRecentlyUsed) anonymousIdentitiesByConnection.delete(leastRecentlyUsed);
}

function boundedAnonymousIdentity(connection: string, session: string, now: number): string {
  let tracked = anonymousIdentitiesByConnection.get(connection);
  if (!tracked || now - tracked.startedAt >= ANONYMOUS_KEY_WINDOW_MS) {
    makeRoomForConnection(connection, now);
    tracked = { identities: new Set(), startedAt: now, lastSeenAt: now };
    anonymousIdentitiesByConnection.set(connection, tracked);
  }
  tracked.lastSeenAt = now;
  if (tracked.identities.has(session)) return `session:${session}`;
  if (tracked.identities.size >= MAX_ANONYMOUS_KEYS_PER_CONNECTION) return connection;
  tracked.identities.add(session);
  return `session:${session}`;
}

export type RequestRateLimitIdentity = Readonly<{
  session: string;
  connection: string;
}>;

/** Resolves both session and network identities while bounding cookie-created buckets. */
export function requestRateLimitIdentity(request: Request): RequestRateLimitIdentity {
  const connection = trustedProxyIdentity(request)
    ?? connectionIdentity(request)
    ?? SHARED_CONNECTION_IDENTITY;
  const session = signedPublicSessionCookie(request);
  return {
    connection,
    session: session ? boundedAnonymousIdentity(connection, session, Date.now()) : connection,
  };
}

/** Produces a stable, non-reversible key for an anonymous request identity. */
export function requestRateLimitKey(scope: string, request: Request): string {
  const digest = createHash('sha256')
    .update(requestRateLimitIdentity(request).session, 'utf8')
    .digest('hex');
  return `${scope}:request:${digest}`;
}

function identityRateLimitKey(scope: string, identity: string): string {
  const digest = createHash('sha256').update(identity, 'utf8').digest('hex');
  return `${scope}:request:${digest}`;
}

/** Scales a per-client policy to the aggregate ceiling of the shared fallback bucket. */
export function sharedIdentityPolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    limit: policy.limit * SHARED_IDENTITY_LIMIT_MULTIPLIER,
    windowSeconds: policy.windowSeconds,
  };
}

/**
 * Resolves which buckets a request must claim, and at which policy.
 *
 * A real per-client connection identity claims both its session and connection buckets at
 * the caller's policy: both keys describe the same client, so either rejection is correct.
 *
 * Without such a signal the connection key is {@link SHARED_CONNECTION_IDENTITY}, held by
 * every anonymous visitor at once. Claiming it at a single client's policy would let one
 * client exhaust it and lock every other visitor out, so instead: a request that owns a
 * churn-bounded private session bucket claims only that bucket, and a request with no
 * private bucket claims only the shared bucket at its scaled aggregate ceiling. Per-client
 * fairness therefore requires a trusted proxy in hosted deployments.
 */
export function requestRateLimitClaims(
  scope: string,
  request: Request,
  policy: RateLimitPolicy,
): ReadonlyArray<{ key: string; policy: RateLimitPolicy }> {
  const { session, connection } = requestRateLimitIdentity(request);
  const hasPrivateBucket = session !== connection;

  if (connection !== SHARED_CONNECTION_IDENTITY) {
    const keys = [...new Set([
      identityRateLimitKey(scope, session),
      identityRateLimitKey(scope, connection),
    ])];
    return keys.map((key) => ({ key, policy }));
  }

  return hasPrivateBucket
    ? [{ key: identityRateLimitKey(scope, session), policy }]
    : [{ key: identityRateLimitKey(scope, connection), policy: sharedIdentityPolicy(policy) }];
}

/** Claims every bucket a request is accountable for; any rejection wins. */
export async function enforceRequestRateLimit(
  database: RateLimitDatabase,
  scope: string,
  request: Request,
  policy: RateLimitPolicy,
  message?: string,
): Promise<void> {
  const claims = requestRateLimitClaims(scope, request, policy);
  await Promise.all(claims.map(
    ({ key, policy: claimed }) => enforceRateLimit(database, key, claimed, message),
  ));
}

/** Clears process-local identity bookkeeping between isolated tests. */
export function resetRequestRateLimitIdentityForTests(): void {
  anonymousIdentitiesByConnection.clear();
}

/** Reports how many connections identity bookkeeping currently retains. */
export function trackedRateLimitConnectionsForTests(): number {
  return anonymousIdentitiesByConnection.size;
}
