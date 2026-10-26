# VFuture Academy Azure Infrastructure Implementation Plan

> Historical proposal. The selected implementation is now the [small Singapore Supabase plan](2026-10-25-azure-small-supabase.md), retaining Vercel and using B2als_v2. The rates and scenarios below describe the older all-Azure topology, not the current deployment target.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host Academy's frontend, application APIs, authentication, database, private files, and notebook delivery on Azure within a USD 2,000 annual nonprofit grant where measured usage permits.

**Architecture:** Start with Linux App Service for the existing Next.js application and a separate notebook origin. Run the compatible Supabase stack on a dedicated Azure VM, retaining PostgreSQL/RLS/RPC/Auth/Storage semantics. Use Azure Blob for independent backups; externally hosted video stays external.

**Tech stack:** Next.js 15.5.25, React 19.1, Node 24, npm 11; Linux App Service; Azure VM and managed disks; pinned self-hosted Supabase Docker services; ACR, Key Vault, Azure Monitor, Azure Communication Services email; Bicep.

**Spec:** User request of 24 October 2026: both front and back on Azure, detailed infrastructure and rate limiting, USD 2,000/year grant, per-user usage and fixed versus consumption pricing. User clarified: mostly lessons/quizzes, externally embedded videos. This document contains the proposed infrastructure specification and its implementation tasks.

**Status:** Planning proposal only. No Azure resources, deployments, credentials, DNS changes, or data migrations have been created. Public retail prices were retrieved on 24 October 2026; the tenant's credit balance, offer, SKU availability and production traffic were not inspected. Capacity figures below are assumptions to test, not measured results.

## 1. Decision and boundaries

**Recommend a fixed-cost launch: approximately $131/month before excess bandwidth, with an operating target of $140/month.** Start by qualifying 500–2,000 monthly active learners and a 50-person simultaneous class. These are initial test targets, not guaranteed capacity. The larger 5,000/10,000-user rows are cost sensitivity scenarios.

This recommendation depends on having an operator who can maintain and restore PostgreSQL and the Supabase services. The grant does not pay that person's time. If no operator is available, choose a managed-backend design and explicitly fund its extra cost and migration work; do not quietly remove backups or security to fit the grant.

**Global constraints**

- The grant averages $166.67/month but is an annual credit, not a monthly refill. Budget $1,680/year for regular operation and keep $320 for staging, incidents, growth and renewal delays. Other projects sharing the credit reduce Academy's allowance dollar-for-dollar.
- All Academy hosting/data services in the recommended design are Azure resources. Supabase here is open-source software running on Azure, not a paid Supabase Cloud project. External video/provider OAuth remain external dependencies by the user's choice.
- Singapore / `southeastasia` is the pricing and initial deployment assumption for Vietnamese learners. Confirm latency from actual schools, organizational data-location requirements, quota and offer availability before provisioning.
- Preserve independent Academy ownership. Do not point migrations at the old Central backend. Competition remains separate.
- Keep historical SQL immutable and preserve the migration ledger. Supabase self-hosting compatibility, including Auth and Storage schemas, is a release gate.
- Keep builds, Graphify, tests, lint, type checks, SQL and browser contracts local. GitHub Actions is deployment-only.
- Run pinned Graphify 0.9.91 with the repository wrapper; no semantic APIs, no credential/runtime indexing. Commit the manifest with any eventual implementation commit; keep `graphify-out/` ignored.
- Keep `STUDIO_MCP_ENABLED=0` until the self-hosted OAuth server, discovery, consent and revocation flows pass independently.
- Prices exclude taxes, domain purchase, operator time and any third-party charges. They are retail estimates, not an Azure invoice or an approved purchase.

**Review focus**

1. Spoofed forwarding headers and a whole school sharing one IP must not defeat throttling or lock out the class.
2. Simultaneous exam autosaves/submits and retries must not lose answers or create duplicate submissions.
3. Restoring the database without the matching private files must not be mistaken for a successful recovery.
4. Multiple application instances must not multiply anonymous quotas or leak cached private responses.
5. Self-hosted Auth may differ from the managed service assumed by current OAuth/MCP integration; verify the actual pinned release.

## 2. What the repository actually needs

Inspected at commit `0713e75a92627fafe39df8795444007e640c83bf` using the existing Graphify graph for discovery, then source inspection. Graph traversal is not runtime proof.

| Current evidence | Infrastructure implication |
|---|---|
| `package.json`: Next.js 15.5.25, Node 24; `src/app/api/v1/` routes | One Node deployment can serve both frontend SSR and application APIs. No reason to split every API into a separate paid service. |
| `src/lib/supabase/`, `supabase/migrations/`, media/notebook storage implementations | PostgreSQL alone is insufficient: preserve Supabase Auth, PostgREST, roles, RPCs, RLS, storage API and signed-object behavior. |
| `src/lib/rate-limit.ts`, `0021_rate_limit_expiry.sql` | Shared atomic fixed-window limiter already exists in PostgreSQL, fails closed with 503, rejects with 429 and `Retry-After`. |
| `src/features/marketing/public-http.ts` | Public catalog limiter is currently process-local: 60/minute, bounded maps. It is not a global limiter across replicas. Cookie-minting responses are private/no-store. |
| `notebook-runtime/README.md` | JupyterLite/Pyodide runs in the browser; separate origin, COOP/COEP/CORP/CSP required. No Azure Python VM per learner. Notebook snapshots cap at 5 MiB; decoded datasets at 20 MiB. |
| `.github/workflows/deploy.yaml`, `docs/deployment.md` | Existing deployment targets Vercel. Azure needs a replacement deployment-only workflow and new local container packaging. |
| `docs/database-ownership.md` | New infrastructure and data migration were deferred; this planning request does not execute them. |
| Public legal copy and repository search | No implemented subscription/billing tiers were found. Learner pricing later in this plan is an optional business model, not existing product pricing. |

