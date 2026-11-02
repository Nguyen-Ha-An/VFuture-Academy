# Studio MCP with Microsoft Entra External ID

Status: implementation and local tests only. No hosted Microsoft client, tenant grant, redirect registration, token refresh, or end-to-end MCP connection has been verified by this change. Keep `STUDIO_MCP_ENABLED=0` until the release gate below passes. Supabase remains the default provider; Azure requires both `ACADEMY_BACKEND=azure` and `NEXT_PUBLIC_ACADEMY_BACKEND=azure` in the build and deployed runtime.

## Supported flow

The supported Azure protocol is an administrator-registered OAuth client using authorization code + PKCE to obtain a **delegated v2 API access token** for the Studio API. The client sends that access token in `Authorization: Bearer …` to the configured MCP endpoint. Microsoft hosts authentication and manages permission grants. The Academy web login session and its ID token are not MCP credentials.

There is no dynamic client registration endpoint or Supabase OAuth client lookup in Azure mode. A client must accept an existing Microsoft client ID, exact registered callback, API scope, and the Microsoft authorization/token endpoints. Confidential clients additionally need their own securely held client credential; never give them Academy's web-login client secret. A DCR-only MCP client is unsupported. ChatGPT, Claude, Claude Code, and any other specific product remain unverified until their current connection settings and full flow pass the gate; generic client instructions on the legacy page are not evidence of Azure support.

