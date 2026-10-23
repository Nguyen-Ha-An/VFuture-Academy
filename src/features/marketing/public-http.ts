import {
  SHARED_CONNECTION_IDENTITY,
  SHARED_IDENTITY_LIMIT_MULTIPLIER,
  createSignedPublicSessionCookie,
  requestRateLimitIdentity,
  resetRequestRateLimitIdentityForTests,
} from "@/lib/rate-limit";

export const PUBLIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
/** Applied instead of the shared-cache policy whenever a response mints a session cookie. */
export const PRIVATE_CACHE_CONTROL = "private, no-store";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_BUCKETS = 1_000;
const MAX_NEW_ANONYMOUS_KEYS_PER_WINDOW = 32;
const SESSION_COOKIE = "vf_public_session";

type RequestBucket = { count: number; startedAt: number; lastSeenAt: number };

const requestBuckets = new Map<string, RequestBucket>();
let anonymousKeys = { count: 0, startedAt: 0 };

export interface PublicRateLimitDecision {
  allowed: boolean;
  headers: Headers;
}

function canIssueAnonymousKey(now: number) {
  if (now - anonymousKeys.startedAt >= RATE_WINDOW_MS) {
    anonymousKeys = { count: 0, startedAt: now };
  }
  if (anonymousKeys.count >= MAX_NEW_ANONYMOUS_KEYS_PER_WINDOW) return false;
  anonymousKeys.count += 1;
  return true;
}

type RateLimitClaim = { key: string; limit: number };

/**
 * Mirrors the shared limiter's accounting: a real per-client connection claims both of its
 * buckets at the per-client limit, while the shared fallback bucket — held by every
 * anonymous visitor at once — is claimed only by requests without a private session bucket,
 * and then at its scaled aggregate ceiling so one client cannot lock the catalog for all.
 */
function sessionIdentity(request: Request, now: number) {
  const existing = requestRateLimitIdentity(request);
  const shared = existing.connection === SHARED_CONNECTION_IDENTITY;
  const sharedLimit = RATE_LIMIT * SHARED_IDENTITY_LIMIT_MULTIPLIER;

  if (existing.session !== existing.connection) {
    const claims: RateLimitClaim[] = [{ key: existing.session, limit: RATE_LIMIT }];
    if (!shared) claims.push({ key: existing.connection, limit: RATE_LIMIT });
    return { claims, headers: new Headers() };
  }

  const connectionClaim: RateLimitClaim = {
    key: existing.connection,
    limit: shared ? sharedLimit : RATE_LIMIT,
  };
  const token = canIssueAnonymousKey(now) ? createSignedPublicSessionCookie() : undefined;
  if (!token) return { claims: [connectionClaim], headers: new Headers() };
  const forwardedHttps = process.env.TRUSTED_PROXY === "1"
    && request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
  const secure = new URL(request.url).protocol === "https:" || forwardedHttps ? "; Secure" : "";
  const headers = new Headers({
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  });
  return { claims: [connectionClaim], headers };
}

function makeRoomForBucket(key: string, now: number) {
  if (requestBuckets.has(key)) return;
  for (const [bucketKey, value] of requestBuckets) {
    if (now - value.startedAt >= RATE_WINDOW_MS) requestBuckets.delete(bucketKey);
  }
  if (requestBuckets.size < MAX_BUCKETS) return;
  let leastRecentlyUsed: string | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;
  for (const [bucketKey, value] of requestBuckets) {
    if (value.lastSeenAt < oldestSeen) {
      leastRecentlyUsed = bucketKey;
      oldestSeen = value.lastSeenAt;
    }
  }
  if (leastRecentlyUsed) requestBuckets.delete(leastRecentlyUsed);
}

export function checkPublicRateLimit(request: Request): PublicRateLimitDecision {
  const now = Date.now();
  const session = sessionIdentity(request, now);
  const { headers } = session;
  const strictestByKey = new Map<string, number>();
  for (const { key, limit } of session.claims) {
    strictestByKey.set(key, Math.min(strictestByKey.get(key) ?? limit, limit));
  }
  const decisions = [...strictestByKey].map(([key, limit]) => {
    const bucket = requestBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
      makeRoomForBucket(key, now);
      requestBuckets.set(key, { count: 1, startedAt: now, lastSeenAt: now });
      return true;
    }

    bucket.count += 1;
    bucket.lastSeenAt = now;
    return bucket.count <= limit;
  });
  return { allowed: decisions.every(Boolean), headers };
}

/** Clears process-local limiter state between isolated tests. */
export function resetPublicRateLimitForTests() {
  requestBuckets.clear();
  anonymousKeys = { count: 0, startedAt: 0 };
  resetRequestRateLimitIdentityForTests();
}

export function applyPublicResponseHeaders(
  response: Response,
  decision: PublicRateLimitDecision,
  { cache = false }: { cache?: boolean } = {},
) {
  decision.headers.forEach((value, name) => response.headers.append(name, value));
  // A response that mints an anonymous session cookie must never be stored by a shared
  // cache: replaying it would hand one visitor's token, and their limiter bucket, to
  // everyone who is served the cached copy.
  const mintsSession = response.headers.has("set-cookie");
  if (mintsSession) response.headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
  if (cache) {
    response.headers.set(
      "Cache-Control",
      mintsSession ? PRIVATE_CACHE_CONTROL : PUBLIC_CACHE_CONTROL,
    );
  }
  return response;
}