Azure Static Web Apps' hybrid Next.js integration is still documented as preview with limitations. Use ordinary Node hosting for the main application rather than relying on that adapter. [Microsoft documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/deploy-nextjs-hybrid)

## 3. Proposed topology

```mermaid
flowchart TB
    U[Student or staff browser] --> W[Academy HTTPS origin\nNext.js on Linux App Service B1]
    U --> N[Separate notebook HTTPS origin\nStatic runtime app on same App Service plan]
    U --> G[Supabase HTTPS origin\nTLS gateway on Azure VM]
    W --> G
    G --> A[Auth and PostgREST and Storage API]
    A --> D[PostgreSQL and private files\nPersistent Premium SSD]
    D --> B[Encrypted backup sets\nAzure Blob with retention]
    W --> K[Key Vault and managed identity]
    A --> E[Azure Communication Services SMTP]
    W --> M[Bounded logs and Azure Monitor]
    A --> M
    U --> V[External video provider]
```

Hostnames are to be selected from the organization's controlled domains; do not assume the example names below already exist.

| Resource | Initial specification and purpose |
|---|---|
| App Service plan | Linux B1, one instance: 1 vCPU / 1.75 GB. Always On; main Next.js container plus a small static-runtime web app. Upgrade to B2, 2 vCPU / 3.5 GB, if measured memory/latency requires it. |
| Main web app | `academy.<owned-domain>`; SSR, `/api`, Studio, Admin, Grading and authentication callback UI. Nonroot Node 24 container; immutable digest. |
| Notebook web app | `notebooks.<owned-domain>`; independent app/container, only public JupyterLite assets, no application secrets or shared domain cookies. Same plan shares CPU/memory; separate origin is browser isolation, not compute isolation. |
| Backend VM | Linux `Standard_D2as_v5`, 2 vCPU / 8 GiB, nonburstable. Pin Supabase component images and OS baseline. Restrict Studio/admin services to the operator management path. |
| Persistent disks | E4 Standard SSD 32 GiB OS, P10 Premium SSD 128 GiB data. Separate directories/volumes for PostgreSQL and private Storage objects. Nothing durable in container writable layers. |
| Backend gateway | HTTPS-only `backend.<owned-domain>`; reverse proxy to Auth, PostgREST, Storage and only required public routes. PostgreSQL/pooler/admin ports never publicly exposed. TLS renewals monitored. |
| Network | One VNet, backend subnet and NSG. Explicit outbound access through the VM's budgeted Standard public IP. Inbound 443; 80 only if the chosen certificate challenge requires it. SSH disabled by default, opened temporarily to an operator IP when needed. |
| Registry and secrets | ACR Basic; managed identity pull. Key Vault for server-only secrets with least-privilege access. Separate identities for app, backup writer and deployment. No keys committed or placed in notebook assets. |
| Backups | Blob container in a separate storage account/resource group, scoped backup identity, retention/deletion protection; PostgreSQL base backup + WAL and private-object versions/manifest. |
| Email | Azure Communication Services SMTP for Supabase Auth mail. Verify sender domain, SPF/DKIM/DMARC, delivery and quota. This is a variable allowance, not free email. |
| Monitoring | Azure platform metrics plus sampled application traces; no request bodies, answers, tokens or signed URLs in logs. Application audit events remain durable and unsampled in their controlled store. |

App Service apps on one plan share capacity and scaling; they are not separately billed full plans. Basic lacks the deployment-slot/autoscale capabilities of higher tiers, so use maintenance-aware digest rollback and explicit scale decisions. [App Service plans](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)

Supabase's published baseline is 2 CPU/4 GB minimum and 4 CPU/8 GB+ recommended. Our 2 CPU/8 GiB backend is above minimum memory but below recommended CPU; prove it under Academy workloads before launch. Leave optional analytics, Realtime and Edge Runtime out only after verifying no app dependencies; retain required Storage/Auth services. [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)

