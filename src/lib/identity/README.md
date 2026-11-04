# Academy Azure identity contract

This implementation is dormant while both backend selectors are absent or set to `supabase`. Azure requires `ACADEMY_BACKEND=azure` and `NEXT_PUBLIC_ACADEMY_BACKEND=azure` together. Set the public selector at build time and rebuild before cutover. A disagreement fails closed. This source implementation is not evidence of a configured customer tenant, provider federation, delivered email, or a successful hosted login.

## Configuration

| Variable | Contract |
| --- | --- |
| `ENTRA_TENANT_ID` | Customer tenant UUID; never `common`, `organizations`, or the grant subscription tenant by assumption. |
| `ENTRA_CLIENT_ID` | Web application UUID in that customer tenant. |
| `ENTRA_CLIENT_SECRET` | Confidential web application credential, server-only; record its actual policy-permitted expiry separately. |
| `ENTRA_AUTHORITY` | HTTPS tenant-specific v2.0 authority, without a trailing slash. Discovery is loaded from `/.well-known/openid-configuration` below this path. |
| `ENTRA_ISSUER` | Exact issuer returned by the reviewed tenant discovery document. No wildcard or template issuer. |
| `ENTRA_SESSION_ENCRYPTION_KEY` | Base64 encoding of 32 cryptographically random bytes, stored as a server-only secret. Separate from the PostgREST signing secret. |
| `ENTRA_SESSION_MAX_AGE_SECONDS` | Optional absolute application-session bound, 3600–86400 seconds; default 86400. Access-token expiry is still enforced and refreshed independently. |
| `ENTRA_GOOGLE_DOMAIN_HINT` | Legacy setting. The adapter uses the observed case-sensitive `Google` key, including when older deployments still contain `google.com`. |
| `MICROSOFT_ENTRA_TENANT_ID` | Required for internal Microsoft sign-in; must equal approved workforce tenant `157419c9-2de9-45e7-a6f9-91546dbef629`. Other tenants, personal accounts and `common` are rejected. |
| `MICROSOFT_ENTRA_CLIENT_ID` | Separate, single-tenant workforce application UUID. Must differ from `ENTRA_CLIENT_ID`. |
| `MICROSOFT_ENTRA_CLIENT_SECRET` | Confidential workforce application credential, server-only. |
| `NEXT_PUBLIC_APP_URL` | Canonical HTTPS application origin. Local development permits HTTP only on localhost. |

Register exactly `NEXT_PUBLIC_APP_URL` + `/auth/callback` as the Web redirect URI and `/login` as the post-logout redirect URI. Attach the sign-up/sign-in user flow to the application. Enable email/password, Google, self-service password reset, and the required ID-token claims including `oid` (tenant object UUID). The application requests `openid profile email offline_access`. Native credentials require the existing app's public-client and Native Authentication capabilities and basic OIDC consent. Existing Web callback URIs and API permissions remain unchanged.

Email/password login, signup verification and password recovery run inline through same-origin `POST /api/v1/public/auth/native`. Passwords and verification codes pass over the server's HTTPS back channel to the documented native API and are never persisted or logged. ID/refresh tokens remain server-only. The server verifies signature, exact issuer, tenant, audience and lifetime before issuing the existing opaque HttpOnly session. Successful native signup OTP verification supplies explicit email-verification evidence; an absent `email_verified` claim is not otherwise treated as true. Existing email collisions still refuse automatic linking.

Continuation payloads are encrypted with attempt/handle/browser binding, expire after ten minutes, and use the existing atomic transaction RPC. A separate HttpOnly proof cookie per attempt isolates tabs; continuation responses never overwrite newer proof cookies. The browser receives only non-authenticating IDs and UI steps. Cross-origin or non-JSON requests, oversized input and attempts beyond the shared rate limit fail before provider access. Unsupported redirect challenges fail inline instead of opening a Microsoft password page.

Native refresh credentials carry an encrypted version marker so the worker uses public-client refresh without a client secret. Existing confidential OAuth/workforce refresh retain their original credentials and lease/version fencing. Registered email MFA follows introspection and method selection before an OTP challenge; SMS-only or registration-required methods are not enabled by this change. Recovery normalizes account-existence metadata and respects provider polling intervals and pending states. It signs out the requesting browser; immediate all-device Academy session revocation remains outside this change. Other existing sessions retain their previous provider-token expiry/refresh boundary.

