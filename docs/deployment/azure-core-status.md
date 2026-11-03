# Academy Azure core: production cutover and retained evidence

Production cutover completed on 3 November 2026 (Asia/Ho_Chi_Minh). Azure PostgreSQL/PostgREST is now the application's database, Entra handles identity, and the Academy-scoped ACS OTP listener is active. The website remains on Vercel and files remain in private Supabase Storage. Supabase's application/authentication writes are frozen for rollback retention.

## Production cutover record

- Initial production deployment: `dpl_2X1NA7spTPwmQ6ytW22erVkbdPKX`, application source `3a6f925da7d8dd3655cb01d86a1263343e5cf8a8`. Both backend selectors are `azure`; the canonical origin is `https://academy.vfuturelabs.org`.
- Final private-network synchronization reconciled all 63 public tables, both user records, the retained object inventory and both sequence positions. Only transient request-limit counters were replaced; differing business rows would have aborted the transaction. Account UUIDs and existing permissions were retained.
- Three reviewed identity mappings were applied: two exact legacy Google provider subjects, and one same-tenant workforce identity matched using the source's verified email/domain-owner claims plus the authoritative directory UPN. The Google ID token signature/issuer/audience/nonce were verified. Its absent `email_verified` claim was not treated as true and no automatic email account linking was added.
- The missing customer identity was provisioned with its original Google subject and backup local-email identity. Its generated password was neither exposed nor imported from Supabase; the owner must use hosted password reset for password sign-in.
- Production Google sign-in reached `authenticated: true`. Public home/login/catalog pages returned 200, the Google start route redirected to the tenant's CIAM authority, and the authenticated exam-sweep endpoint returned 200.
- Source freeze began at `2026-11-03T01:26:44Z`. Source checks found zero active exams, pending upload grants and banned accounts. The legacy pg_cron sweep is disabled; the Azure sweep is enabled against the canonical production endpoint. A source service-role write was rejected with SQLSTATE `25006`, including the source's protected table path.
- `source-freeze.sql` blocks legacy application/authentication writes by checking `session_user`, including through SECURITY DEFINER RPCs. A restrictive Storage policy prevents old anon/authenticated JWTs bypassing Azure file authorization. Server-side Storage credentials and authorized signed transfers remain operational; signed download returned 206 and public download was denied.
- Entra OTP listener `e19905f4-2559-4461-bfa2-8d0a2e158cac` is restricted to Academy Web. Configuration validation returned no errors or warnings. A real recovery request was accepted by Entra, processed once by the encrypted queue worker and reached ACS `sent`; recipient inbox placement and a correlated delivery report remain unconfirmed. No recovery code or user password was read or changed.
- The unused localhost diagnostic callback was removed after the successful sign-in test. Default and Vietnamese tenant branding use the existing VFuture symbol; API readback matched the uploaded image.

### Availability settings and cost bounds

