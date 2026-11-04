# Academy Azure core

This directory contains the new Academy-only resource-group deployment. It does not modify `infra/azure` (the earlier VM design), Central, Competition, Supabase Storage or the production provider selector. Local checks do not prove deployed operation.

See [the production cutover record](../../docs/deployment/azure-core-status.md) for live settings, measured cold-start corrections and outstanding acceptance limits.

## Resources and fixed limits

Deploy to `rg-vfuture-academy-core-sg` in subscription `a5981803-fc8a-4ad2-85d7-bd20ec6b9320`, owner tenant `157419c9-2de9-45e7-a6f9-91546dbef629`. This is the Azure billing tenant, **not** the External ID customer tenant.

- Private PostgreSQL 17, Standard_B1ms, 32 GB, seven-day local backups, HA disabled, storage autogrowth disabled. PostgreSQL has no public endpoint/firewall exception. A delegated subnet and linked private DNS zone connect Container Apps.
- PostgREST 13.0.7 pinned to Docker Hub's manifest digest (see `functions/src/policy.json`), Consumption profile, one replica (min1/max1 after the observed cold-start correction), 0.25 vCPU, 0.5 GiB, eight connections. HTTPS ingress is public; all data requests require a server-issued JWT. No anonymous PostgREST role is configured. `academy_private.authorize_request` checks exact issuer `academy-server`, audience `academy-data`, roles `authenticated`/`service_role`, and maximum 60-second lifetime. The SQL bootstrap owns those contracts. The administrator credential must never enter PostgREST.
- User-assigned managed identities retrieve only their own Key Vault secrets. The DB authenticator URI and HS256 key remain necessary application secrets. PostgreSQL TLS validates hostname and the shipped public DigiCert Global Root G2 and Microsoft RSA Root CA 2017 certificates. CA files are public trust anchors, not private keys.
- Functions Flex Consumption, Node22,512MB, always-ready HTTP instances0 by default (explicit0/1 operator parameter), HTTP concurrency eight. Azure's minimum configurable maximum is **40 instances**; this is separate from the PostgREST maximum of one. Host storage singleton leases coordinate timer execution. Storage and ACS access use managed identity; shared storage account keys are disabled.
- ACS Email custom domain defaults to `notify.academy.vfuturelabs.org`, sender `noreply`. The custom domain starts unlinked: verify ownership/SPF/DKIM first, then redeploy with `linkVerifiedEmailDomain=true`. DNS verification/actual sender delivery are release gates.
- USD25 monthly **soft** budget at subscription scope, filtered to the Academy resource group and its Container Apps managed infrastructure group: actual50/80/100% and forecast100% email alerts to `an@vfuturelabs.org`. The old RG-only budget is retained with notifications disabled. No budget action stops services, upgrades resources, or changes replicas. This is not a spending limit and does not guarantee credit-only billing. Azure budgets use billing currency: verify this subscription's currency is USD before deployment.

## Local and deployment commands

Prerequisites: Node22 for the Functions production package, npm, Azure CLI, Bicep CLI, `zip`, and an Azure identity with the appropriate role assignments. The main app's Node24 toolchain can run unit tests, but does not establish the Node22 hosted runtime. Set `BICEP_BIN` if Bicep is not at `~/.azure/bin/bicep`.

```sh
npm ci --prefix infra/azure-core/functions --ignore-scripts
node infra/azure-core/verify.mjs
node infra/azure-core/preflight.mjs
node infra/azure-core/deploy.mjs --what-if build/azure-core/parameters.json
node infra/azure-core/deploy.mjs --apply build/azure-core/parameters.json
node infra/azure-core/package-functions.mjs
node infra/azure-core/deploy-functions.mjs --apply
```

The first three commands do not provision cloud resources. `preflight.mjs` reads account, RG, provider registration, PostgreSQL regional SKU advertisements, and Flex Consumption region availability; advertised capacity is not an allocation guarantee. It never registers a provider, changes subscriptions or silently selects a more expensive SKU. Deployment uses Incremental mode and the fixed Academy RG. Read the what-if before applying. Obtain the account/session through normal `az login`; never commit Azure token caches.