Google and email/password are normal public sign-in options. Google has no application-level email-domain restriction. Microsoft is a separate internal staff flow, not an External ID federation option. Register its application in the approved workforce tenant as single-tenant (`AzureADMyOrg`) with the same `/auth/callback` Web redirect URI. Its authority and exact issuer are pinned to `https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0`; there is no configurable common authority. Discovery/JWKS/token/logout endpoints must remain on `https://login.microsoftonline.com`. The login transaction records the chosen provider server-side; callback query parameters cannot change it.

Microsoft documents [customer authentication methods and federation hints](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-authentication-methods-customers), [tenant-specific issuer validation](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validate-the-issuer), and [customer password reset](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-enable-password-reset-customers).

## Popup interaction

Only Google and internal Microsoft open a named popup directly inside the user's click handler. Credentials, signup and recovery use the inline Academy form. The parent stays on its current page if opening is blocked, sign-in is cancelled, the session cannot be verified, or the attempt expires; it never falls back to a top-level provider redirect. Buttons expose pending status and explicit cancellation. The legacy Supabase Google/Microsoft buttons use the same popup controller, while existing direct password forms remain available.

Each popup gets a cryptographically random, non-authenticating 192-bit correlation ID. Azure stores it inside the browser-bound, one-use login transaction. The callback ignores caller-supplied completion IDs and sets the HttpOnly session cookie before sending the popup to the same-origin completion page. Legacy Supabase uses server-generated PKCE plus a signed HttpOnly popup-context cookie; its authorization code remains single-use and the display context is consumed on callback. Callback responses never clear shared current-attempt cookies, because an older response may arrive after a retry. Azure consumes its database transaction and retains the login cookie until rotation, logout or its ten-minute expiry. Legacy display-context consumption clears only a marker keyed by the validated state; a new start supersedes the old marker. A stale or bogus callback cannot delete the newer attempt’s cookie.

Completion messages contain only an outcome and correlation ID. The parent requires the exact application origin, original window reference and current attempt for `postMessage`. An attempt-specific same-origin `BroadcastChannel` handles providers whose COOP policy removes `window.opener`; stale attempts cannot complete a new one. The parent independently calls the protected session endpoint before navigating through onboarding to the sanitized return path. It does not treat an existing session, a closed window, or an unmatched message as completion.

A popup closes after a matching parent acknowledgement. With no listening opener/channel, it leaves instructions to return to Academy manually. A window that appears closed may have been isolated by a provider, so its matching channel remains available while the parent offers retry. Authentication pages alone use `Cross-Origin-Opener-Policy: same-origin-allow-popups`; notebook isolation and the application CSP remain intact.

Local real-browser contracts are isolated from hosted services and credentials:

```
npx playwright test --config tests/e2e/auth-popup.config.ts
```

They exercise the production popup controller/completion code with a simulated local provider and session endpoint, including provider COOP, cancellation, blocked windows and stale completion with a pre-existing session. They do not establish hosted Google/Microsoft consent or cookie behavior.

## Identity mapping and migration

`academy_identity.mappings` maps the verified `(issuer, oid)` pair to the existing Academy `users.id` UUID. Using `oid` avoids pairwise `sub` differences between web and MCP token audiences. `findIdentityUser(issuer, objectId)` is read-only and never provisions users. Public External ID registration calls `resolveIdentityUser` only after server-side signature, issuer, tenant, audience and lifetime validation. OAuth requires the transaction nonce; native credentials instead use the browser-bound server back channel and one-use continuation state. Internal Microsoft callbacks instead call `findMicrosoftStaffUser`: a pre-existing exact workforce `(issuer, oid)` mapping and an active account with a current effective staff permission are mandatory. Eligibility uses the current `role_assignments` / `role_definitions` model through `authorization_has_permission`, including branch membership suspension; a bare role name or matching email cannot admit an account. Microsoft never provisions an Academy user, links by email, or grants a role. Session reads recheck this eligibility, so suspending the account or withdrawing staff permissions blocks an existing Microsoft session immediately.

Before migrating existing accounts, create/recover the intended external tenant accounts and import an operator-reviewed mapping of their Entra object IDs to existing Academy UUIDs. Review the identity manifest outside Git and reconcile it against the tenant. Existing mappings win even if email or display name changes. Disabled or deleted identities are rejected on lookup, session creation and session reads, and cannot be silently reprovisioned from their existing mapping. An unmatched verified email that collides with an existing Academy user fails closed; it never links accounts. Unverified email is discarded for new accounts. Entra must emit the boolean `email_verified=true` before this application persists a new email address. Hosted claim configuration and migration mapping are release gates.

