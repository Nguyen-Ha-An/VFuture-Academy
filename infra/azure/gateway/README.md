# Academy private-service gateway

This dependency-free Node 24 process listens on `0.0.0.0:8080` inside the Docker
network. The TLS ingress is the only public listener. `runtime/compose.json`
assigns 160 MiB to Node and 32 MiB to Nginx, with a 96 MiB V8 old-space ceiling.
These are enforced deployment limits, not a claim of demonstrated hosted capacity.

## Configuration and first start

Required process configuration:

| Variable | Contract |
| --- | --- |
| `SUPABASE_GATEWAY_KEY` | Independent server-only secret, at least 32 UTF-8 bytes. Never `NEXT_PUBLIC`. |
| `GATEWAY_TRANSFER_GRANT_KEY` | Independent transfer-signing secret, at least 32 bytes. Same secret value as the app's `SUPABASE_TRANSFER_GRANT_KEY`. |
| `GATEWAY_AUTH_URL` | Fixed private origin, normally `http://auth:9999`. |
| `GATEWAY_REST_URL` | Fixed private origin, normally `http://rest:3000`. |
| `GATEWAY_STORAGE_URL` | Fixed private origin, normally `http://storage:5000`. |
| `GATEWAY_STATE_DIR` | Writable persistent data-disk directory, normally `/state`. |
| `GATEWAY_MAINTENANCE_FILE` | Read-only control-file path, normally `/control/maintenance.json`. |
| `GATEWAY_ALLOWED_ORIGINS` | Comma-separated exact HTTPS app origins. Empty permits no browser CORS origins. |
| `GATEWAY_TRUSTED_PROXY_IP` | Exact Nginx container IP. Only that socket peer may supply a single valid `X-Forwarded-For` IP. |

The upstream URL cannot contain credentials, a path, query or fragment. Each
hostname must equal its fixed service name, or be a private IPv4 address. Request
parameters cannot select an upstream. Service prefixes are removed when proxying
(`/auth/v1/user` becomes `/user`). Postgres, Studio, metadata and arbitrary paths
have no route through this gateway.

Use the host runbook's explicit `--initialize-state` first-run command. At the
process level this is `GATEWAY_STATE_DIR=/state node /app/server.mjs
--initialize-state`. Initialization creates a new checksummed ledger and refuses
to overwrite an existing one. Normal start is `node /app/server.mjs` and fails
closed when configuration or the persisted ledger is absent or invalid. Missing
maintenance state makes admissions return 503. No public management or health
HTTP endpoint exists; a TCP probe can check process liveness.

A filesystem lock enforces one ledger writer. Graceful shutdown removes it. A
crash intentionally leaves the lock and prevents an automatic second writer.
For recovery, stop the gateway service, confirm no gateway process still uses the
state mount, verify the ledger's checksum and preserve a copy, then remove only
`ledger.lock` and restart. Never reinitialize or restore an older ledger merely
to clear a startup error. A historical backup may undercount the current month's
usage and requires an operator's conservative reconciliation before admission.

## HTTP admission and credentials

Public access is limited to the specific Auth method/path pairs in
`AUTH_METHODS` and granted signed Storage transfers. Browser REST/RPC, public
Storage objects and Auth administration are denied. Trusted server REST and Auth
administration require both the gateway secret and an ordinary Bearer credential;
upstream Auth/PostgREST/Storage still decide identity, role, RLS and RPC permission.
Trusted server object GET/HEAD and POST/PUT routes, including the authenticated
object alias, support notebook/media finalization and certificate uploads. They
share global transfer slots and monthly/site quotas; per-user authorization and
object reservations remain the app's responsibility. Public direct-object access
remains denied.
`Origin`, an anon key, forwarded identity headers and unverified JWT claims do
not grant server authority.

Only allowlisted protocol headers cross the service boundary. The gateway secret,
transfer grant, user/role headers, original-URL headers and arbitrary forwarded
headers are stripped. Nginx must overwrite `X-Forwarded-For` with its actual
client address, never append to a client value. The gateway forwards that value
only from its configured proxy socket. Both proxy access logs and request/error
logging must avoid tokens and URL queries; this Node process logs no requests.

Paths must contain canonical `encodeURIComponent` segments. Encoded spaces and
UTF-8 filenames work; encoded unreserved characters, encoded separators,
double-encoding, backslashes, dot segments, duplicate separators, fragments,
trailing slashes and ambiguous repeated query keys are rejected. After server-key
verification, REST column predicates and logical `or`/`and` filters may repeat,
as required by the installed PostgREST SDK. Control parameters such as `select`,
`token`, `gateway_grant` and `grant_type` stay single-valued, and no repeated-key
exception exists for Auth or Storage. Unknown path/method pairs
are denied. Request compression and Range requests are unsupported. The gateway
never follows redirects. Server-lane redirect responses are converted to 502 so
an SDK cannot replay server credentials at another destination. Ordinary upstream
status codes, including 401/403 and nonredirecting 304, remain authoritative.