Microsoft documents [authorization code with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [custom API delegated permissions in external tenants](https://learn.microsoft.com/en-us/entra/external-id/customers/overview-solutions-customers), and [API claim validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation).

## Register the API and clients

1. In the approved **external customer tenant**, register the Studio API separately from the Academy web-login application. Set its requested access-token version to `2`. Expose the delegated scope `Studio.Read` under `api://<studio-api-application-id>`. Record the API application's GUID, not an enterprise application's object ID.
2. Register each approved MCP client in that tenant with its exact callback URI(s) and appropriate public/confidential application type. For public clients require authorization code with PKCE (`S256`); for confidential clients also apply their credential policy. Associate the client with the approved customer user flow where required by the tenant configuration. Review every redirect; the application's old Supabase callback allowlist is not applied to Microsoft registrations.
3. Add the Studio API delegated permission to each registered client and grant tenant-admin consent where required. Record the client application GUID(s) in the application allowlist below. Do not configure an application-only permission as a substitute for delegated user access.
4. Use the tenant's published OIDC discovery document to record the exact token issuer, authority, authorization endpoint, token endpoint, and JWKS endpoint. Set `ENTRA_ISSUER` to the issuer actually returned by discovery and signed tokens. Do not synthesize it from the Academy website domain. This implementation uses HTTPS discovery at `<ENTRA_AUTHORITY>/.well-known/openid-configuration` and requires discovery's issuer to match; endpoint hosts must pass the identity adapter's checks.
5. Configure the client with its own client ID and callback, the discovered authorization/token endpoints, and `api://<api-guid>/Studio.Read`. Request `offline_access` only if the client requires refresh tokens and the tenant permits it. The authorization request must carry unpredictable `state`, `response_type=code`, the exact `redirect_uri`, and a PKCE S256 challenge; the client exchanges the code with the corresponding verifier. Microsoft enforces registered callbacks and issues the token. The MCP server does not proxy authorization or code exchange.
6. Ensure the existing Academy user has an approved identity mapping from `(issuer, Microsoft oid)` to its stable Academy UUID. MCP lookup never provisions accounts and never links by email. First finish the identity migration/rehearsal and normal hosted sign-in; an unmapped API identity receives `ACCOUNT_NOT_PROVISIONED`.

## Application configuration

| Setting | Contract |
| --- | --- |
| `ENTRA_TENANT_ID` | Exact external customer-tenant GUID, shared with web identity. |
| `ENTRA_ISSUER` | Exact HTTPS issuer from the configured tenant's discovery document. |
| `ENTRA_AUTHORITY` | HTTPS authority for OIDC discovery, shared with web identity. |
| `STUDIO_MCP_ENTRA_AUDIENCE` | Studio API application GUID. Entra v2 access-token `aud` must be this single string. |
| `STUDIO_MCP_ENTRA_SCOPE` | Fully qualified delegated scope, e.g. `api://<same-api-guid>/Studio.Read`. The configured URI is advertised in protected-resource metadata; the token's space-separated `scp` must contain the exact final scope name. |
| `STUDIO_MCP_ENTRA_ALLOWED_CLIENT_IDS` | Nonempty comma-separated client application GUIDs. Signed token `azp` must match an entry; no wildcard or dynamic lookup. At most 100 clients. Removing an entry and redeploying denies that client, including its already-issued tokens. |
| `AZURE_POSTGREST_URL`, `AZURE_POSTGREST_JWT_SECRET` | Server-only Azure data transport settings. MCP constructs the service-role PostgREST client inside its existing read-only facade; neither raw clients nor external Microsoft tokens are passed to tools. |
| Existing MCP settings | Preserve `MCP_RESOURCE_URL`, `MCP_ALLOWED_ORIGINS`, optional `MCP_TESTER_USER_IDS`, `STUDIO_MCP_PREPARATION_PROOF_SECRET`, and `STUDIO_MCP_ENABLED` from [operations](mcp.md). `MCP_SESSION_CHECK` remains absent or `1`; any other value still fails closed. |

Protected-resource metadata advertises the configured Entra issuer and the fully qualified delegated API scope. It never advertises Supabase under Azure. Missing or invalid registration configuration returns 503 and withholds setup. `STUDIO_MCP_ENABLED=0` hides both MCP and metadata with 404.

## Enforcement and revocation

Each exchange verifies an RS256 signature against the configured issuer's discovered keys and validates exact issuer, tenant, API audience, token version `2.0`, allowed client (`azp`), delegated scope, object ID, issued-at, not-before, and expiration. App-only tokens without `scp`, web ID-token audiences, multiple audiences, unknown clients, forged signatures, and unmapped identities are rejected. Application permissions, the MCP tester gate, per-account access block, rate limit, and current suspension status are still checked on every exchange.

Microsoft access tokens do not have Supabase `session_id` or Supabase live `getUser` introspection. `MCP_SESSION_CHECK=1` does **not** claim Microsoft token introspection or instant tenant-side grant revocation. A Microsoft grant/session change may leave an issued access token usable until expiry. Do not increase token lifetime for the migration.

For immediate Academy MCP denial, use the current `/admin/mcp` account block; this is checked again on the next request. For a compromised client remove its GUID from the deployment allowlist and redeploy, or globally set `STUDIO_MCP_ENABLED=0` and redeploy. Separately review and revoke the actual Microsoft grant/registration in the customer tenant. Tenant-wide grant removal can affect every user of that client; inspect scope before applying it. Blocking Studio MCP does not revoke a Microsoft token or prevent its use at another resource that accepts it.

`/account/connected-apps` explains that Microsoft manages the connection and directs the user to the Academy administrator. It does not display a fabricated empty grant list. The legacy grant-revoke API returns `409 MICROSOFT_MANAGED_GRANTS` in Azure mode. `/studio/connect/authorize` explains that authorization starts in the registered Microsoft client; the legacy consent mutation returns `409 MICROSOFT_MANAGED_CONSENT`. These routes cannot approve or revoke Microsoft grants. The existing Supabase behavior remains available only under the legacy provider.

## Hosted release gate

Use a restricted tester rollout first. Record the deployment SHA, tenant/API/client IDs, exact redirect registrations and scope, and test timestamps without recording credentials, codes, refresh tokens, or access tokens.

- Verify issuer/JWKS discovery, API scope and audience, unauthenticated 401 challenge, authorization-code + PKCE exchange, `whoami`, role-specific `tools/list`, a permitted course read, and a denied foreign-owner course.
- Verify a migrated account keeps the same UUID and permissions across web login and MCP despite their different pairwise `sub` claims. Verify an unmapped account is denied.
- Reject wrong-audience, app-only, expired, wrong-tenant, and unallowlisted-client tokens. Verify an invalid registered callback never receives an authorization code.
- Reuse a previously valid access token after applying an Academy MCP block and after suspending the account; both must deny the next call. Exercise role withdrawal. Record Microsoft grant-revocation and refresh behavior separately, including any access-token lifetime window.
- Confirm read-only tool behavior and no content changes; Azure reads must reach PostgREST, never public/direct PostgreSQL. Test a data-service outage, identity lookup outage, and discovery outage fail closed without credentials in responses or logs.
- Verify each intended MCP client can use registered credentials, request the configured API scope, refresh/reconnect, and handle denial. A successful hand-built HTTP request does not verify a particular AI client.
- Disable the global gate, redeploy, and verify both metadata paths and MCP are 404. Re-enable only for the approved scope after all relevant evidence is accepted.

Local tests exercise cryptographic/API admission, stable-ID lookup routing, runtime read-only PostgREST transport, discovery, configuration failures, account-block/suspension admission, and provider-specific UI/API behavior. They do not establish tenant configuration, live grant state, hosted performance, or client compatibility.