Observed cold starts were approximately 3.4 seconds for the email HTTP endpoint (above Entra's two-second limit) and 27.5 seconds for the data API. The operator therefore selected **one always-ready HTTP instance** and **PostgREST min=1/max=1**, retaining 0.25 vCPU, 0.5 GiB and pool eight. A subsequent production sign-in start took approximately 2.8 seconds and the manual sweep approximately 0.8 seconds. These are sampled requests, not a 25-user capacity result.

Singapore retail references read on 3 November 2026 are USD0.000034 per active vCPU-second, USD0.000004 per idle vCPU-second and USD0.000004 per GiB-second for Container Apps. Ignoring shared Container Apps grants, the single API replica is approximately USD7.78/30 days if idle-billed throughout, or USD27.22 if active-billed throughout. Add approximately USD6.48 for the email HTTP always-ready baseline and USD3.60 for 720 hours of Standard public IPv4: **USD17.86–37.30 before other usage**, while the inspected PostgreSQL/Load Balancer allowances apply. Actual execution, requests, mail, DNS, secrets and transfer are additional; applicable grants can reduce this. The USD35 target remains a notification threshold, not a cap, and full-month active usage can exceed it. No automatic SKU upgrade, extra data-API replica or budget shutdown is configured.

### Remaining acceptance limits

The prior full local verifier passed before the main code merge. During cutover, the owner requested proceeding without another full check run; operational probes, source reconciliation, bounded configuration checks and Graphify were used. A 25/50/100-user hosted capacity result, full customer signup/recovery completion, all production administration/file workflows, and final billing attribution have not been established. MCP stays disabled. Do not present the historical rehearsal evidence below as proof of these outstanding checks.

The following sections retain the initial implementation/rehearsal observations. Where settings differ, the production record above takes precedence.

## Implemented application behavior

- Azure database and identity adapters are opt-in through both backend selectors. Server routes issue short-lived PostgREST claims; browser clients receive no database service credential.
- Google is the primary public sign-in option. Microsoft is an optional internal workforce sign-in restricted to the VFuture tenant and prelinked, currently authorized staff. OAuth opens a popup with attempt-bound completion; the parent verifies its server session before navigating.
- Administration supports customer-account creation, display-name editing, disable/enable, session revocation and login deletion. Academic records survive login deletion; self/final-admin protection and a durable operation journal remain enforced. Google invitations are preferred; backup password accounts require hosted recovery.
- Studio can remove unused uploaded content files. Historical content, submissions and other references prevent deletion; remote absence must be verified before inventory/quota release. Supabase buckets stay private.
- Entra MCP validation is implemented, but the existing MCP release gate stays disabled. The five-minute Azure exam scheduler is deployed disabled until sole ownership is proven.

## Observed cloud state

| Component | Evidence and limit |
| --- | --- |
| Subscription | `a5981803-fc8a-4ad2-85d7-bd20ec6b9320`; Academy RG `rg-vfuture-academy-core-sg` |
| PostgreSQL | `vfa-core-pg-psqjld5eejfge`, PostgreSQL 17.11, B1ms, 32 GB, seven-day backup, no HA, public networking disabled |
| Rehearsal data | 63 application tables, two preserved user UUIDs, one retained Storage object and two sequences reconciled against the private source snapshot; no final source write freeze yet |
| Schema | `273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149`; 49 legacy migrations plus owned Azure schema, applied in 55 ordered transactional steps |
| Data API | `vfa-core-data`, pinned PostgREST 13.0.7, Consumption initially 0–1 replicas, 0.25 vCPU/0.5 GiB, pool eight; latest inspected revision Healthy |
| API authorization | Live unauthenticated and expired-token requests returned 401; service query counted two profiles; authenticated query saw its own profile and hid the other. This is not full cross-school or hosted load acceptance |
| External ID | Customer tenant `f3152aa5-61de-40fd-bb76-780b9fbe5428`, `vfutureacademy.onmicrosoft.com`; AcademySignIn has Google and email/password and is attached to the web app |
| Account administration | Actual application Graph adapter completed create, customer guard, edit, enable, revoke, disable and delete on a disposable identity. Absence was confirmed after directory replication; application route/UI acceptance remains separate |
| Email | ACS sender `noreply@notify.academy.vfuturelabs.org`; domain, SPF and both DKIM records verified; strict DMARC published. Functions deployed, unauthenticated callback denied, Key Vault references resolved |
| OTP extension | `d970c9fb-136c-4e51-8897-c3363eca622b` exists but remains unbound pending authenticated latency and delivery tests. Queue acceptance does not prove inbox delivery |
| Vercel staging | 32 variables configured only for Preview on `vfuture-academy-production`; project has no Git connection, so they are preview-wide rather than branch-scoped. Preview `dpl_HTmQjCajms5PQShaGEfkyY4ZzWT3` built successfully: home, courses, resources, projects and login returned 200; anonymous session returned 401 and disabled MCP 404. This rehearsal was built from a dirty working tree, not the final delivery commit |
| Retained Storage | Dedicated server key stored privately; media/submissions caps 50 MiB, notebooks 10 MiB; object inventory verified against Storage APIs. No existing object deleted |

The PostgREST administrative listener uses `PGRST_ADMIN_SERVER_PORT=3001`, matching its health probes. An earlier misspelled setting caused failed readiness despite database connectivity. The migration archive now rejects AppleDouble metadata before extraction; a hosted failure established that macOS sidecars must never be interpreted as SQL.

The final source schema digest is `fc0a0446189fb0b8b0f9ddbf76c6cf742d026db28e5d15b65e98594fe0e53507`. It differs from the hosted rehearsal receipt above only because one trailing space after a SQL statement terminator was removed during patch review. The database was not reimported for formatting. Rebuild and verify the encrypted package from the current source before any later migration operation; do not relabel the earlier hosted receipt as a new execution.

## Cost and credential operations

The deployed native budget `academy-core-usd35-soft` is USD35/month, with actual thresholds USD17.50/28/35 and a forecast threshold USD35, addressed to `an@vfuturelabs.org`. It does not stop resources or upgrade capacity. Keep gross credit consumption visible as spending.

The Container Apps managed RG is `ME_vfa-core-environment_rg-vfuture-academy-core-sg_southeastasia`; it must be included in aggregate reporting. The External ID billing resource is in the Academy RG under `Microsoft.AzureActiveDirectory/ciamDirectories/vfutureacademy.onmicrosoft.com`. The operator configuration includes both scopes and the credential dates below; accounting remains marked incomplete until all tenant billing and free-meter attribution have been reviewed.

The first Cost Management query returned approximately USD0.001066 in gross reported Academy usage, mostly managed infrastructure. This is a partial, lagging observation, **not a monthly estimate or a zero-cost guarantee**. Vercel and retained Supabase costs remain outside that Azure total; the retained Supabase project was inspected as Free. Actual Vercel billing remains a separate review.

A subsequent portal check confirmed Standard Load Balancer free meters through 23 October 2027: included-rule hours 0.21/750, processed data 0/15 GB, and the portal's overage-rule meter 0/5 (unit `1/Hour`). A separate public-IP allowance shows 0/1500 hours but does not identify its SKU; applicability to the actual Standard IPv4 address is **unverified**. The portal attributes approximately USD0.01 to that address and warns that the latest 24 hours may be inaccurate. Do not count those public-IP hours as an applicable discount yet.

Conservative retail references read on 3 November 2026: Standard IPv4 in Southeast Asia USD0.005/hour (USD3.65 at 730 hours), Standard Load Balancer's included-rule bundle USD0.025/hour (USD18.25), and processed data USD0.005/GB. The load-balancer hour/data allowance was observed; actual attribution still needs reconciliation. Once those benefits expire, the network baseline alone is approximately USD21.90/month before data. Combined with the plan's approximately USD23.40 PostgreSQL reference, that is roughly USD45.30 before API runtime, Functions, mail, secrets and transfer. The USD35 target therefore needs review before expiry; no automatic shutdown or upgrade is configured. References: [Azure Retail Prices API](https://prices.azure.com/api/retail/prices), [IP pricing](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/), [Load Balancer pricing](https://azure.microsoft.com/en-us/pricing/details/load-balancer/).

One manual cost-monitor invocation was accepted. ACS subsequently reported one `Delivered` event on this dedicated resource; per-message correlation and inbox placement were not confirmed. This does not establish Entra confirmation/recovery delivery or justify binding the OTP extension.

| Item | Observation / review date |
| --- | --- |
| PostgreSQL benefits | 750 B1ms hours/month, 32 GB data, 32 GB backup; expire 23 October 2027; actual new-meter attribution still pending |
| Benefit reviews | 25 July 2027 (90 days), 23 September 2027 (30 days), 16 October 2027 (seven days) |
| Separate nonprofit credit | USD2000 remaining observed 2 November 2026; expires 20 October 2027; balance must be refreshed |
| External ID web secret | Expires `2028-11-02T14:50:10Z` |
| Internal Microsoft secret | Expires `2028-11-02T15:37:11Z` |
| Customer-admin secret | Expires `2028-11-02T16:31:40Z` |
| PostgreSQL application credential | Explicit `VALID UNTIL 'infinity'`; least-privilege role memberships verified |
| Vercel project token / retained Storage key | No expiration option selected/available; remain server/operator-only and outside Git |

The three Entra secrets use the configured 24-month maximum. Renew before expiry, update the relevant runtime, verify sign-in/administration, then retire the replaced credential. User-session expiry remains bounded independently. Prefer managed identities for Azure services. The optional always-ready HTTP instance remains zero; enabling one requires measured cold-start evidence and costs approximately USD6.48/month baseline at the reviewed rate. See the [infrastructure runbook](../../infra/azure-core/README.md) for other usage charges and primary pricing sources.

## Cutover procedure and remaining acceptance reference

1. Finish real Google consent and verified-token capture; reconcile immutable Entra identities to the two preserved Academy UUIDs. Never map solely on an unverified email. Confirm internal Microsoft staff mapping and deny nonstaff.
2. Verify a preview build against its exact source manifest/commit. Exercise signup, existing accounts, password reset, logout, session expiry, suspended users, cross-school isolation and privileged-RPC denial. Test admin routes and Storage upload/finalize/download/delete on disposable fixtures.
3. Measure authenticated cold/warm OTP callback latency and actual confirmation/recovery delivery before binding the email extension. Exercise retries, deduplication and provider failure. Verify cost-alert delivery separately.
4. Pass the 25-concurrent-learner pilot: autosave p95 ≤2 seconds, submit p95 ≤5 seconds, no acknowledged-answer loss, duplicate completion or cross-user access. Measure 50/100 separately without assuming capacity.
5. Remove rehearsal fixtures and temporary OAuth callbacks/apps. Outside active exams, freeze source writes and expire outstanding upload grants. Capture and reconcile the final source state with the reviewed target procedure; the current import helper deliberately refuses to overwrite a populated active target.
6. Switch both production backend selectors only after acceptance. Disable legacy scheduling, verify its live state, then enable exactly one Azure scheduler and observe two intervals. Retain the old immutable deployment and source project.
7. Verify deployed SHA, real flows, private Storage access and actual billing attribution separately from local checks. Complete `graphify:refresh`, `graphify:check` and `verify:local` after final repository edits; commit the reviewed manifest and keep generated artifacts ignored.

Before Azure accepts production writes, rollback means returning to the preserved source deployment/configuration and verifying scheduler ownership. After new Azure writes, first freeze both writers, export and reconcile changed rows, ownership, identities, inventory and sequences into the chosen authoritative target, then switch traffic and one scheduler. Merely restoring environment variables would lose or split accepted writes. Do not delete the Supabase project or modify Central/Competition resources.

Private snapshots, identity mappings, authentication states, credentials and raw operational receipts stay in ignored local storage. Selected nonsecret observations above are the committed evidence; test results and exact deployment status belong in the delivery PR, without treating local checks as hosted acceptance.