Auth bodies alone may be buffered, capped at 64 KiB. Other requests and responses
stream with backpressure. REST bodies/responses are capped at 4 MiB, allowing RPC and database response
wrapping around the existing 2 MiB workspace envelope without widening the
business document limits. The 4 MiB transport ceiling remains below Vercel's
4.5 MB limit. Uploads are
capped by the verified grant and an absolute 50 MiB ceiling. Trusted server
object uploads support 50 MiB raw bodies or 50 MiB plus at most 64 KiB multipart
framing; Storage's `FILE_SIZE_LIMIT=52428800` still bounds the actual object.
Trusted object downloads stream up to 50 MiB and charge actual body bytes to the
site daily limit before forwarding. These transfers are not buffered by the
gateway. Nginx must allow exactly `51264k` total input to pass maximum-size SDK
multipart uploads without weakening Storage's object-size limit. Ordinary requests
have a 20-second total deadline, leaving headroom before the app client's
30-second timeout; transfers retain 120 seconds. Queued and slow-body
requests have cancellation and deadlines, and disconnects release their slots.

## Transfer grants

The app appends this query parameter to an ordinary Supabase signed Storage URL:

```text
gateway_grant = base64url(JSON payload) + "." +
                base64url(HMAC-SHA256(payloadSegment, transferSigningSecret))
```

Payload:

```json
{
  "v": 1,
  "aud": "vfuture-storage-transfer",
  "sub": "the authenticated viewer's UUID",
  "jti": "a unique UUID or 16-128 character base64url identifier",
  "method": "GET",
  "path": "/storage/v1/object/sign/bucket/canonical%20object.pdf",
  "maxBytes": 1048576,
  "exp": 1800000000
}
```

`exp` is an integer Unix timestamp after admission time and at most 900 seconds
in the future. The HMAC is checked before any identity is used. Exact method,
canonical full path, maximum bytes and expiry are bound. Downloads use `GET`;
`HEAD` may reuse a GET grant. Uploads use `PUT`/`POST` and an
`/storage/v1/object/upload/sign/...` path. The ordinary Supabase `token` remains
required and is checked by Storage; the gateway grant cannot bypass it.

A trusted app may sign `sub: "public"` only for downloads after checking public
visibility. That subject receives site/global limits, without pretending to be a
user. Every other subject must be a UUID. Uploads always require a UUID. The
signing key is separate from the server transport key and is never exposed to the
browser; only the narrow grant is exposed.

The grant is removed before forwarding. Upload grants are consumed persistently
at admission, including failed transfers. A retry needs a fresh grant associated
with the app's existing atomic reservation. Downloads allow at most four GET
admissions per grant; each admission reserves its full `maxBytes` against daily
quotas, including failures. HEAD consumes neither a GET use nor daily download
bytes, but still uses global request/concurrency and monthly response allowances.
The UI must request a fresh URL after four attempts or expiry. Range/resume is
not supported by this first implementation; whole-file retries require a fresh
URL after exhaustion. Cached browser responses do not contact the gateway.

Gateway limits are one upload per verified user, four uploads globally, ten
upload admissions per user per minute, four downloads per verified user, sixteen
downloads globally, 100 MiB download reservations per user/day, and 2 GiB per
site/day. Public grants share the site/global limits. Each download is at most
100 MiB. Replay records expire after the grant plus a 60-second retention margin;
replay, user and reservation maps are bounded to 10,000 entries and fail closed
at their limits. The gateway does not create SQL object reservations or validate
stored ownership; the app's authorization and quota reservation/finalization
remain required. Existing exam/quiz database rate limits also remain required.

## Persistent budgets and telemetry

All accepted responses reserve a 64 KiB chunk and 16 KiB protocol allowance on
disk before contacting the backend. Further stream chunks reserve bytes before
forwarding, including a conservative per-chunk framing allowance. Rejected
responses consume only the discretionary allowance unless they belong to a
trusted critical operation. Once that allowance is exhausted the noncritical
socket is closed, preserving the critical reserve. All requests, including
malformed requests, consume global admission tokens; rejection responses have a
separate bounded rate to avoid unbounded persistence work.
Reservations are deliberately not refunded. Counters, upload reservations, replay
uses, email quotas and recipient cooldowns survive graceful restarts. Writes use
fsync, atomic rename and directory fsync. Any persistence failure closes admission.
The ledger checksum detects corruption; it is not an authorization boundary for a
malicious operator who can edit the state volume.

Monthly reserved outbound thresholds are 40 GB warning, 45 GB discretionary stop,
and 50 GB full stop, using decimal GB. At 45 GB only the exact critical operations
below may consume the remaining reserve. User/site download limits use binary MiB
and GiB and UTC day boundaries. Month changes preserve the global sequence.