Create the ARM parameter document locally under ignored `build/azure-core/` with mode0600. Every value is nested under `parameters.<name>.value` (or use ARM Key Vault `reference` for secure values). Required inputs:

| Parameter | Value / source |
| --- | --- |
| `postgresAdminPassword` | Fresh administrator password; private runner only |
| `postgrestDatabaseUri` | `postgresql://academy_authenticator:<encoded password>@<postgres output host>/academy?sslmode=verify-full`; CA location supplied by `PGSSLROOTCERT` |
| `postgrestJwtSecret` | At least32 random bytes, matching server-only `AZURE_POSTGREST_JWT_SECRET` |
| `cronSecret` | At least32 random bytes, matching Vercel `CRON_SECRET` |
| `emailDedupeSecret` | Independent random secret at least32 bytes; do not rotate during OTP retries |
| `entraExternalTenantId` | External customer tenant UUID |
| `entraExtensionIssuer` | Exact `https://<tenant-subdomain>.ciamlogin.com/<customer-tenant-uuid>/v2.0` issuer |
| `entraExtensionAudience` | Separate email extension API application UUID; request v2 tokens |
| `entraExtensionId` | Registered OTP extension object UUID |
| `entraClientId` | Academy sign-in application UUID |
| `examSweepUrl` | Academy HTTPS `/api/v1/internal/exams/sweep` URL |
| `budgetStartDate` | First day of current month UTC, e.g. `2026-11-01T00:00:00Z` |

Resource names are deterministic from the RG and prefix. An initial template deployment may precede schema/bootstrap/identity registration, so unhealthy PostgREST until bootstrap and an unconfigured email listener are expected interim states, **not** evidence of readiness. Use a private-network runner for DB migration; never temporarily enable public PostgreSQL as a convenience. After bootstrap, securely give `academy_authenticator` its login/password using the database lane's supported operator procedure. It must retain NOINHERIT and only the two granted application roles.

`main.bicep` provisions resources; `package-functions.mjs` builds an explicit allowlisted ZIP with installed locked dependencies, and `deploy-functions.mjs` deploys that exact hash. Neither command changes the Next.js provider selection. Federation for deployment principals is preferred; record any unavoidable expiring application credentials in a private expiry inventory and choose the longest tenant/service-permitted lifetime. Token/session lifetimes remain independent.

## OTP security and delivery behavior

See [the exact tenant issuer and Graph registration contract](entra-email-registration.md) before creating the API app or listener; it distinguishes Graph permission consent from incoming JWT claims and records the2000ms callback deadline.

The Function route `/api/entra/email-otp` uses Functions `authLevel=anonymous` **only because it verifies the Entra bearer itself**, not a reusable function key. Before parsing or acting on the payload it verifies an RS256 signature against the configured tenant's JWKS, exact issuer/audience/tenant, required validity claims, v2 token version, and Microsoft authentication-events caller `azp=99045fe1-7639-4a75-9d4a-577b6ca3810f`. The payload must match the configured extension, customer tenant and Academy client application. Other callers receive401; malformed payloads receive400. Register the extension with `CustomAuthenticationExtension.Receive.Payload` and its listener only for the Academy app, not all apps. No wildcard tenant/issuer or email-based account linking exists here.