Existing internal staff require an explicit reviewed workforce-object mapping in addition to any External ID mapping. The same internal UUID may have both mappings when the operator has verified ownership. This does not merge or auto-link identities.

Apply `schema.sql` after the transformed owned migrations using the schema builder. Only the server service role can call identity RPCs; learner tokens cannot read mappings, login transactions or encrypted refresh credentials. Application runtime reaches these RPCs over PostgREST, not a direct private PostgreSQL connection. New identity inserts retain the existing profile/account triggers; `/welcome` decides whether onboarding is needed and preserves the validated return path.

## Sessions and recovery

The browser receives only random 256-bit HttpOnly, SameSite=Lax, host-only cookies (`__Host-` and Secure in production). Lax is necessary for the cross-site OIDC callback. Login transactions expire after ten minutes and are atomically consumed only with the matching browser cookie. Provider state, nonce and PKCE verifier are generated independently. Session identifiers are hashed in the database. A sign-in replaces and revokes the previous session.

Every authenticated server read checks database revocation and expiry. At access-token expiry, the server redeems the AES-256-GCM encrypted refresh token, validates the same issuer, tenant, audience, original OIDC subject and object ID, and rotates the stored credential under a database refresh lease. The lease has a random owner token and a 45-second expiry; rotation, rejection-triggered revocation and release all check the version, owner and unexpired lease. A losing server instance polls for up to 9.5 seconds, with a ten-second total database-read deadline, for the owner to commit and reloads the updated session. A timeout reports temporary unavailability without revoking the session. Refresh ciphertext is bound to both provider and session hash. Every refresh selects the original stored provider's confidential application; issuer, object ID and pairwise subject must remain unchanged. Provider changes cannot relabel an encrypted grant. An expired or losing refresh worker cannot rotate credentials, release a successor lease or delete its session, even before the successor commits. Transient network failures release the active lease without revoking the session. A rejected grant revokes its session and requires sign-in; a provider/storage outage fails authentication rather than accepting expired credentials. Absolute session expiry requires sign-in even after successful refresh. No provider token is sent to the browser.

POST logout checks browser origin, revokes the local session, clears cookies and redirects to provider logout. Provider logout availability does not prevent local revocation. Staff pages recheck the server actor on focus and every fifteen visible seconds. Existing server-side account and permission checks remain authoritative.

Discovery and signing keys have bounded caches, coalesced fetches and five-second failure backoff. Expired cached material is never used after a failed fetch. Signing-key rotation can take up to sixty seconds to become visible locally. Provider redirects and token endpoints must use the configured authority's HTTPS origin.

Key rotation requires an explicit plan: revoke existing session rows before replacing the encryption key, then require reauthentication. Do not copy refresh tokens, passwords, session cookies, state records or credentials into migration receipts, logs or Git.

## Local evidence and hosted gates

Focused tests cover signed-claim rejection, PKCE/navigation, encryption binding, refresh continuity/identity rejection, browser-bound callbacks, hosted UI, and legacy auth behavior. Run the PostgreSQL semantics suite with `PGLITE_MODULE_PATH` pointing to a local `@electric-sql/pglite` installation:

```
PGLITE_MODULE_PATH=/absolute/path/to/@electric-sql/pglite npx vitest run tests/scripts/azure-identity-schema.test.ts
```

Its default skip without that external runtime is not a passed release gate. The suite checks one-use state, preserved UUIDs, refusal to auto-link emails, profile creation, session revocation/version checks, lease-owner and expiry fencing, and learner ACL denial. Independent-worker promise interleaving tests hold a successful refresh before its database commit while a second worker attempts refresh; only the lease owner redeems the grant. It does not establish simultaneous hosted transactions, network behavior, tenant claim configuration, password reset, federation, branded email delivery or long-exam continuity. Verify those flows in the hosted rehearsal before activating Azure, followed by Graphify and the complete repository local verifier.

## Google visible branding

The exact `Google` issuer hint skips the Microsoft provider chooser. It does not change the Google callback host, which remains the configured Entra CIAM federation endpoint. Google falls back to the application domain when app branding is unverified; app-name/logo verification is a separate Google configuration/review step. An Academy-owned callback hostname requires a custom identity domain or direct Google callback design. Do not claim that issuer acceleration alone removes CIAM branding.