`/state/telemetry.json` is atomically published at startup, every ten seconds and
on graceful close. Each publication advances and persists its sequence even if
traffic is idle. Fields are `version`, `period`, `observedAt`, `sequence`,
`monthlyOutboundBytes`, `activeRequests`, `queuedRequests`, `warning` and
`discretionaryStop`. The host collector adds its validated VM resource ID and a
billing-based pending-variable-cost estimate; the gateway cannot infer dollars.
Do not publish `ledger.json`, which includes hashed quota/replay identities.

These counters conservatively bound gateway responses, not every byte charged by
Azure. TLS ingress rejections, host traffic, backups and updates need VM/network
meter monitoring and cost-guard reserves. No hard zero-overrun dollar guarantee is
implied. Email reservations enforce 100/hour, 200/day, 2,000/month and a 60-second
recipient cooldown for signup, recovery and OTP requests, and reserves two
deliveries for email-change requests because pinned GoTrue defaults to confirmation
at both the old and new addresses. Optional changed-email/password notifications
must remain disabled or the envelope must be revised. Auth
JSON must be an object, and case-insensitive aliases such as `Email` or mixed
`email`/`EMAIL` are rejected before forwarding because GoTrue's Go JSON decoder
otherwise treats those as email fields while JavaScript does not. The upstream Auth
service's account, login, SMTP and abuse controls remain required.

## Maintenance and existing exams

Read-only control-file contract:

```json
{
  "version": 1,
  "mode": "normal",
  "updatedAt": "2026-10-25T12:00:00.000Z",
  "expiresAt": "2026-10-25T12:15:00.000Z"
}
```

Allowed modes are `normal`, `discretionary-stop` and `drain`. Expiry must follow
update time by no more than fifteen minutes. Missing, malformed, future-dated
beyond 30 seconds of clock tolerance, or expired control fails closed. The cost
guard refreshes every five minutes; the host poller atomically replaces the file.
Origin-validated Auth preflights classify the requested method and query too,
so refresh/user/logout preflights can use the critical reserve after 45 GB. Their
own bounded Auth preflight rate avoids consuming the 25-login burst twice.
For financial shutdown with active exams, the controller may include
`drainReason: "financial"`, `financialRequestedAt` and `drainAfter`. During that
fixed grace window the effective mode is discretionary-stop; at `now >= drainAfter`
the gateway locally treats it as full drain without waiting for the five-minute
controller timer. The deadline must follow the request time by no more than
120 seconds. Missing/invalid grace fields fail closed. Refreshing `updatedAt` or
`expiresAt` cannot extend this deadline; the controller must persist the original
request/deadline pair. Ordinary90% discretionary controls have no financial-grace
fields. Immediate full financial drains need no grace deadline.

Other cost-guard fields, such as stable checkpoint identifiers, are ignored by
request routing. Queued requests reread the control before reaching a backend.
Already admitted work has bounded time to complete; drain blocks every new request.

Discretionary-stop preserves:

- Auth `POST /token?grant_type=refresh_token`, `GET /user`, and `POST /logout`.
- Trusted, bounded REST GET/HEAD reads, covering account suspension, enrollment,
  membership, actor/profile lookup, current attempt and answers.
- Trusted POST RPCs `exam_save_active_answers`, `exam_finalize_attempt`,
  `exam_append_attempt_events`, `rate_limit`, `authorization_actor`,
  `xp_update_streak` and `learner_complete_course`.
- Trusted POST writes to `exam_grades`, `skill_evidence`, `xp_events` and
  `lesson_progress`, which the current exam submission flow uses after finalization.

New exam starts, signup/recovery email, transfers and other writes are blocked.
`learner_complete_course` leaves the existing durable completion-effect record;
`learner_claim_completion_effect` stays blocked so certificate generation/upload
is deferred. After return to normal, use the existing bounded reconciliation path
to drain those pending effects and prove certificate/progress consistency. The
focused gateway tests check deferred admission, not live queue reconciliation or
an actual SQL/database flush. Analytics remain best effort and are blocked during
a discretionary stop. The gateway never fabricates a checkpoint or backup receipt.

## Local evidence and remaining release gates

Run `npx vitest run tests/infra/azure-gateway.test.ts` for real loopback HTTP
integration tests with temporary persistent state and fake upstream servers. The
suite checks paths, forged identity, actual app grants, installed Supabase SDK
upload/download and repeated REST predicates, 5/10/50 MiB streaming, bounded
maximum-size multipart framing, Auth alias/quota bypasses, quotas, school NAT bursts,
queue cancellation, slow clients, stream limits, redirects, restarts, single-writer
protection, monotonic telemetry and maintenance dependencies. Run ESLint and Node
syntax checks for this directory as well.

The root release owner must then run Graphify refresh/check and `verify:local`
after all repository edits. Hosted TLS/Auth/OAuth/SMTP/Storage compatibility,
restricted service networking, 25-user exam load, CPU-credit exhaustion, memory
ceilings, pool saturation, grant retry UI, quota recovery, billing meters, pending
completion reconciliation and a timed restore remain separate deployment gates.