Use the Supabase Storage file backend on the persistent disk initially. Azure Blob is the backup destination; changing `SUPABASE_URL` does not convert Supabase Storage into Blob. A direct Blob migration requires storage-adapter and authorization work. [Storage configuration](https://supabase.com/docs/guides/self-hosting/storage/config)

Do not put PostgreSQL on ephemeral Container Apps storage. Do not add AKS, API Management, Redis, NAT Gateway, Front Door or dedicated private-endpoint infrastructure without a separate measured need and budget. The basic launch has no paid edge WAF; application/gateway limits reduce abuse but do not provide an enterprise DDoS guarantee.

## 4. Grant accounting and price evidence

Microsoft documents the $2,000 annual grant, annual renewal, no rollover, and first-party Azure coverage. Reserved instances, third-party marketplace offers and support plans are excluded. Confirm the actual offer and expiry in the nonprofit/credit portal. [Grant terms](https://learn.microsoft.com/en-us/industry/nonprofit/microsoft-for-nonprofits/claim-activate-nonprofit-azure-grant)

Sponsorship can convert to pay-as-you-go at the credit cap or expiry. Do not assume the account stops spending at $2,000. Cost budgets alert; they do not stop resources. Maintain an owner-reviewed response runbook. [Sponsorship offer](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0036p/) · [Budget behavior](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

The companion [rate snapshot](2026-10-24-azure-academy-rates.json) preserves exact public API queries, meter IDs, units, region, effective dates and returned prices. Queries exclude Windows/Spot/Cloud Services VM products. Use the signed-in Azure calculator as the final offer-specific check. [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)

### Monthly bill of materials

730 hours/month; ACR uses 365/12 days/month. Dollar figures are USD.

| Item | Calculation / allowance | Monthly |
|---|---|---:|
| Linux App Service B1 | $0.018/hour × 730 | $13.14 |
| D2as_v5 Linux VM | $0.108/hour × 730 | $78.84 |
| OS E4 SSD | One disk | $2.40 |
| Data P10 SSD | One disk | $19.71 |
| Standard IPv4 | $0.005/hour × 730 | $3.65 |
| ACR Basic | $0.1666/day × 365/12 | $5.07 |
| DNS | Planning allowance; replace with actual zones/query volume | $0.60 |
| Key Vault | Planning allowance | $0.25 |
| Monitoring | Planning allowance with collection/retention caps | $3.00 |
| Blob backups | Approx. 100 GB × $0.02 + $1 operations allowance | $3.00 |
| Auth email | Low-volume planning allowance; verify delivered-message meter | $1.00 |
| OS disk transactions | Planning allowance; P10 base disk price is separate | $0.50 |
| **Baseline, before excess egress** | Unrounded total $131.1574 | **$131.16** |
| **Annual baseline** | Unrounded monthly total × 12 | **$1,573.89** |
| **Grant remaining** | $2,000 − annual baseline | **$426.11** |

The first six rows are queried retail meters; other rows are explicit planning allowances, not vendor quotes or fixed caps. Backup retention, Log Analytics ingestion and email volume must be reconciled against actual usage weekly. Registry storage above the included allowance, inter-region traffic, additional backup copies, and staging come from the remaining budget. Taxes and any cash-only services must be assessed separately.

The $140/month operating target leaves $320/year after normal operation and allows about $8.84/month above this baseline. A temporary rehearsal environment must be deleted/deallocated after testing; disks/IPs still cost money if only compute is stopped. B2 adds **$13.14/month**, raising the baseline to **$144.30/month / $1,731.57/year** before excess egress.

A burstable B2as_v2 VM is $68.91/month in this region, only about $9.93 less than D2as_v5. Prefer the latter for predictable exam/database CPU; do not trade exam reliability for a small saving without credit-exhaustion load tests. VM sizing and disks remain independent charges. [Dasv5 specifications](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dasv5-series)

## 5. Actual-usage model: what one learner consumes

No production telemetry was supplied. This is a workload model to replace with measured data during a two-week pilot. Registered accounts, monthly active learners, simultaneous learners, active HTTP requests and CPU cores are different quantities.

**Baseline active learner per month:**

- 8 learning sessions, averaging 30 minutes: 4 hours with the website open.
- 75 dynamic application requests/session: **600 dynamic requests/month** for navigation, content, progress, quiz checks, autosaves and submission activity.
- 400 additional static/runtime HTTP requests/month: **1,000 total HTTP requests/month**. Static responses use less CPU but still count on a request-metered host.
- Assumed **50 ms application CPU** per dynamic request: **30 CPU-seconds/month**. Video playback, reading and browser Python time do not keep a server core allocated to that learner.
- Assumed **250 ms response duration** per dynamic request. Latency includes waiting and is not identical to CPU consumption.
- Assumed **6 database/API operations per dynamic request**, including actor/permission checks and limiter claims: 3,600 operations/month. This is not an Azure SQL per-query bill; it is a database load estimate.
- **50 MB/month** downloaded from Azure after caching, including a weighted share of notebook assets, images, JSON and private downloads. This is an optimistic text/quiz-focused baseline. Measure cold-cache JupyterLite downloads separately.
- Average retained data at planning horizon: **2 MB database + 5 MB private files per active learner**, plus 10 GB shared content/system data. This is a footprint assumption, not a monthly growth rate or a per-user storage entitlement. Inactive users' retained records still count.

**Formulae**

```text
dynamic requests = MAU × sessions/month × dynamic requests/session
app CPU hours = dynamic requests × CPU seconds/request / 3,600
database operations = dynamic requests × operations/request
egress GB = MAU × downloaded MB/month / 1,000
bill = fixed services + variable services + excess egress + scale upgrades
average infrastructure cost/active learner = total monthly bill / MAU
```

Asia internet egress is currently published as first 100 GB/month free, then $0.12/GB for the next band. Count the free allowance once across the applicable billing scope, not once per service. Use the no-free-allowance sensitivity if the offer or other workloads consume it. [Azure bandwidth](https://azure.microsoft.com/en-us/pricing/details/bandwidth/)

| MAU | Dynamic req/mo | App CPU hours/mo, assumed | DB operations/mo, assumed | Egress at 50 MB/user | B1-stack monthly | Annual | Average $/MAU-month |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 300,000 | 4.17 | 1.8 million | 25 GB | $131.16 | $1,573.89 | $0.262 |
| 2,000 | 1.2 million | 16.67 | 7.2 million | 100 GB | $131.16 | $1,573.89 | $0.066 |
| 5,000 | 3 million | 41.67 | 18 million | 250 GB | $149.16 | $1,789.89 | $0.030 |
| 10,000 | 6 million | 83.33 | 36 million | 500 GB | $179.16 | $2,149.89 | $0.018 |

These retain the same hardware to isolate billing effects; they do not certify that one B1/one VM serves the larger populations. Monitoring, backup/storage growth or capacity upgrades can increase every row. At 10,000 MAU, even this model exceeds the grant by about $150/year before upgrades. If B2 is required, add $13.14/month to each row.

**Sensitivity at 2,000 MAU**

| Variable | Scenario | Consequence |
|---|---|---|
| Downloads | 50 / 150 / 500 MB per user-month | 100 / 300 / 1,000 GB; egress $0 / $24 / $108; stack $131.16 / $155.16 / $239.16 per month. |
| Cold notebook downloads | Extra 100 MB for every learner | Adds 200 GB; usually +$24 if the free egress allowance was already used. Measure real asset size and cache hit rate. |
| CPU/request | 20 / 50 / 100 ms | App CPU 6.67 / 16.67 / 33.33 hours/month; peak required cores vary fivefold across this range. |
| Lost 100 GB allowance | Other workloads or offer treatment | Adds up to $12/month at these volumes; do not count savings twice. |
| Data retention | 10 GB shared + 2,000 × 7 MB | Approximately 24 GB live footprint, before indexes, WAL and operational headroom. Check total registered/retained users, not only MAU. |
| Future monthly growth | 1 MB/user/month retained for 2,000 users | +24 GB/year before indexes and backup versions. Decide retention before increasing upload quotas. |

Embedded videos keep bulk video delivery off Azure. Any future server-side AI, GPU or Python execution needs a separate budget and cost-based quota; none is included here.

### Peak load, not account count, determines compute

Assume an active learner generates one dynamic request every 5 seconds during an exam. At 50 ms app CPU/request and a 60% utilization target:

```text
peak RPS = concurrent learners / 5
required effective app vCPU = peak RPS × 0.05 / 0.60
```

| Simultaneous learners | Dynamic RPS | App vCPU model | DB operations/sec at 6/request |
|---:|---:|---:|---:|
| 50 | 10 | 0.83 | 60 |
| 200 | 40 | 3.33 | 240 |
| 500 | 100 | 8.33 | 600 |

Thus B1 is an initial candidate for 50 concurrent learners, not a promise for 200. Extra CPU helps only if the Node process/replica arrangement can use it; one event loop does not make every request parallel on all cores. SQL transaction cost, lock contention, disk IOPS, memory, runtime download storms and certificate/report generation also require measurement.

For a 200-person scheduled exam, rehearse at least four effective app vCPUs and verify backend headroom; warm capacity before the event. Two B2 instances would add $39.42/month if kept all month relative to one B1, but only about $2.16 for 40 hours at the same retail hourly rates. This is a hardware price illustration, not proof that that process layout or database meets the exam load. Resizing/restarts happen outside active attempts.

## 6. Fixed hosting versus usage pricing

| Option | Billing | Fit |
|---|---|---|
| **App Service B1/B2 + VM backend** | App plan and VM billed while provisioned; disks/IP/registry continue separately; network/logs/email variable | Recommended predictable launch with existing Next.js/Supabase behavior. One backend VM is a failure domain. |
| Container Apps Consumption + same VM backend | Allocated vCPU-seconds + GiB-seconds + request meter, plus backend's fixed costs | Useful for an intermittent app with acceptable cold starts. Does not make PostgreSQL free or serverless. |
| All components on one Azure VM | VM/disk/network mostly fixed | Saves the $13.14 app plan but puts web deployment, database and static bursts in one failure/resource domain; rejected as the default. |
| App Service + managed PostgreSQL + hosted Auth/API/Storage services on Azure | Database baseline plus extra service hosting | Longer-term option; needs compatibility proof or application redesign. Managed PostgreSQL is not a Supabase drop-in. |

### Container Apps regional rates and honest per-request arithmetic

Southeast Asia queried rates: active CPU **$0.000034/vCPU-second**; memory **$0.000004/GiB-second**; idle CPU **$0.000004/vCPU-second**; idle memory **$0.000004/GiB-second**; external requests **$0.40/million**. These differ from cheaper-region examples online.

Azure documents monthly subscription-level allowances of 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests. Confirm their availability on the actual offer and subtract other apps' use. Idle eligibility has CPU/network/request conditions; a warm container is not automatically billed idle. [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)

For a **0.5 vCPU / 1 GiB replica**:

```text
active cost/hour = (0.5 × 0.000034 + 1 × 0.000004) × 3,600 = $0.0756
idle cost/hour = (0.5 × 0.000004 + 1 × 0.000004) × 3,600 = $0.0216

Illustrative active replica-hours = dynamic_requests × 0.25 seconds / 3,600 × 1.30
```

The 1.30 multiplier is an assumed allowance for startup/scale-down/other activity. Actual concurrency can reduce summed replica time, while widely separated sessions, health/background activity and scale-down delay can increase it substantially. Measure billed active/idle seconds; request count alone cannot predict compute cost. Confirm 1 GiB fits the app before adopting this SKU; 1 vCPU/2 GiB doubles the gross hourly compute rate.

With matching CPU/memory ratios, the stated free allowances cover 100 active replica-hours for that SKU. Do not subtract an allowance again from other apps.

| MAU | Assumed active replica-hours | App-only scale-to-zero compute + total HTTP meter, with available allowances | Same without allowances |
|---:|---:|---:|---:|
| 500 | 27.08 | $0.00 | $2.25 |
| 2,000 | 108.33 | $0.63 | $8.99 |
| 5,000 | 270.83 | $14.12 | $22.48 |
| 10,000 | 541.67 | $36.59 | $44.95 |

This intentionally simplified scenario counts all modeled HTTP requests on ACA but derives its compute mostly from dynamic requests plus the 30% allowance. It is not an invoice forecast or a capacity guarantee. Add **$118.02/month** for the rest of the baseline stack, plus egress and any separate runtime hosting. Compare against App Service's $13.14, not against the entire stack bill.

For an always-warm minimum replica, gross monthly compute is:

```text
$0.0756 × active_hours + $0.0216 × idle_hours
```

One replica active all 730 hours costs **$55.19**, versus **$15.77** if genuinely idle throughout, before allowances and request fees. At 240 active and 490 idle hours it is **$28.73**. This is why the fixed App Service plan can be the better choice for school-day use.

Ignoring allowance allocation and request fees, active-only ACA compute crosses B1's price at **174 active replica-hours/month**, or about **274 hours** if all 100 free hours are available. B1 and this ACA allocation do not have identical resources; load-test equal service levels before using cost alone to choose.

A 250 ms request on that ACA allocation, assuming it exclusively occupies the replica for that interval, costs about **$0.00000565** gross including its request meter: roughly **$5.65 per million**, not $0.40. Static requests are usually cheaper in compute; overlapping requests share allocated time; slow requests and long-lived streams can cost more. Storage, logs, database and egress remain additional.

### Managed PostgreSQL alternative

The queried regional PostgreSQL Flexible Server B1MS compute is $18.98/month; B2S is $75.92; B2ms is $151.84. Storage is $0.138/GB-month, so 32 GB adds $4.42. HA, backup overage, IOPS choices and supporting services are extra.

A B1MS proof-of-concept could be inexpensive, but must not be sized as equivalent to the recommended 8 GiB backend. At B2S, database compute+32 GB storage+App Service B1 is already **$94.48/month** before Auth/PostgREST/Storage hosting and operations. At B2ms those three lines are **$170.40/month**, beyond the entire monthly grant average. Azure's managed roles/extensions differ from a self-hosted Supabase database: audit every required schema, extension, superuser-dependent setup and migration before promising compatibility.

## 7. Rate limiting and spend controls

Rate limits are abuse ceilings, not expected usage, reserved capacity or customer entitlements. Charging the capacity model as if each user used every ceiling continuously would grossly overestimate normal traffic; ignoring sustained abuse would underestimate risk.

### Preserve existing limits initially

| Action | Existing per-user ceiling unless noted |
|---|---:|
| Progress and exam answers | 120/minute each |
| Exam events | 30/minute |
| Exam lifecycle | 10/minute |
| Quiz check / submit | 60/minute / 20/minute |
| Import / upload / validation | 10/minute / 10/minute / 60/minute |
| Assignment submission | 10/hour per learner and assignment scope |
| Notebook upload / finalize / draft | 30/minute each; config 10/minute |
| MCP request / read / validate | 300 / 120 / 30 per minute; feature remains disabled initially |
| Public catalog | 60/minute in each process today; identity handling also has shared-IP effects |

### Add the following deployment safeguards

1. **Trusted identity boundary.** Current code accepts `x-real-ip` or the first `x-forwarded-for` when `TRUSTED_PROXY=1`. Do not merely turn it on in Azure. Trace the actual proxy chain, strip or disregard client-supplied values, derive identity from the platform-appended trusted hop, and normalize IPv4/IPv6. Test forged headers and the default `azurewebsites.net` hostname as well as the custom domain. Keep a deployment-specific signing secret in Key Vault. Cookie identity bookkeeping is also local and needs distributed enforcement where it affects a security promise.

2. **Layered application limits.** Use authenticated user/action buckets for learning writes; retain atomic database claims across instances. For public catalog propose 120/minute per signed session and a separate 3,000/minute network ceiling with a short burst allowance, rather than the existing per-client-sized IP bucket. A shared school NAT must be tested with 200 independent learners. Use a cheap gateway/process prefilter before a shared limiter so every abusive request does not cause a database write. A gateway counter is a local overload control, not a global quota.

3. **Authentication abuse.** Initial proposed failed-login limit: 5 failures per account per 15 minutes; also a broader network envelope, initially 600 attempts/minute for school login waves, with logging and adaptation. Password recovery/email: 3 per account/hour and 30 per network/hour, plus a daily tenant mail budget. Count failures separately from successful sign-in; avoid permanent account lockouts attackers can induce. Auth endpoint controls must cover direct Supabase URLs, not only Next.js routes. Enrollment-day exceptions need a reviewed temporary policy.

4. **Classroom-friendly clients.** Debounce progress/autosave, coalesce changes, add jitter, avoid duplicate event posts and repeated full-content reads. Retries respect `Retry-After` with exponential backoff and jitter. Verify idempotency for quiz/exam/assignment finalization before automatic retries; preserve unsent answers and show retry status.

5. **Work limits.** Bound JSON depth, request body bytes, upload MIME/size and database statement duration using current route contracts. Keep 5 MiB notebook snapshots and 20 MiB decoded dataset limits. Propose one concurrent heavy export/import per staff member and two globally; serialize larger jobs rather than blocking ordinary requests. Use pagination for reports. Per-object file limits do not establish a total-user storage quota: add an atomic byte ledger for future quotas before advertising them.

6. **Distributed correctness and cleanup.** PostgreSQL `rate_limit` remains authoritative for existing writes. Run `rate_limit_gc()` every five minutes with a single scheduled owner and alert on missed runs; verify indexed expiry and no contention with active buckets. For public limits, use shared atomic counters or an audited distributed gateway before increasing replica count. Fixed windows allow up to nearly twice the nominal limit across a boundary; accept this explicitly for retained limits or use a sliding/token bucket for new policies. Do not add Redis until limiter traffic is a measured DB bottleneck and its separate cost is justified.

7. **Overload policy.** Initially target <=60% sustained app CPU, <=70% backend memory and <70% active DB connection budget. Measure useful concurrent request capacity and configure a bounded queue; shed public scraping, analytics and reports ahead of answer saves. Use 503 for unavailable limiter/dependencies and 429 for a user's exhausted allowance. Keep exam submission retries safe. No universal RPS limit is release-approved before the cohort test.

8. **Connection budget.** Initial backend target: 100 PostgreSQL connections total, with <=60 allocated across PostgREST/Auth/Storage/poolers/app jobs, 20 reserved for operations, 20 headroom. Tune against memory and pinned component defaults; do not let each web replica open 100 connections. Use short transactions and check pool queueing during the exam test.

9. **Cost controls.** Configure alerts at $100/$125/$140 actual monthly spend and forecast >$166.67; cumulative annual alerts at $1,400/$1,700/$1,900. Record renewal reminders 60/30/7 days before expiry. These are deployment tasks, not automations created by this plan. Alert on egress >80 GB/month and unexpected daily increases, retained disk >70/80/90%, backup failure and log-volume spikes. Use resource-policy SKU/region restrictions, explicit max replicas if using ACA, no automatic expensive paid-service enrollment, and tag owner/product/environment.

10. **Response to budget pressure.** Stop optional staging/exports first, reduce debug telemetry and excessive downloads, cap nonessential new uploads, then decide capacity/cash funding with the owner. Never automatically stop the database or discard assessment submissions during an exam. Limits cannot guarantee a hard invoice cap during a sustained attack; the grant's conversion terms and operational response still matter.

Azure Monitor ingestion and retention are metered. Keep the $3 allowance through sampling and explicit collection rules, not by assuming logs are free; retain security/audit evidence separately. [Azure Monitor cost model](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs)

## 8. Security, recovery and operational acceptance

- TLS on every public hostname, host-only secure cookies, explicit CORS/callback allowlists, managed identity where possible. Only the public Supabase key is browser-exposed; service-role/database/SMTP secrets remain server-only.
- Key Vault permissions split between deployment, runtime and backup roles. Use GitHub OIDC for deployment; no subscription-owner credential in CI. Managed identities also require scoped RBAC, not blanket access.
- Keep private files under Supabase authorization/signed-download rules. Never make submission buckets public to solve a URL issue. Public learning content is cacheable only after publication/permission checks.
- Preserve notebook frame allowlists, COOP/COEP/CORP, MIME types, WASM headers, and bridge nonce/source/origin checks. Never attach application cookies or secrets to the runtime app. Host-only cookies prevent sibling-domain notebook code from receiving application sessions.
- Target **RPO <=15 minutes and RTO <=4 hours** for the initial single-VM design. These are acceptance targets to demonstrate, not availability promises. WAL archive and private-object backup at least every five minutes; daily base backups and encrypted configuration/secrets recovery material. Keep recoverable consistent DB/object checkpoints; record upload metadata/files reconciliation.
- Retain 7 daily and 4 weekly recoverable sets, subject to measured deduplication and the 100 GB backup allowance. Scope retained monthly copies deliberately. A plain nightly SQL dump only gives roughly 24-hour RPO and does not meet the target. Restore to an isolated VM monthly and before major database upgrades, verify object hashes, Auth identities, enrollments, attempts, grades and signed downloads.
- Initial same-region backups protect against VM/disk/operator failure, not a regional outage. Cross-region immutable copies and a second database node are later funded improvements; do not call this HA or promise 99.9% end-to-end availability.
- Patch OS/components on a scheduled maintenance window; back up and rehearse upgrades before production. Assign a named primary and backup operator and fund their time outside the Azure credit.

## 9. Optional learner/school pricing interpretation

If “pricing per user” means your infrastructure unit cost, use Section 5. If it means what Academy should charge, there is no current subscription implementation to preserve. The following are proposals only:

| Model | Recommendation |
|---|---|
| Free/sponsored learning | Appropriate initial model. Grant funds shared hosting; report real active learners and cost per completed learner to sponsors. |
| School/cohort subscription | Prefer a predictable monthly organization fee with defined active-seat and simultaneous-exam limits, plus an agreed storage allowance. Base it on staff/support/content costs as well as infrastructure. |
| Per-student monthly | Possible for licensed programs. Distinguish registered seats from active seats; budget for inactive retained data. Validate affordability and nonprofit policy before adopting a price. |
| Per-request student billing | Avoid for ordinary lessons/quizzes: refreshes, accessibility and autosave produce requests the learner cannot reasonably control. Use request meters internally. |
| Future expensive add-ons | Separate AI token/spend or server-lab minute quota with explicit opt-in; no unlimited promise backed by a $2,000 grant. |

At 2,000 MAU the baseline gross Azure cost is about $0.066/active learner-month. That is **not** the sustainable selling price. At 500 MAU it is $0.262; a 10% paying share implies only 50 payers, making gross infrastructure alone about $2.62/payer-month. With 2,000 MAU and 10% paying, it is about $0.66/payer-month. Calculate using gross cost even while credits offset cash so the service survives grant expiry.

```text
required monthly revenue = (gross infrastructure + staff + content + support + other costs)
                           / (1 - desired operating reserve fraction)
price/paying learner = required monthly revenue / paying learners
cash Azure outlay while eligible = max(0, eligible annual Azure use - available annual credit)
                                  + ineligible charges + applicable taxes
```

## 10. Implementation sequence and acceptance gates

Indicative effort: 10–15 engineering days plus a two-week observed pilot, assuming no existing-data migration and a competent Azure/Linux operator. Add a separate migration/rehearsal workstream if existing learner data must move. No execution has been authorized by the planning request alone.

### Task 1 — Resolve offer, ownership and measurable launch envelope

**Files:** Create `infra/azure/README.md`, `infra/azure/parameters.example.json`; update `docs/deployment.md` only when Azure implementation is chosen.

**Interfaces:** Inputs are approved subscription ID, region, hostnames, $140 operating target, initial 50-person load target. Outputs are an approved bill of materials and nonsecret deployment parameters.

- [ ] Confirm remaining grant, expiry, billing scope, taxes and other projects' consumption; record the actual credit available to Academy.
- [ ] Reprice the snapshot in the signed-in calculator; verify D2as_v5/App Service availability and permitted vCPU quota.
- [ ] Record real expected MAU, peak cohort, traffic/data retention and whether existing users must migrate.
- [ ] Assign operators and approve maintenance/recovery expectations. If a managed backend is mandatory, replan rather than claiming the VM design meets that requirement.

### Task 2 — Reproducible infrastructure and compatible backend

**Files:** Create `infra/azure/main.bicep`, `infra/azure/modules/{network,backend,app,observability}.bicep`, `infra/azure/backend/compose.yaml`, `infra/azure/backend/proxy.conf`, `infra/azure/backend/backup-runbook.md` and nonsecret configuration templates.

**Interfaces:** Infrastructure consumes Task 1 parameters; exports app endpoints, identity IDs, registry hostname and secret references. Backend exposes existing Supabase HTTP contracts; no public database port.

- [ ] Locally lint/build Bicep and inspect `what-if` for SKUs, public exposure and resource costs before the authorized create step.
- [ ] Pin Supabase images and run a disposable self-hosted compatibility rehearsal: roles/extensions, fresh lexical migrations, Auth schemas, Storage buckets, every required RPC and scheduler contract.
- [ ] Configure independent secrets, TLS, Auth Site URL/callback/recovery, email provider and admin onboarding; test sign-in, reset, sign-out and expired tokens.
- [ ] Configure backups and demonstrate an isolated database-plus-files restore; measure RPO/RTO. Failure blocks learner launch.
- [ ] Keep old Central data untouched. If migration is required, inventory approved rows/objects, preserve IDs or audited mappings, compare counts/hashes and rehearse a separate cutover.

### Task 3 — Azure application and notebook packaging

**Files:** Create `Dockerfile`, `.dockerignore`, `notebook-runtime/Dockerfile`, `notebook-runtime/nginx.conf`; modify `next.config.ts`, `notebook-runtime/build.sh`, `.env.example`, `docs/deployment.md`, `notebook-runtime/README.md`.

**Interfaces:** Locally built images are tagged with source SHA and deployed by digest. Main app serves current routes on configured port; runtime serves the existing static artifact on its own origin.

- [ ] Add standalone Next.js packaging; include public/static assets, certificates/fonts and generated Studio worker. Build using Node 24/npm 11 locally. No build work on B1.
- [ ] Pass public build-time URLs explicitly; bind Node to `0.0.0.0` and App Service's configured port. Validate health endpoint and graceful shutdown without exposing config/secrets.
- [ ] Serve runtime with original security headers, exact parent allowlist, WASM MIME and immutable versioned assets. Verify browser isolation and notebook run/export/finalize on real supported devices.
- [ ] Measure main app plus static app resident memory; B1 must retain headroom. If not, switch the cost baseline to B2 before deployment approval.
- [ ] Verify cache freshness/publication behavior, private/no-store responses, image optimization, hostnames, redirects and middleware under Azure; do not introduce shared caching of `Set-Cookie` responses.

### Task 4 — Limiter and workload protection

**Files:** Modify `src/lib/rate-limit.ts`, `src/features/marketing/public-http.ts`, appropriate Auth/client retry code and gateway config; add `src/lib/__tests__/azure-rate-limit-identity.test.ts`, `src/features/marketing/__tests__/public-http-distributed.test.ts`, and a forward SQL migration only if a new limiter contract needs it.

**Interfaces:** Preserve existing `enforceRateLimit`, `userRateLimitKey` and 429/503 contracts. Implement trusted-proxy identity and a shared anonymous-counter contract before enabling more than one app instance; public handlers become asynchronous if necessary.

- [ ] Write tests for forged headers, IPv6, 200 users behind one NAT, multi-replica global quotas, fixed-window boundary behavior, counter-store outage and cookie rotation.
- [ ] Implement only the policies specified in Section 7; validate direct Auth/Storage endpoint coverage as well as application routes.
- [ ] Test 429/Retry-After, idempotent final submit, duplicate uploads, interrupted saves and safe retry backoff. Prove durable answers survive throttling/restart.
- [ ] Install a single scheduler owner for limiter GC and existing exam sweep duties; inspect `src/app/api/v1/internal/exams/sweep/route.ts` and the scheduler contract before selecting frequency. Do not assume Vercel's old scheduling moves automatically.

### Task 5 — Deployment-only delivery and rollback

**Files:** Modify `.github/workflows/deploy.yaml`, `docs/deployment.md`, `docs/admin/incident-and-rollback.md`; create `scripts/package-azure-release.mjs` and a locally produced release-evidence artifact format.

**Interfaces:** Release input contains tested Git SHA, platform/architecture, image digest, runtime digest and local gate evidence. Workflow checks SHA/digest identity and deploys prebuilt images; it does not build, test or migrate.

- [ ] Package linux/amd64 images locally or on an approved local build host; compare source SHA with the exact merged main revision. If merging changes the SHA/content, rerun required local gates and package the resulting revision.
- [ ] Push the immutable tested images to ACR and bind release evidence to their digests. Configure OIDC scoped to deployment resources; no database credentials in Actions.
- [ ] Replace the Vercel deployment job with Azure deployment of those digests. Disable competing Vercel triggers when cutover is authorized.
- [ ] Rehearse digest rollback and brief Basic-tier restart behavior outside exams. Rollback application versions only when schema-compatible; SQL remains forward-only.

### Task 6 — Load qualification, pilot and cutover

**Files:** Extend `scripts/load-test-answers.ts`; create `scripts/load-test-academy.mjs` and `docs/azure-launch-evidence.md`; reuse retained browser/SQL harnesses.

**Interfaces:** Inputs are isolated nonproduction accounts/cohorts and the approved target. Outputs are measured latency/error/durability/CPU/DB/egress and actual Azure meter costs, tied to SHA/digests.

- [ ] Rehearse 50 concurrent learners for 30 minutes, then a 2-hour soak. Include synchronized start/submit, school NAT, cold notebook downloads, staff reports, login waves and cross-tenant authorization denial.
- [ ] Proposed acceptance: p95 ordinary API <500 ms, p99 <1.5 s, unplanned 5xx <0.1%, zero lost/duplicate final submissions, no ordinary learner blocked by the network quota, app CPU below 60% sustained, memory below 70%, bounded DB pool queue. Report slow exception endpoints separately; repeat on the actual target resources.
- [ ] Test 200-person and 500-person scenarios as stress tests, identify the first bottleneck, and quote required upgrades. Passing the 50-user gate does not approve larger cohorts.
- [ ] After every source/config/SQL/doc/test edit, run `npm run graphify:refresh`, `npm run graphify:check`, then the complete `npm run verify:local`; resolve failures, review and commit `docs/architecture/graphify-manifest.json` with the changes. Keep generated graph ignored. No GitHub test/build job.
- [ ] Run a two-week controlled pilot; measure requests/session, CPU/request, cache/egress, retained data, actual bill, limiter rejects and backup recovery. Replace assumptions in the CSV and reforecast the remaining grant.
- [ ] Complete independent live OAuth/email/Storage/notebook/revocation and deployed-SHA gates. Keep MCP disabled unless its own gates pass. Verify domain/cookie/callback cutover and remove temporary access.
- [ ] Record go/no-go with the operator: qualified cohort size, observed cost, remaining credit, recovery result and unresolved limits. No launch claim based solely on local tests.

## 11. Deliverables and remaining facts to collect

- This detailed plan.
- [Regional rate snapshot](2026-10-24-azure-academy-rates.json), with original API records and query URLs.
- [Calculated scenario CSV](2026-10-24-azure-academy-costs.csv), containing dynamic/HTTP requests, CPU assumptions, egress, annual gross/cash estimates and ACA alternatives.
- Before implementation: actual offer/balance/expiry; domains; expected peak cohort; existing-user migration scope; total retained users/data; real runtime artifact download size; available operator; self-hosted OAuth/MCP compatibility and quoted monthly total.

The recommendation is therefore a **grant-conscious, all-Azure pilot architecture with explicit self-hosting responsibility**. Its financial assumptions can fit the grant, but final capacity and production readiness require the listed live measurements and release gates.

## 12. Planning-artifact checks and repository gate status

On 24 October 2026, the scenario calculations were independently recomputed from the listed inputs, all companion links resolved, and the rate snapshot parsed successfully. No application code or infrastructure configuration was changed by this planning work.

The required repository sequence was attempted:

1. `npm run graphify:refresh` — blocked: the wrapper requires 512 MiB free in both repository and temporary storage; the filesystem had about 476 MiB free at the subsequent check.
2. `npm run graphify:check` — failed because these three new planning files are not in a refreshed graph.
3. `npm run verify:local` — stopped at that same Graphify prerequisite; types, tests, build, SQL and browser gates did not run in this sequence.

No freshness receipt or manifest was fabricated, no guard was bypassed, and no commit/deployment was made. After adequate disk space is available, rerun the full sequence and review the resulting manifest. These artifacts are a completed planning draft, not a verified or merge-ready repository change.

Planning self-review: accuracy 4/5 (current source and regional retail meters inspected; tenant offer and capacity remain unmeasured); completeness 4/5 (topology, budget, usage, limits, recovery and execution covered; actual cohort size is still unknown); clarity 4/5 (fixed, metered and assumed amounts separated; detailed document is long); actionability 4/5 (six tasks with files/interfaces/gates; provisioning requires account/domain/operator choices); conciseness 4/5 (summary and tables support scanning, implementation detail is retained for execution). Overall 4.0/5. Highest-value next evidence is the actual credit/expiry, a self-hosted compatibility rehearsal, and a measured 50-learner pilot. These are planning-review notes, not test results.
