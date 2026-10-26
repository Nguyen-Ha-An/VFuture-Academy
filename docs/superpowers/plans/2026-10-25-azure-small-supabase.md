# Small self-hosted Supabase on Azure Singapore

Status: implementation started after the user's "continue" on 2026-10-25.
This supersedes the topology in the 2026-10-24 plan. No production cutover or
cloud verification is implied by repository checks.

## Selected target

- Vercel frontend, APIs and browser-executed notebook runtime; functions in sin1.
- One Azure Singapore B2als_v2, 2 vCPU / 4 GiB, with pinned Supabase PostgreSQL,
  Auth, PostgREST, Storage and HTTPS gateway. No automatic larger-SKU fallback.
- Two P6 64 GiB disks (OS/data), one Standard public IPv4, private container ports.
- Studio/meta on demand through an operator SSH tunnel; no public administrative services.
- Omit unused Realtime, Edge Runtime, image transformation, analytics and pooler services.
- Azure Blob ZRS encrypted backups, ACS SMTP, ACR, Key Vault, bounded monitoring.
  Retained backup capacity is 300 GiB, with 12 GiB maximum archives and
  7 daily / 4 weekly / 3 monthly checkpoints including soft-delete accounting.
- 500 MAU / 25 simultaneous learners. Four-hour recovery and daily-backup
  24-hour RPO are targets requiring a complete timed restore drill.

## Cost contract

The user confirms $2,000 grant credit. The portal showed temporary free-service
meters expiring 2027-10-23. Match real resource meter IDs before deducting benefits.
Expected average monthly cost after the retention correction: $52.06 with applicable
disk/Standard-registry/transfer benefits, $72.48 if disks are paid but the registry
benefit remains, $79.34 without temporary benefits. Basic registry is the conservative
deployment default and costs about $5.07/month even during the benefit period.
The 50 GB monthly transfer ceiling adds at most $3 to the 25 GB pricing scenario.
Operator-reviewed operating forecasts are $65/month with benefits and $85/month
without; these are distinct from the spending envelopes and do not raise them. Use a
$70/month operating envelope with confirmed benefits, otherwise $90/month.
Academy annual allocation is min(1080, remaining credit - committed other
project spending - 400 reserve). Do not provision if it cannot cover the period.
Azure credits do not pay Vercel/Supabase Cloud bills. Budgets do not enforce a
hard dollar stop; telemetry delays and continuing durable-storage charges remain.

Restrict resource types, names, region and SKUs within Academy resource groups.
No autoscale, automatic disk growth or unrestricted creation. A separate cost
guard inspects only allowlisted Academy resources every five minutes. Warn at
80%, stop discretionary work/new exam starts at 90%, drain/checkpoint/deallocate
the named VM at 95% or insufficient remaining reserve. If exams are active,
allow a fixed 120-second critical-save grace, then drain actual requests and
preserve in-progress rows in the backup; do not wait indefinitely for exams to finish.
Include delayed charges
and retained-storage tail in decisions. Never stop the subscription or unrelated
projects, delete durable data, or claim zero possible overrun.

## Runtime limits

All public traffic enters the gateway on HTTPS. Public paths are necessary Auth
and signed object transfers only. REST/RPC and administrative paths require a
server-only x-vfuture-gateway-key plus ordinary Supabase credentials. The app
uses optional SUPABASE_GATEWAY_KEY during transition; never NEXT_PUBLIC.
Move browser profile-state reads to an authenticated app endpoint before denial.

- Backend 60 requests/sec, burst 60, 16 in-flight plus queue 16.
- Existing per-user exam answers/events/lifecycle: 120/30/10 per minute.
- Existing quiz checks/submissions: 60/20 per minute.
- Admit at most 25 concurrent exam attempts atomically; never evict active users.
- Auth: 10 requests/sec global and a burst of at least 25; coarse school-NAT
  limits plus per-account protection. Email 100/hour, 200/day, 2000/month,
  recipient cooldown 60 seconds.
- Uploads: one active/user, four globally, 10 reservations/minute/user; signed
  direct transfers, atomic quota reservation, user/path/bytes/expiry binding.
- Downloads: four active/user, 16 globally, 100 MiB/user/day, 2 GiB/site/day.
- Persistent outbound ceiling 50 GB/month; warning 40 GB, discretionary stop
  45 GB with critical-write reserve. Counters survive restarts and fail closed.
- Uploaded objects initially 10 GB; no silent deletion of academic evidence.
- One background job, bounded three retries; heavy jobs outside exams.
- Local logs 100 MB/day and seven-day retention; cloud ingestion 0.5 GB/month.
- PostgreSQL max_connections 40, PostgREST pool 8, Auth/Storage pools 4 each,
  backup 1, scheduler <=2. Pool wait 3s, normal SQL 10s, locks 2s, idle tx 15s.
- Memory MiB: PG1536, Auth192, PostgREST192, Storage384, gateway192,
  monitoring64, backup256. Studio/meta off during classes; no swap-based sizing.

## Implementation work packages

1. Application transport and resilience: server-only gateway credential in all
   relevant clients; authenticated profile-state route; autosave request timeouts,
   Retry-After/backoff/jitter, preserve pending drafts and ambiguous-success handling.
2. Azure infrastructure: fixed resource inventory, narrow policies/identities,
   reproducible pinned Supabase runtime, private ports, persistent disks,
   secrets bootstrap, backups and deployment/recovery runbooks.
3. Gateway: deny bypasses, strip untrusted headers, bounded routing/concurrency,
   persistent transfer quotas and maintenance admission with executable tests.
4. Cost guard: conservative pure decision model, exact-resource scope checks,
   dry-run by default, independent scheduler and tested protective transitions.
5. Application uploads/shared limits: signed upload reservation/finalization,
   persisted object quotas, global public limits and exam admission; preserve API
   semantics and existing correctness tests.
6. Integration and release: independent review, local gates, inspect actual
   subscription before provisioning, rehearse identity/data/object migration,
   validate actual charges and sustained small-VM load, then controlled cutover.

## Required evidence

TDD for changed behavior. Test school-NAT 25-user bursts, exhausted CPU credits,
pool saturation, retries at deadlines, unauthorized direct endpoints, forged
headers, replayed upload grants, malformed/chunked oversize bodies, restarting
quota counters, and cost-stop isolation. No OOM, lost acknowledged answers,
duplicate completion, false saved state or cross-user disclosure. Normal-load
autosave p95 <=2s; submit p95 <=5s. Do not claim capacity without hosted evidence.

Migrate only approved Academy data; preserve IDs and password hashes where
compatible; copy Storage objects and settings separately; configure providers,
callbacks, SMTP and keys; expect reauthentication. MCP compatibility gates any
previously enabled MCP capability. Cutover outside exams with write freeze and
one authoritative scheduler. Reverse cutover after new writes requires reconciliation.

After all edits: npm run graphify:refresh; npm run graphify:check;
npm run verify:local. Commit/review the manifest, keep graphify-out ignored.
GitHub Actions stays deployment-only. Production/data/hosted gates are separate.
