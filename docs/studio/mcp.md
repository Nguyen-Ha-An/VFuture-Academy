# Studio MCP operations

Independent Academy status: NOT CONFIGURED / NOT VERIFIED. Provisioning a new Supabase project is deferred. The old monolith endpoint and grants are not the Academy deployment. Configure the values below only when infrastructure setup is authorized.

## What the connection does

The MCP resource URL is the configured `MCP_RESOURCE_URL`, for example `https://academy.example/api/mcp`. A user signs in with their existing Studio account through Supabase OAuth 2.1. Tool exposure follows **live permission keys** and each course's owner scope; removing a role takes effect on the next call. Reviewers receive a redacted item view without answer keys or an item hash. Editors can read unredacted items only for courses they can edit. A suspended account is denied.

The tools read courses, return the strict MCP authoring profile, and validate a proposed edit. `validate_item`, `prepare_import`, and `verify_import` do **not** write course content. Version 1 edits an existing lesson, exam, or assignment by item ID. A quiz is a block inside a lesson. The only planned database side effect of a tool session is operational `rate_limit` counters; Supabase Auth also stores its own session, token, and consent records. The human paste into Studio is a separate write.

**Token scope:** a Supabase OAuth access token is a project user JWT, not a token restricted to `/api/mcp`. It may reach Supabase Auth/Data APIs under that user's privileges; the consent page discloses this. Before enabling the independent deployment, verify observed token reach, live permissions, refresh and revocation, and record the result. `whoami` alone does not establish OAuth resource/audience confinement. [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security).

## Production configuration

Set these in **Vercel → Project → Settings → Environment Variables → Production** before deploying the gate build. Vercel environment changes take effect after a new deployment. Keep the Supabase service key server-only.