The authenticated HTTP callback performs only validation and durable queue enqueue. Its application deadline is1700ms (below Entra's2000ms maximum); an uncertain/failed enqueue returns503, never success. The callback response means **accepted into the encrypted queue**, not sent or delivered. An asynchronous delivery failure cannot retroactively trigger Entra HTTP-error fallback; it remains an explicit failed/unknown state and requires monitoring or a fresh OTP request. Cold platform startup occurs before the handler deadline and must be tested separately.

The receiver encrypts the complete OTP/recipient payload using AES-256-GCM, a random nonce, and a domain-separated HKDF key derived from `EMAIL_DEDUPE_SECRET`. Authentication covers the event/recipient binding and creation/expiry times. The `email-otp` queue has an explicit240-second per-message TTL; manual retries preserve the original expiry. Workers delete the message when processing returns; no OTP plaintext enters Table state, error messages or logs. Expired/tampered ciphertext is discarded. Pause acceptance and drain/wait through the240-second TTL before deliberate key rotation; changing the secret invalidates queued payloads.

The asynchronous queue worker uses atomic ETag leases and operation mappings, a durable limit of5 per recipient per fixed minute and100 globally, and at most3 ACS submission attempts. Duplicate callbacks/jobs use the same operation UUID, repeatability GUID and first-sent timestamp. An ambiguous timeout or409 switches to polling the known operation ID rather than resending. The worker never substitutes another event's recipient or code. Transient retries requeue ciphertext with bounded visibility delay and remaining TTL; exceptions and poison handling never log message bodies. Metadata-only status polling is bounded to13 observations. Permanently failed, expired, rate-limited or unknown jobs need a new OTP request; success is not invented after dependency failure.

Observability states remain distinct: `accepted` (queue received), `submitted` (ACS202 or uncertain submission), `sent` (ACS operation Succeeded/out for delivery), and `delivered` (an ACS delivery event confirms the recipient MTA accepted it). The trusted Event Grid system topic uses its managed identity with the sender-only role on this Academy storage account (the minimum scope supported by Event Grid destination authorization); events must match this ACS resource, operation ID and recipient HMAC. A late poll cannot downgrade delivery evidence. `delivered` does not prove inbox placement or reading. Delivery-report messages contain provider metadata, never OTPs, and expire after300 seconds. Missing provider reports stay unknown.

```sh
node infra/azure-core/email-status.mjs
node infra/azure-core/benchmark-email.mjs
```

The status command reads only hashed identifiers, state/counts, timestamps and queue backlogs; it needs scoped Table/Queue data-read permissions. The benchmark uses a real local RSA signature but mocked20ms queue I/O; it is not hosted performance evidence. Table hash/status cleanup remains bounded to10000 expired rows daily. Verify actual signup/reset/MFA delivery, provider failures, duplicate/retry handling and cold/warm callback latency before binding the production listener.

### Optional always-ready HTTP instance and cost

`httpAlwaysReady` accepts only0 or1 and defaults to0. There is no automatic upgrade. The Azure Retail Prices API for Functions in Southeast Asia, read on2026-11-02, returned USD0.000005/GB-second baseline, USD0.000019/GB-second always-ready execution, and USD0.000004 per10 executions. One512MiB HTTP instance therefore has a conservative baseline estimate ofUSD6.48/30-day month (USD6.696/31days);10000 one-second calls add aboutUSD0.099 before Storage/ACS/EventGrid. Always-ready executions have no free grant. Compare the full Academy cost forecast to theUSD25 soft target and the measured cold/warm results before explicitly setting1. Availability takes priority; the parameter never changes itself.

Sources: [Azure Retail Prices API](https://prices.azure.com/api/retail/prices), [Flex billing](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan#billing), [ACS operation status](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email), [delivery-event semantics](https://learn.microsoft.com/en-us/azure/event-grid/communication-services-email-events).

## Exactly one exam sweep owner

`examSweep` has NCRONTAB `0 */5 * * * *`, `runOnStartup=false`, `useMonitor=true`. It POSTs once over HTTPS with `CRON_SECRET`; it does not automatically retry a timed-out request that may already have committed. The next five-minute invocation recovers. It starts disabled (`examSweepEnabled=false`). Before enabling:

1. Disable the legacy Supabase `vfuture-exam-sweep` pg_cron job and any Vercel cron entry. Verify both live sources after the change.
2. Save a private receipt with `legacyPgCronDisabled:true`, `vercelCronDisabled:true`, `onlyOwner:"azure-functions"`, and current `observedAt`.
3. Supply `--scheduler-receipt=build/azure-core/scheduler-receipt.json` while applying parameters with `examSweepEnabled:true`. Receipts older than24 hours are rejected.
4. Observe two consecutive scheduled executions and verify one sweep per interval, the Academy backend selector, expired exam transitions, no duplicate submissions, and no secret in logs. A local receipt is an operator assertion; only live observation establishes ownership.

## Cost and expiry accounting

The daily `costMonitor` Function runs at01:31UTC, using its managed identity with subscription-scoped **Cost Management Reader** (read-only). It queries and filters Academy and explicitly declared identity resources; it does not inspect or mutate other products. It emails actual50/80/100%, forecast100%, incomplete/stale monthly accounting, unavailable billing data, benefit expiry within60 days, and approaching credential expiry to `an@vfuturelabs.org`. Durable table keys suppress repeated unchanged notices within a month. Native RG budget email provides a separate path if custom ACS delivery fails. Verify both delivery paths after setup.

Copy `operator.example.json` to private ignored `build/azure-core/operator.json`. List External ID billing resource IDs even if outside the Academy RG. Inspect the Container Apps environment managed infrastructure RG and any Academy networking charges: add its actual RG name to `academyInfrastructureResourceGroups`, then set `academyCostScopeReviewed=true` only after complete scope review. Empty arrays are not proof that managed infrastructure is free. For identity charges in another subscription/billing scope, record the independently inspected month-to-date amount and full-month forecast plus a private evidence pointer. Set `billingMonth` to the reviewed YYYY-MM period and pass this object as the Bicep `costOperator` parameter to update the monitor. Explicit zero must be evidenced; empty arrays do not imply identity is free.

```sh
node infra/azure-core/cost-report.mjs build/azure-core/operator.json
```

This makes read-only Cost Management Query/Forecast POST requests against the subscription, groups costs by resource and RG, includes only Academy+explicit identity IDs, adds separately evidenced outside-subscription costs, and flags incomplete accounting with exit2. Credit balance does not reduce `grossUsageUsd`. Unexpected currencies or negative net adjustments fail for review rather than being called zero cost. Azure native budget emails cover the Academy RG; the daily Function adds aggregate and expiry notifications. Outside-subscription charges cannot be discovered with this subscription identity, so stale or absent reviewed input produces an action-required notification, never a claim of complete zero cost.

Portal observations on2026-11-02: monthly free750 B1ms hours,32GB DB and32GB backup expire2027-10-23; separate nonprofit credit balanceUSD2000 expires2027-10-20. They are not the same benefit. The report warns within60 days of either expiry and lists credentials expiring within60 days. Recheck grant balance, usage-meter attribution, backup overage, and credit consumption after deployment; keep `freeMeterAttributionVerified=false` until seen in billing. Availability takes priority over theUSD25 target, and crossing it triggers review, never shutdown.

## Evidence still required

Fresh schema/data/identity/storage rehearsal; private DNS/TLS connectivity; anonymous and forged-token HTTP denial; role isolation; server login/reset/OAuth flows; ACS inbox delivery; singleton scheduler; gross billing attribution and delivery of outside-RG aggregate notifications;25 simultaneous learner hosted exercise (autosavep95<=2s, submitp95<=5s, no loss/duplicates/isolation failures); reconciliation-aware rollback after Azure writes. Root repository Graphify refresh/check and the full local verifier remain mandatory before review-ready wording.

## Primary references checked during implementation

- [PostgREST v13 configuration](https://docs.postgrest.org/en/v13/references/configuration.html), [official pinned image metadata](https://hub.docker.com/v2/repositories/postgrest/postgrest/tags/v13.0.7), [minimal image construction](https://github.com/PostgREST/postgrest/blob/v13.0.7/nix/tools/docker/default.nix).
- [Azure PostgreSQL trusted roots](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect), [Azure CA download inventory](https://learn.microsoft.com/en-us/azure/security/fundamentals/azure-certificate-authority-details).
- [Entra extension token validation](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-overview), [OTP request/response schema](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-email-otp-send-data), [extension registration](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-email-otp-get-started).
- [ACS repeatable requests](https://learn.microsoft.com/en-us/rest/api/communication/repeatable-requests), [ACS managed-identity email permissions](https://learn.microsoft.com/en-us/samples/azure-samples/communication-services-dotnet-quickstarts/email-sample-send-email-with-managed-identity/), [ACS data residency](https://learn.microsoft.com/en-us/azure/communication-services/concepts/privacy).
- [Functions identity-based host storage](https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections), [Flex deployment](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to), [package deployment](https://learn.microsoft.com/en-us/azure/azure-functions/deployment-zip-push).

## Phase-one bootstrap without customer-tenant applications

`base.bicep` is the shared resource module used by the full template. It can be deployed directly before the External ID tenant administrator finishes MFA, without fake tenant/application IDs. Its default `deployPostgrest=false` creates private PostgreSQL, the VNet/DNS, Container Apps environment, identity/Key Vault/storage, ACS custom-domain resources and budget, but **no Functions or public data API**. It allowlists `PGCRYPTO` using `azure.extensions` before migration. Required secure inputs are only `postgresAdminPassword`, `cronSecret`, `emailDedupeSecret`, and nonsecret `budgetStartDate`. `main.bicep` later composes the same resource names with PostgREST enabled and adds Functions after real identity IDs exist. Incremental base redeployment is not a way to disable already-deployed runtime resources.

```sh
node infra/azure-core/deploy.mjs --what-if build/azure-core/base-parameters.json --base
node infra/azure-core/deploy.mjs --apply build/azure-core/base-parameters.json --base
```

Use the dedicated email subdomain `notify.academy.vfuturelabs.org`; do not add conflicting TXT/SPF records to the Academy website CNAME.

## Private-network schema/import job

The manual `migration-job.bicep` runs in the same VNet-integrated Container Apps environment as PostgreSQL. Its official Node22 image is pinned by immutable Docker Hub manifest digest. It has0 automatic retries, parallelism1 and a30-minute timeout; migration is never a recurring scheduler. Its identity can read only the encrypted migration-package container and the two necessary Key Vault secrets, and write only the receipt container. No source Supabase credentials are shipped. The DB administrator URI lives in the `migration-admin-uri` Key Vault secret created by the base.

After the database lane has produced a current source snapshot and passed its local restore rehearsal:

```sh
node infra/azure-core/migration/package.mjs
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare
node infra/azure-core/migration/deploy.mjs --start
node infra/azure-core/migration/deploy.mjs --receipt
```

`package.mjs` refuses a snapshot whose schema digest differs from current migration/identity SQL. It packages only the four migration modules, owned SQL, public CA bundle, source snapshot, and installed lockfile-resolved pure-JS `pg` dependency closure. It encrypts the package with a fresh AES-256-GCM key before upload; plaintext staging/archive are removed after packaging. Both ciphertext and key remain private/ignored locally. `--prepare` stores the key in Key Vault, creates a manual job/private containers/scoped MI grants, then uploads the encrypted blob. It does not start migration. Migration receipt/start commands use only account/RG/storage-target checks plus prepared-job/hash checks for start; they do not depend on Functions, ACS, EventGrid or regional SKU listings. Prepare additionally verifies migration-specific providers and the existing private PG/Container Apps network. The operator needs Key Vault Secrets Officer on the Academy vault and Storage Blob Data Contributor on this Academy storage account for these data-plane uploads; do not grant those to unrelated products. Set `ACADEMY_BASE_DEPLOYMENT_NAME` if the initial base deployment used a different deployment name.

`--start` refuses when another execution is active. The runner obtains a storage token using the Container Apps managed-identity endpoint, validates the ciphertext SHA256, decrypts/authenticates locally, and runs the database lane's `schema --apply` followed by `import --apply`. The target must be fresh/prepared; no overwrite of an active database is allowed. Child stdout/stderr is suppressed because driver/provider errors may contain sensitive data. On success, the job uploads only the counts/hash reconciliation receipt to the private receipts container and emits only package/receipt hashes. A failed job must be inspected before a manual retry: the schema may have committed even when a later import or receipt upload failed. Never blindly repeat the schema stage on that target.

The initial snapshot is a rehearsal, **not a write freeze or cutover**. A SQL-derived Storage metadata inventory does not prove live private Storage objects; the database lane's actual Storage API verification gate still applies. Obtain a fresh final snapshot under the release write-freeze procedure, reconcile all rows/UUIDs/sequences/storage, configure the restricted authenticator login with its expiry, then activate PostgREST and run hosted acceptance. Do not point Vercel at PostgreSQL's private hostname; the application uses PostgREST over HTTPS.

After successful import, configure the authenticator through the same private job (no repeated schema/import). Put its independently generated password in ignored `build/azure-core/private/authenticator-password.txt` mode0600, and export `AZURE_AUTHENTICATOR_EXPIRES_AT` to an explicit future timestamp or PostgreSQL's `infinity` when a non-expiring credential is selected. This deployment uses `infinity` to honor the owner's longest-permitted-lifetime preference; Entra application credentials remain subject to their separate 24-month limit. The packaged database helper checks that the role has no superuser/create-role/create-db/replication/BYPASSRLS attributes and exactly the two approved memberships before setting LOGIN/NOINHERIT/password/expiry.

```sh
node infra/azure-core/migration/deploy.mjs --prepare --configure-authenticator
node infra/azure-core/migration/deploy.mjs --start --configure-authenticator
node infra/azure-core/migration/deploy.mjs --receipt --configure-authenticator
```

Use that same password (URI-encoded) only in the Key Vault-backed `postgrestDatabaseUri`; Vercel receives the short-JWT signing secret and HTTPS data URL, never the DB password. Record the authenticator receipt expiry in `costOperator.credentialExpiries`. Remove the one-off migration job/identity grants, admin URI secret, package/key and private local exports after the approved rehearsal/cutover evidence has been secured and rollback retention has been decided. Do not delete source data or disable Supabase Storage as cleanup.

### Diagnose a failed private job before another write

Never infer target state from a failed job status. A schema/import/receipt-upload boundary may already have committed. The bootstrap now emits fixed stage enums and a failure record containing only a fixed error code, numeric HTTP/child exit status, allowlisted runtime code and SQLSTATE. It never forwards raw child stderr, SQL messages/details, command arguments, URLs or environment values.

The diagnostic-only package contains the probe, pg dependency closure and public roots; no source snapshot or mutation scripts. Regenerate and verify it after diagnostic-code changes, then prepare/start a **read-only** probe:

```sh
node infra/azure-core/migration/package.mjs --probe
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare --probe
node infra/azure-core/migration/deploy.mjs --start --probe
node infra/azure-core/migration/deploy.mjs --receipt --probe
```

The probe opens `BEGIN READ ONLY` and finishes with rollback. Its private receipt contains PostgreSQL version, extension allowlist/installed extensions, schema table counts, public table row counts, approved role attributes, migration ledger state/schema hash, and identity/Storage-receipt counts. It never selects user row values, passwords, credential URIs or email addresses. Inspect `build/azure-core/hosted-target-probe.json` and the failed execution's stage/SQLSTATE before deciding whether schema application, import, or receipt recovery is appropriate. A probe does not authorize or automatically perform any retry.

Once a Storage MI token is available, every bootstrap/probe failure attempts an immutable `<receipt-name>.failure.json` write in the same private receipt container, using `If-None-Match:*`. It contains only sanitized stage/code/status fields. `--receipt --probe` retrieves this failure record when no success receipt exists and exits1, without claiming success. If managed identity itself fails or Storage cannot accept the failure receipt, `failureReceiptPersisted:false` is emitted to live console: collect it while the replica exists or configure temporary diagnostic capture before any further execution. No schema retry is performed by diagnostic collection.

### Event Grid storage authorization correction (2026-11-03)

Microsoft's [managed-identity delivery guide](https://learn.microsoft.com/en-us/azure/event-grid/managed-service-identity#use-the-azure-cli---azure-storage-queue) requires Storage Queue Data Message Sender at the storage-account scope. The hosted child-queue assignment was present but Event Grid rejected subscription creation with `ManagedIdentityAuthorizationError`. The template now grants the same sender-only role (`c6a89b2d-59bc-44d0-9896-0f6e12d7b80a`) on the Academy account; this adds messages only, without read/process/delete or account-management permissions. The event subscription still targets only `email-delivery`. The account-scope grant uses a new deterministic scope-derived assignment GUID; Incremental deployment retains the redundant old child-scope assignment until separately cleaned up after hosted verification. This correction is source-tested; deployment acceptance must be observed separately.

The ACS custom-role assignment now references its canonical subscription-scoped role-definition ID while retaining the original assignment GUID inputs, preventing accidental creation of a duplicate assignment. The live external-tenant Graph role value is singular `CustomAuthenticationExtension.Receive.Payload`; the permission UUID remains `214e810f-fda8-4fd7-a475-29461495eb00`.

### Runtime migration-secret retrieval and exact target guard (2026-11-03)

The migration job no longer uses Container Apps platform Key Vault secret references. The same user-assigned identity retains the same existing per-secret Secrets User grants. At runtime it first obtains Storage access for private failure receipts, then obtains a separate Key Vault audience token and fetches only the approved admin URI, package key, and optional authenticator password. This is ordinary authorized [managed-identity access](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity) to the [Key Vault Get Secret API](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret/get-secret); no permission scope is broadened.

The job environment contains nonsecret exact vault/secret URLs and the base deployment's `postgresHost` as `AZURE_TARGET_HOST`. Secret URLs must exactly match the approved Academy vault and fixed secret paths; userinfo, custom ports, queries, fragments, path changes and redirects are rejected. The runtime adds only its fixed API-version query. HTTP403/429/502/503/504 responses retry at most5 times with bounded backoff, then produce a private failure receipt containing stage, HTTP status and attempt count. Secret bodies, tokens, connection URLs and raw errors never enter logs or receipts. The AES key is consumed only in parent-process memory; DB/password credentials are passed only in the child process environment.

Before any database connection or write, the runtime and the database helper both require the exact approved host, database `/academy`, administrator `academy_admin`, default/5432 port, and no fragment. URI query parameters must be absent or exactly one `sslmode=verify-full`; host/database/service/options/certificate overrides are rejected. The same shared helper protects read-only probes. Both normal and probe package allowlists include `scripts/azure-core/target.mjs`; root must rebuild the immutable package after this source change. Agents must not regenerate shared package/key artifacts during root deployment operations.

Schema-application failures may additionally include `schemaStep` and `position`. The bootstrap loads the exact allowed SQL step identifiers from the hash-verified package's `azureSchemaStepNames()` export; the receipt reader validates against the same owned-source allowlist. Unknown/absolute/traversal filenames are omitted. Position is accepted only as a positive safe integer and refers to the submitted transformed SQL step, not a quoted SQL message or row value. Begin/commit failures have no individual filename. Key Vault retrieval and its permissions are unchanged by this diagnostic addition.

### Portable archive enforcement (2026-11-03)

A hosted protocol error was traced to macOS AppleDouble `._0001_identity.sql` being interpreted as SQL on Linux. Migration creation now sets `COPYFILE_DISABLE=1` and filters real `._*`, `.DS_Store` and `__MACOSX` paths during staging. The packager, offline verifier and job all validate the raw tar member list **before extraction**, rejecting those components anywhere in a path and enforcing the migration-file allowlist.

Ordinary BSDtar listing also absorbs AppleDouble members, so `COPYFILE_DISABLE` alone does not make inspection sufficient. Inspection detects BSDtar/libarchive and uses `--options !mac-ext`; GNUtar uses its normal member listing. The macOS regression sets a real ResourceFork xattr, proves unsafe tar emits a hidden sidecar, exercises the actual offline verifier in a temporary workspace, and proves clean creation excludes it. The runtime regression rejects encrypted metadata-bearing archives at `validate_archive`, before extraction or fetching the database credential. The database builder independently accepts only approved regular SQL filenames; its combined SQL/digest is unchanged.

`migration-job.bicep` prefixes the shared `archive-policy.mjs` into the bootstrap command. Deploy the current template rather than copying the bootstrap text alone. No extra module is required inside the encrypted package. Functions ZIP creation excludes the same metadata and validates its raw ZIP listing before publication. Root alone regenerates real release artifacts; all regression fixtures use unique temporary directories.
