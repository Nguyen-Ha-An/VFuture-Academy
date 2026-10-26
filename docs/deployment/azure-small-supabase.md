# Academy small Azure Supabase deployment

Repository implementation; no Azure provisioning, secrets, migration or cutover has been performed. The Vercel frontend/API remains in `sin1`. The selected backend is **one Standard_B2als_v2, 2 vCPU / 4 GiB, southeastasia**, with no larger-SKU fallback. All commands below are future operator actions after explicit release authorization. Local tests do not establish cloud readiness.

## Inventory and budget

Local prerequisites include the explicitly pinned Graphify 0.9.91 and
[official Bicep CLI 0.48.1](https://github.com/Azure/bicep/releases/tag/v0.48.1).
Set `BICEP_BIN` if the compiler is outside PATH. `npm run verify:azure` compiles
the Bicep and checks runtime constraints plus Node, Python, Bash and JSON syntax;
`npm run verify:local` includes this gate and the new SQL/concurrency contracts.
Neither command authenticates to or provisions Azure. See the checked-in
[cost assumptions](../superpowers/plans/2026-10-25-azure-small-supabase-costs.json)
for the bounded backup-capacity adjustment and pricing scenarios.

`infra/azure/main.bicep` is a subscription-scope entrypoint. It creates or updates only `rg-vfuture-academy-sg`, then deploys the fixed runtime and a policy assigned only to that group. The subscription Cost Management Reader assignment is read-only; it does not authorize stopping other projects. An operator needs narrowly delegated rights for the intended deployment; the VM never receives deployment rights.

| Resource | Bound |
| --- | --- |
| VM | `academy-sg-vm`, `Standard_B2als_v2`, exact operator-selected Ubuntu 24.04 image version |
| Disks | `academy-sg-os` and `academy-sg-data`, 64 GiB Premium_LRS/P6 each, detach on VM deletion |
| Network | One Standard IPv4; explicit outbound IP; HTTPS 443 only; SSH disabled unless one operator IPv4 `/32` is supplied |
| Objects | Dedicated preallocated 10 GiB ext4 loop filesystem on the data disk; usable payload is slightly smaller because of filesystem metadata |
| Backups/control | Private `Standard_ZRS` Blob account; Entra auth only; no public blobs or account-key access |
| Registry | Basic by default. Standard requires a verified applicable free-benefit meter and explicit selection |
| Secrets | Academy-only Key Vault; RBAC, seven-day soft delete and purge protection; VM subnet plus explicit operator IP only |
| Cost guard | Independent Linux Y1 Function, Node 22 / Functions runtime v4, one-instance limit, own LRS host storage |
| SMTP | Existing exact Academy ACS, verified custom email domain and Entra SMTP username; no DNS or credential creation in this deployment |
| Monitoring | Host monitor slice 64 MiB total; private bounded telemetry; no Log Analytics ingestion configured |

The resource policy compares exact paired type/fullName identities, preventing reuse of a disk name for another VM. It also restricts Singapore region (global only where appropriate), VM size, disk size/SKU and the selected ACR SKU. No autoscale, database auto-growth or deployment identity is given to the application. Policy aliases and deny behavior still require live `what-if`/policy validation before provisioning; Bicep compilation cannot establish those provider semantics.

Preflight reserves **$400** and other projects' committed spending before calculating `min(1080, remaining credit − other commitments − 400)`. It refuses an unfunded requested period. Monthly operating envelopes are $70 with confirmed benefits and $90 otherwise. Basic ACR is paid (approximately $5/month in the planning evidence); choosing it does not claim the free Standard benefit. Match actual meter IDs and expiration dates before choosing Standard. The $2,000 grant is shared, and Vercel/Supabase Cloud invoices are outside it. Budgets notify; delayed charges and storage/IP after deallocation prevent a guaranteed zero-overrun promise.

## Pinning and runtime

`upstream-lock.json` records official Supabase commit `831d6302c7361c0a5115a91e953bdf084eb85330`, SQL/Compose SHA-256 checksums and registry manifest digests. `fetch-upstream.py` downloads only four initialization SQL files and checks every byte. It never runs an upstream installer. Do not run Supabase's automatic updater against this reduced stack.

Resident limits: PostgreSQL 1536 MiB, Auth 192, PostgREST 192, Storage 384, Node gateway 160, Nginx TLS 32, and host monitoring 64. Total 2560 MiB, plus at most 256 MiB during a backup. Memory+swap limits prohibit swap-based sizing. Studio/meta are an explicit `operator` profile, with Studio bound only to `127.0.0.1:3000`. Stop them before classes and backups. Studio uses an operator-profile-only private Nginx proxy that injects the gateway credential from a generated 0640 host configuration. The proxy listens only on its isolated operator-network IP, publishes no host port, and does not bypass user/service JWT authorization. Auth/Storage/REST Studio panels still require actual UI acceptance testing.

The gateway talks directly to private Auth, REST and Storage origins. There is no additional Kong/Envoy container, Realtime, Edge Runtime, imgproxy, analytics, or Supavisor. Nginx overwrites forwarded headers and only its fixed Docker IP is trusted. Access logging is off to avoid signed-token disclosure. Docker logs rotate at 1 MiB × two files per service; this bounds retained container logs, not a guaranteed per-day write rate. Review error-log traffic during the hosted test. There is no default cloud log stream to exceed the 0.5 GB/month allowance.

Postgres has 40 connections, 256 MiB shared buffers, 4 MiB work memory, JIT/parallel query disabled, 10-second normal statements, two-second locks and 15-second idle transactions. PostgREST pool is 8, Auth 4, Storage 4; Storage queue workers are disabled. Backup runs serially and cron is capped at two. Do not add a silent row-limit truncation policy to the REST API.

## Operator preflight and infrastructure

1. Copy `operator.example.json` to an ignored `.local.json` outside the repository, and replace every example with observed values. Inspect the actual subscription, grant period and balance, regional B2als_v2 quota, disk benefits, marketplace image version and ACR meter. Do not infer credit from a subscription display name.
2. Establish the exact existing email resources in the same Academy group: `academy-sg-acs`, `academy-sg-email/<actual custom domain>`, and `academy-sg-acs/smtpUsernames/academy-runtime`. Complete Domain, SPF and both DKIM verifications, link the domain, and assign the SMTP application's minimum send permission only on that ACS resource. No app secret should be in this JSON. `verify-acs.py` checks the actual resources read-only. It does not send email or prove the SMTP secret is valid.
3. Run:

```sh
python3 infra/azure/scripts/verify-acs.py /protected/operator.local.json
node infra/azure/preflight.mjs /protected/operator.local.json > /protected/academy.parameters.json
bicep build infra/azure/main.bicep --outfile /protected/academy.compiled.json
az deployment sub what-if --location southeastasia --template-file infra/azure/main.bicep --parameters @/protected/academy.parameters.json
```

Review the complete resource changes, policy aliases and role scopes. Only after authorization, use the corresponding `az deployment sub create` command. No instruction here authorizes changing subscription quotas for other projects. A failed SKU availability check stops the rollout.

## Secret provisioning and host bootstrap

VM custom data is deliberately absent. No secret goes into ARM parameters, images, Git or command arguments. Create a protected local settings JSON containing exactly `SUPABASE_PUBLIC_URL`, `ACADEMY_SITE_URL`, `AUTH_REDIRECT_URLS`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`. Optional `GOTRUE_EXTERNAL_GOOGLE_ENABLED`, `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` and `GOTRUE_EXTERNAL_GOOGLE_SECRET` are accepted together; the callback is the backend origin plus `/auth/v1/callback`. Register that callback with the provider and validate it before cutover. Other providers require their own reviewed explicit configuration. Use the actual verified ACS SMTP identity, `smtp.azurecomm.net`, port 587/STARTTLS, and an authorized sender address.

```sh
python3 infra/azure/scripts/create-runtime-secrets.py /protected/runtime.env < /protected/runtime-settings.json
az keyvault secret set --vault-name ACTUAL_ACADEMY_VAULT --name academy-runtime-env --file /protected/runtime.env --output none
az keyvault secret set --vault-name ACTUAL_ACADEMY_VAULT --name academy-tls-cert --file /protected/fullchain.pem --output none
az keyvault secret set --vault-name ACTUAL_ACADEMY_VAULT --name academy-tls-key --file /protected/privkey.pem --output none
```

Record the exact secret version IDs, without printing values. Use a valid certificate for the backend hostname. Renewal must use a reviewed DNS challenge or secure operator certificate replacement because port 80 is not exposed. Treat certificate expiry as an operational gate.

The generator creates URL-safe database credentials and legacy HS256 anon/service keys with a one-year expiry. Rotation and browser reauthentication must be rehearsed. Set the Vercel server-only `SUPABASE_GATEWAY_KEY` from the corresponding secret, and set **`SUPABASE_TRANSFER_GRANT_KEY` to the same value as runtime `GATEWAY_TRANSFER_GRANT_KEY`**. Never expose either via `NEXT_PUBLIC_*`. Browser URL/anon-key changes happen only at cutover.

Use an explicitly approved operator `/32` for the SSH bootstrap window, then remove it by redeploying the empty CIDR when finished. Copy the reviewed source to `/opt/vfuture-academy`. On the authorized VM only:

```sh
sudo /opt/vfuture-academy/infra/azure/scripts/prepare-host.sh --initialize-empty-disk
```

The script verifies hostname, expected LUN0 and exact 64 GiB size; it refuses any disk signature or mounted disk before formatting. For an existing disk use `--use-existing-disk`; this never formats it, never resets a missing telemetry ledger, and requires reconciliation of existing objects. It creates the 10 GiB object filesystem only if the backing file is absent and the target directory is empty. Never resize or replace that file during ordinary setup.

Install `runtime/host.example.json` as root-owned `/etc/vfuture-academy/host.json`, replacing every field. `pendingVariableUsd` must be a reviewed positive reserve for variable charges not yet in billing; null intentionally fails. Keep the **age recovery private identity offline** and put only its public recipient on the VM. Then:

```sh
sudo python3 /opt/vfuture-academy/infra/azure/scripts/azure-host.py fetch-secrets
```

This retrieves exact Key Vault secret versions via VM identity, writes runtime.env as 0600, and restricts the TLS private key to the Nginx group. The host secret directory is 0700; the TLS subdirectory is mounted directly into Nginx. Do not use plain `docker compose config`; it prints expanded secrets. The launcher uses `config --quiet`. After pulling the locked image, it copies `/etc/postgresql-custom` from a stopped image container with preserved ownership and modes into an empty data-disk config directory. Required config files and `conf.d` must be present. An existing nonempty config/key directory is validated and never overwritten.

## Independent guard and startup

Package only allowlisted Function sources:

```sh
python3 infra/azure/scripts/package-guard.py /protected/cost-guard.zip
az storage blob upload --auth-mode login --account-name ACTUAL_GUARD_STORAGE --container-name deployments --name cost-guard.zip --file /protected/cost-guard.zip --overwrite --output none
```

Linux Consumption uses a private Blob package URL, read by the Function identity. No SAS/account key is required. Configure `COST_GUARD_CONFIG_JSON` using the current `cost-guard/config.example.json` and its schema, actual deployment outputs, actual grant dates and conservative rates. Begin with `dryRun:true`; initialize the guard-state ledger explicitly and upload fresh verified financial evidence. Inspect the dry-run result before changing `dryRun:false`. Do not invent credit snapshots. Restart the Function and sync triggers after replacing its package. Verify its five-minute independent heartbeat, error alert and one-instance behavior before traffic.

Role boundaries: VM reads control, writes only telemetry/backups, reads Academy secrets and pulls Academy images. The guard writes control/state, reads financial-input/telemetry, observes the exact group, and can deallocate only the named VM. The VM cannot forge grant evidence or guard state. The guard has no disk deletion, VM resize/start or unrelated-resource mutation.

Once a fresh independent control exists, initialize the gateway once:

```sh
sudo /opt/vfuture-academy/infra/azure/scripts/start-runtime.sh --initialize-state
sudo systemctl enable --now academy-runtime.service
```

Ordinary restarts use `systemctl start academy-runtime.service`; never initialize the ledger again. Runtime startup refuses absent data/object mounts. `BindsTo` stops the unit if either mount disappears. A Docker service mount dependency also prevents container restart policies from starting before those mounts; boot/unmount behavior remains a Linux rehearsal gate. The gateway ledger, host telemetry sequence and backup state are outside the object quota. A stale/missing control never becomes normal. A crash-held gateway lock requires checking no process is alive and inspecting ledger integrity before removing only the lock, never the ledger.

Apply reviewed Academy migrations before public traffic. Enable the self-host exam admission row explicitly and assert exactly one returned row:

```sql
UPDATE public.academy_runtime_limits
SET max_active_exam_attempts = 25
WHERE singleton = true
RETURNING max_active_exam_attempts;
```

## Daily backup, financial drain and recovery

After a successful rehearsal, set `dailyBackupEnabled:true` in the protected host config and enable `academy-daily-backup.timer` plus `academy-cost-backup.timer`. Daily runs are at 02:00 Vietnam time. They wait up to two hours for ongoing exams, then ask the independent guard for a bounded scheduled drain. The guard admits it only with fresh financial evidence and no active exams. A financial/protective hold never becomes a routine-backup resume.

For scheduled backups the coordinator requires zero active exam attempts. For financial stops, the independent guard applies its bounded 120-second critical-save grace where allowed, then publishes a full financial drain; the coordinator preserves in-progress exam rows and does not wait indefinitely for semantic completion. This can interrupt an exam and is an explicit cost-protection tradeoff. The coordinator then stops TLS/gateway/Auth/REST/Storage/Studio/meta with 130-second grace, disables new cron jobs, waits for SQL writers, and makes new database transactions read-only. Root-operated private backup/control commands use `supabase_admin`, because the pinned image demotes ordinary `postgres`; this privilege is not given to public API or Studio clients. It takes a serial PostgreSQL dump/roles backup, hashes every object, and includes persistent gateway/host-telemetry/config/secrets state in an **age-encrypted** archive. Archive uploads use 4 MiB blocks, VM identity, an exclusive blob name, and verify committed size/checksum metadata. Only then does it flush PostgreSQL and publish the real checkpoint receipt, including the observed count of in-progress exams. Failure never fabricates `backupCompleted:true`. A pending local receipt is not a publication acknowledgement: conditional Blob writes and exact read-back must succeed. Restarts retry the same receipt and timestamp; expired evidence requires real revalidation and operator attention.

The independent guard must issue a new normal control after the matching receipt before the coordinator resets read-only/cron and restarts writers. Financial drain leaves services stopped for the guard's exact-VM deallocation. Failed requests, active exams past the wait window, upload failures, or safe-resume delays produce `telemetry/backup-alert.json` and a failed service. The guard reads that alert and fails its invocation with a static operator-attention reason. **Configure and test a notification for failed/missing guard invocations before enabling production.** No direct outbound email was sent by this implementation.

Backup is bounded to 12 GiB per archive and 300 GiB total observed committed, soft-deleted and uncommitted Blob bytes, with a further 12 GiB failed-upload reserve before admission. It keeps the newest recovery point for seven daily, four ISO-weekly and three calendar-monthly periods, deleting only expired recognized backup archives with matching ETags. Learner objects and live data are never pruned. Fixed daily/drain cycle IDs make retried uploads idempotent and reject replacement by different bytes. The successfully uploaded local encrypted cache retains only the newest copy; unverified failed archives are preserved and staging free space is checked. Unknown provider usage fails closed. At the approved full 300 GiB ceiling, model about $8.05/month for ZRS backup storage, approximately $6.80 above the initial 50 GB allowance; conservative retainedDailyUsd is 1.5 until actual rates are verified. Actual use below the ceiling costs less. Retention and soft-delete/block accounting require a hosted drill before sustained daily operation.

For a restore drill, record elapsed time from failure declaration to user acceptance, use isolated approved resources, and keep production untouched. Download an encrypted archive with an operator identity, decrypt using the offline age identity, and run `verify-backup-archive.py` on the decrypted tar before extraction. It rejects path traversal/symlinks and verifies full object checksum coverage. Restore the same pinned Supabase version with reviewed roles/ownership, DB extensions, Auth data, objects, pgsodium configuration, gateway/host ledgers and original secret material. Do not blindly replay reserved role creation into an initialized Supabase cluster. Never reset quota ledgers to zero when recovering a month in progress. Verify every restored object, RLS/RPC/permissions, password login, OAuth callbacks, SMTP, signed transfers and active exam recovery. Only a **complete timed drill ≤4 hours** proves the RTO; the backup script alone does not. A successful backup less than 24 hours old is required for the RPO target.

Initial migration from Supabase Cloud uses the supported filtered export/restore procedure, not this same-version self-host disaster backup. Copy Storage objects/settings and Auth provider configuration separately, preserve approved Academy IDs/password hashes, and expect reauthentication. MCP remains disabled until its separate compatibility gate passes. Cutover must be outside exams, with write freeze and exactly one scheduler. Reverse cutover after new writes requires reconciliation.

## Required validation before release

Local: Bicep compilation, focused infrastructure/gateway/cost-guard tests, Python/shell syntax, then the repository's complete Graphify refresh/check and verify:local sequence. Review and commit the tracked Graphify manifest with source; keep graphify-out ignored. GitHub Actions remains deployment-only.

Hosted: validate policy denies and identities; inspect effective NSG/IPv6/Docker exposure; run 25 same-NAT learners through login/autosave/submit with exhausted CPU credits and pool pressure; exercise requests at deadlines, quota replay/chunked bodies and restart counters; fill the separate object filesystem and confirm PG retains space; unmount it and verify runtime stops; test daily/financial drain and delayed backup alerts; verify ACR/ACS benefits, actual ingestion/egress, grant balance and after-stop charges. Require autosave p95 ≤2s, submit p95 ≤5s, no OOM, no lost acknowledged answers, no duplicate completion and no cross-user access.

Sources inspected: [pinned upstream Compose](https://github.com/supabase/supabase/blob/831d6302c7361c0a5115a91e953bdf084eb85330/docker/docker-compose.yml), [Supabase Docker requirements](https://supabase.com/docs/guides/self-hosting/docker), [filtered Cloud-to-self-host restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [Functions package/managed-identity deployment](https://learn.microsoft.com/en-us/azure/azure-functions/deployment-zip-push), [ACS SMTP setup](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication).