| Variable | Required value and purpose |
| --- | --- |
| `STUDIO_MCP_ENABLED` | `1` only for an authorized Phase 0 or launch deployment; `0` makes `/api/mcp` and protected-resource metadata return 404. Redeploy to change it. |
| `MCP_RESOURCE_URL` | Exact canonical client-facing HTTPS URL, for example `https://academy.example/api/mcp`. No trailing slash, query, or fragment. Metadata advertises this exact URL even though `/api/mcp/` is also served. Match the origin that serves consent and the URL entered in clients. |
| `MCP_ALLOWED_ORIGINS` | Comma-separated **exact browser origins** allowed to send an `Origin` header. Leave empty unless a tested browser client needs one. Server-side clients without `Origin` are accepted; this variable does not authorize OAuth redirect URIs. |
| `MCP_TESTER_USER_IDS` | Leave **absent** for the owner-approved rollout to all eligible Studio accounts. If a temporary restriction is later chosen, use a nonempty comma-separated UUID list; the same gate covers `/api/mcp`, `/studio/connect/authorize`, and `/api/v1/oauth/consent`. A present blank or malformed value fails closed. |
| `MCP_SESSION_CHECK` | Absent or `1` keeps mandatory live Supabase Auth `getUser` revalidation on every MCP request. Any other value fails closed. Verify revoked-grant behavior in the production gate. |
| `STUDIO_MCP_PREPARATION_PROOF_SECRET` | Dedicated server-only random secret of at least 32 bytes, encoded as 64+ hex characters. Required for `prepare_import` and `verify_import`; generate independently of the Supabase and rate-limit keys (for example, `openssl rand -hex 32`). Keep it consistent across Vercel instances. A missing or weak key fails author tools closed. |
| Existing app variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_PROXY=1`, and `RATE_LIMIT_COOKIE_SECRET` remain as described in [deployment](../deployment.md). `NEXT_PUBLIC_APP_URL` must be the production origin used for the OAuth Site URL. |

The protected-resource metadata must advertise `resource` equal to `MCP_RESOURCE_URL` and Supabase Auth as the authorization server. `/api/mcp` and `/.well-known/oauth-protected-resource/**` must be public paths, outside Vercel Deployment Protection, so clients can discover OAuth. The enabled, unauthenticated endpoint should challenge with `WWW-Authenticate`; a browser session token without `client_id` must fail. A present, unlisted `Origin` must fail; a missing `Origin` is valid for server-side connectors.

## Dashboard setup: order matters

Infrastructure creation is deferred. When authorized, configure the independent Academy project and record each actual value and result. Supabase combines Site URL and Authorization Path for consent. [OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).

1. Set Academy's canonical Auth Site URL and exact callback/recovery URLs. Verify signup confirmation, password recovery and Google/provider sign-in against this new project.
2. Configure OAuth Server and authorization path `/studio/connect/authorize`; review client registration/DCR policy and verify discovery/JWKS. No old project setting is inherited.
3. Review refresh-token rotation/reuse detection, secure password/email changes and session time-box/inactivity settings appropriate to the intended `offline_access` behavior.
4. Configure the application variables below, deploy a locally validated commit, and verify protected-resource metadata, the unauthenticated 401 challenge, consent/token exchange, and `whoami` for an eligible account. Verify ineligible/blocked accounts and unsafe callbacks are denied.
5. Verify live scope, read-only database behavior, client refresh/reconnect/revocation and each intended client. Record failures and keep the feature disabled until the approved gate is satisfied.

| Setting or gate | Independent Academy result |
| --- | --- |
| Project provisioning and Auth Site/Redirect URLs | Deferred / not configured |
| OAuth Server, client registration, signing keys | Not configured / not verified |
| Secure account/session settings | Not inspected |
| Consent, tool access, no-write and role matrix | Not run |
| Refresh, offline access, reconnect and revocation | Not run |

### Hard callback allowlist

The consent page displays the verified redirect **host** as the main client identity and the full callback for comparison with the AI app. DCR's `client_name` is attacker-controlled. Approval is permitted only for these callback destinations:

- `https://claude.ai/api/mcp/auth_callback` (Claude.ai and Claude Desktop)
- `https://claude.com/api/mcp/auth_callback`
- `https://chatgpt.com/connector_platform_oauth_redirect`
- `https://chatgpt.com/connector/oauth/<callback_id>` with one bounded base64url-style ID segment and no query or fragment
- Claude Code loopback `http://localhost:<port>/callback`, `http://127.0.0.1:<port>/callback`, or `http://[::1]:<port>/callback`, with an explicit port and no query or fragment in the registered callback

The bounded callback-ID rule is an application policy. Every connection still needs the account holder's explicit consent; a client-supplied DCR name is untrusted. Unknown callbacks must produce a Deny-only consent screen. The server consent route enforces the same list, and MCP requests reject a registered client if any redirect URI is outside it. `MCP_ALLOWED_ORIGINS` controls browser CORS separately and cannot expand callback permissions. Verify actual client registrations and malicious callbacks in the independent deployment before enabling access.

## Connect a supported client

Use these steps for the production client gate, then announce availability only after it passes. The endpoint remains disabled until this independent deployment is configured. Enter **exactly** `MCP_RESOURCE_URL`; do not enter the Supabase Auth URL. Sign in on the production Studio origin, compare the full callback with the address shown in the AI app, inspect the verified host and token warning on consent, and deny if anything is unexpected. The [Claude remote connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Claude Code MCP instructions](https://code.claude.com/docs/en/mcp), and [ChatGPT developer mode instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) are the client UI references; UI labels can change.

| Client | Connection path | Gate status |
| --- | --- | --- |
| Claude.ai | **Customize → Connectors → Add custom connector**; enter the remote MCP URL, connect, and finish OAuth in the browser. Team owners may need to add the connector before members connect. | NOT RUN / UNVERIFIED |
| Claude Desktop | Use the same **remote connector** through the signed-in Claude account; connect from Customize/Connectors. Do not install a local desktop extension for this endpoint. | NOT RUN / UNVERIFIED |
| Claude Code | Run `claude mcp add --transport http vfuture-studio https://academy.example/api/mcp`, then use `/mcp` to authenticate and inspect the connection. Substitute the configured `MCP_RESOURCE_URL` if the origin changes. | NOT RUN / UNVERIFIED |
| ChatGPT | A workspace admin enables developer mode; an authorized builder creates an MCP app in **Settings → Apps → Create** (or workspace Apps), enters the endpoint, selects OAuth, completes authorization during **Scan Tools**, and tests the draft app. Availability depends on the ChatGPT workspace plan and controls. | NOT RUN / UNVERIFIED |

Ask the client to call `whoami`, then inspect `tools/list` for that account. The AI app receives course content in its conversation when tools are used. Only send courses whose content and answer keys are approved for that client.

## Read, validate, paste, verify

1. Use `list_courses` and `get_course_outline` to find the existing course and item. Follow `nextModuleOffset` to page through a large outline; request a specific `itemId` if the outline says `detailsOmitted`. Use `get_item` to read the item and its `itemHash` if the account can edit that course. Read only users cannot prepare an import.
2. Fetch `get_authoring_schema` with the course ID, existing item ID, and item kind, plus `get_authoring_guide`. Schema responses are bounded slices: fetch names in `omittedDefs` using `def:<name>` and merge their `$defs` into the document slice before compiling it. An oversized definition uses `def:<name>@<page>`; concatenate its base64 chunks in order and decode the exact definition JSON. Keep existing `$ref`, `$pool`, `assetId`, `resourceId`, and `opportunityId` values unchanged. Do not change item `id` or `kind`.
3. Prefer `validate_item` with `edits[]` and the `baseItemHash`; a whole `document` is also supported. Resolve every error. `prepare_import` repeats validation and returns `baseItemHash`, `proposedItemHash`, exact `importText`, and a signed `preparationProof` together with the paste steps. It refuses a stale base, pending review, oversized workspace, or output over the paste limit. If the base changed, read it again and regenerate; there is no force override.
4. Open the returned `studioUrl` as the same Studio account. If the header says **Read only**, switch to the returned `ownerScopeKey`. Save any unsaved changes, then ask the assistant to regenerate against the new base. Optionally use **More actions → Export current JSON** for a backup.
5. Use **More actions → Import → Single item**. Paste `importText` **exactly** from one code block, tick **Replace the existing {kind} with id {id}**, and choose **Apply to draft**. Studio autosaves valid changes shortly after Apply; treat this as a save operation.
6. Ask the assistant to call `verify_import({ courseId, itemId, baseItemHash, proposedItemHash, importText, preparationProof })`. Pass `baseItemHash`, `proposedItemHash`, `preparationProof`, and the **exact, unchanged** `importText` from the same `prepare_import` result. Passing only `proposedItemHash` is invalid.

The stateless verifier first checks the server-signed `preparationProof` for this account, client, item, exact text digest, and hashes; the proof expires after seven days. It then checks that `importText` parses to `proposedItemHash` and compares the current stored item with the proposed and base hashes. `VERIFIED` means the stored item matches the proposal. `NOT_SAVED_YET` means it still matches `baseItemHash`; wait for autosave and retry. `MISMATCH` means it matches neither and includes a diff of added, removed, and changed IDs; inspect Studio and prepare a new import from the current draft. Altered or reformatted `importText` is rejected. Verify within seven days of preparation; an expired proof requires a new preparation against the current draft. The MCP never opens or fills the Import dialog and never publishes. Its `studioUrl` contains no proposed content, query string, or fragment.

Tool results have a **256 KiB combined limit** across text and structured result channels. `OUTPUT_TOO_LARGE` is nonretryable for that request; ask for a smaller item pointer, outline page, schema slice, or guide topic. The request body limit is 3 MiB with JSON depth at most 64.

## Revoke access and roll back

- **Revoke your own connection:** sign in to [`/account/connected-apps`](https://academy.example/account/connected-apps), find the OAuth client by name and client ID, choose **Disconnect**, then confirm **Remove**. The page lists the signed-in user's grants and calls Supabase `revokeGrant({ clientId })` through `/api/v1/account/oauth-grants`; the route verifies that this user owns the grant. Verify the next MCP call is 401 and refresh fails. Removing a connector only in an AI app is not proof of server-side revocation. [Supabase grant documentation](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows#managing-user-grants). **Production revocation result: NOT RUN / UNVERIFIED.**
- **Central admin block:** in `/admin/mcp`, a central admin with `user.manage.global` can block one account across all MCP clients. The next MCP request should return `MCP_ACCESS_BLOCKED`, and consent should be denied. This is an application access block; **it does not revoke the managed Supabase OAuth grant or stop that token from reaching other Supabase APIs**. The central admin cannot directly revoke another user's individual managed OAuth grant. Ask that user to disconnect at `/account/connected-apps` when grant revocation is needed. **Production block result: NOT RUN / UNVERIFIED.**
- **Permission withdrawal:** removing a Studio role in Admin changes live tool and course access on the next call. It is not a substitute for an MCP block or OAuth grant revocation. **Production result: NOT RUN / UNVERIFIED.**
- **One compromised registered client:** an owner can inspect **Authentication → OAuth Apps** and delete that client after assessing all affected users; this is wider than one user's grant. An emergency server-side `auth.admin.oauth.deleteClient` is also documented by Supabase and must never expose the service key to a browser. **Production result: NOT RUN / UNVERIFIED.**
- **Global stop:** set `STUDIO_MCP_ENABLED=0` or unset it in Vercel Production and redeploy; verify endpoint and metadata return 404. For a Supabase-side emergency, disable the OAuth Server. If the deployed code is the problem, promote the last good Vercel deployment after checking database compatibility as in [deployment rollback](../deployment.md#5-rollback). **Production result: NOT RUN / UNVERIFIED.**
