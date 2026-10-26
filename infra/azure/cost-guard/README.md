# Academy independent cost guard

This directory is a Node 22 Azure Functions v3 application with no npm dependencies.
The timer runs every five minutes on a separate Function host. It does not rely on
the Supabase VM being reachable. It starts in **dry-run** unless `dryRun` is
explicitly `false`. Deploy the contents of this directory, with `host.json` at the
package root. Local tests use injected fake fetch/identity and do not call Azure.

This implementation is not evidence of provisioning, live credit availability,
billing API support, a successful backup, or a safe hosted shutdown. Those remain
release prerequisites. Never treat a budget or this delayed-data guard as a hard
currency cap. There is no subscription stop, wildcard VM lookup, delete, resize,
restart, force power-off, or automatic recovery path.

## Deployment configuration and narrow authority

Set `FUNCTIONS_WORKER_RUNTIME=node`, `FUNCTIONS_EXTENSION_VERSION=~4`, the host's
Node 22 runtime setting, managed-identity `AzureWebJobsStorage` settings, and
`COST_GUARD_CONFIG_JSON` to a reviewed object following `config.schema.json`.
`config.example.json` is a template: its zero subscription ID, account name,
hourly rate and retained daily rate are not live account facts. The grant-date
placeholders deliberately fail validation until replaced with verified dates.
Confirm grant-year dates separately from temporary-benefit expiry; never infer them. Replace IDs and
review the conservative rates against the complete resource inventory before
activation. Accounting defaults to `automated-baseline`; configure the exact `baselineId`.
No secret belongs in this JSON. The Functions managed identity is
obtained through `IDENTITY_ENDPOINT` / `IDENTITY_HEADER`; never print these values.

The guard reads the exact VM and exact resource group and checks all configured
project/environment/cost-scope tags before acquiring a lease or writing control.
It checks them again before deallocation. Azure resource-ID equality is case
insensitive; no resource search or wildcard authorization is used.

Grant only:

| Principal | Scope | Permission |
| --- | --- | --- |
| Guard identity | Exact configured VM | `Microsoft.Compute/virtualMachines/read`, `Microsoft.Compute/virtualMachines/deallocate/action` |
| Guard identity | Exact Academy resource group | `Microsoft.Resources/subscriptions/resourceGroups/read`, `Microsoft.CostManagement/query/action` |
| Guard identity | Exact configured subscription | `Microsoft.CostManagement/query/action` read-only, to cover all grant-consuming projects in that subscription |
| Guard identity | `control` and `guard-state` containers | Blob read/write/lease; no other data containers |
| Guard identity | `financial-input` and `telemetry` containers | Blob read only |
| VM identity | `control` container | Blob read only |
| VM identity | `telemetry` container | Write telemetry/checkpoint; no financial input or state writes |
| Trusted financial operator | `financial-input` container | Publish verified immutable baseline; fresh snapshots only for explicit manual mode |

Host runtime storage permissions are separate, on dedicated Function host storage
or its exact required containers. Keep all containers private. Prefer a custom
blob role without delete where available. Never grant VM Contributor, subscription
Contributor/Owner, access-key listing, or subscription write actions to the guard.
A read-only subscription cost role may be required by the account's Cost Management
setup; it is not evidence that the credit balance API exists and is never used to
change other projects. Confirm effective scopes in a live RBAC review.

Bootstrap `guard-state/state.json` explicitly once, before enabling the timer:

```json
{"version":1,"mode":"normal"}
```

A missing, null, malformed, wrong-version or partially corrupted state blob cannot
silently reset counters. Ledger validation happens before the recoverable input
path; invalid history causes no state/control write and requires operator reconciliation. Azure Blob's 60-second lease
serializes mutations; renewal is required before control writes and before the
shutdown intent. Lease loss prevents further mutation. Do not delete/recreate the
state blob to clear a warning. Archive an operator audit record and reset only
after checking the original condition, counters, pending request outcome and VM
state. There is no automatic VM restart or return from a financial state.
Transient uncertain-input holds recover only after fresh, monotonic, valid
accounting proves the normal state. A daily-backup pause additionally requires its
matching completed receipt. Neither path starts or restarts a VM.

## Unattended accounting from a verified immutable baseline

The user confirmed a $2,000 award; that is **not an available balance or a verified
grant expiration date**. The default `accountingMode:automated-baseline` requires
one trusted operator-verified `financial-input/baseline.json`, following
`baseline.example.json`. Null amounts and false confirmations in that template
are intentional: they fail validation until replaced with evidence.

Required baseline fields:

```text
version: 1
id: exact configured baselineId
operatorVerified: true
completeCreditCoverage: true
coveredSubscriptionIds: [the exact configured subscription UUID], exactly one
subscriptionId, resourceGroup: exact configured values
grantStartsAt, grantEndsAt: exact independently verified configured grant dates
observedAt: verified baseline observation time, within the grant and not future
remainingCreditUsd: actual credit balance at the baseline observation
otherCommittedUsd: actual committed future costs for other projects
academyGrantToDateUsd: actual Academy grant-to-date spending at the baseline
subscriptionGrantCostUsd: cumulative reported USD ActualCost since grant start for this subscription
academyGrantCostUsd: same-basis cumulative reported USD ActualCost for the Academy RG
sourceReference: opaque reference to the controlled grant/balance/usage evidence
```

The balance and cumulative costs must be reconciled to the same effective
accounting cutoff and cost basis by the operator. `completeCreditCoverage:true`
explicitly asserts that this subscription is the complete set of scopes drawing
from that credit balance. Other projects **inside** this subscription are included.
If the credit funds another subscription, tenant or unobserved billing scope, this
unattended path is unsupported and rejects partial coverage. It never discovers
or queries another subscription. Use the explicitly selected manual path with
complete evidence until complete scoped accounting is available.

Every cycle queries USD ActualCost totals at the exact configured subscription
and Academy resource group from the verified grant start, plus the Academy RG's
current UTC month. The API scopes and intervals are fixed by configuration; no
caller-supplied URL is followed. The calculation is:

```text
subscriptionDelta = current subscription grant total - baseline subscription grant total
academyDelta = current Academy RG grant total - baseline Academy RG grant total
estimated remaining credit = max(0, verified baseline balance - subscriptionDelta)
Academy grant spending = verified baseline grant spending + academyDelta
```

These are estimates from actual reported usage; they are not a fresh portal
balance. Lag reserves remain necessary. Calendar month changes are derived
automatically; no daily operator snapshot or monthly manual rollover is needed
while the usage API returns complete valid data. Empty/missing/non-USD results,
stale query observations, decreases, inconsistent subset totals or negative deltas
are never interpreted as zero. An empty query at a billing-reporting boundary can
hold admissions until real complete results arrive; that hold recovers automatically
from fresh monotonic results. It cannot promise uninterrupted availability during
Azure billing/API incidents or lag beyond the reserve.

The baseline ID and canonical content hash are persisted in the leased guard
state. Any changed baseline, mismatched grant or changed credit scope requires an
explicit audited operator rebase; a new blob or changed configuration cannot
silently reset historical spending. The operator must rebase when grant terms,
covered scopes, additional credits or committed-other-project obligations change.
The guard does not claim to discover those contractual changes from usage alone.

## Explicit manual snapshot fallback

Select `accountingMode:manual-snapshot` when the account/offer cannot provide the
required complete usage API. This is an explicit prerequisite, not the unattended
default. For automated mode, `allowOperatorCostFallback:true` can also permit a
fresh trusted snapshot after a usage API failure, but a malformed or changed
baseline never silently falls back. After a successful automated cycle, manual
snapshot sequences must exceed the persisted sequence (UTC epoch milliseconds are
recommended); changing data source cannot reset anti-replay history.

Publish `financial-input/snapshot.json` from a trusted financial operator only:

```text
version: 1
subscriptionId: exact configured subscription UUID
resourceGroup: exact configured Academy group
period: UTC YYYY-MM for the current calendar month
sequence: positive safe integer, strictly increasing when contents change
observedAt: ISO UTC timestamp of verification, not upload time
expiresAt: ISO UTC, after now and at most 24 hours after observedAt
operatorVerified: true
sourceReference: nonempty opaque portal/export evidence reference
remainingCreditUsd: finite nonnegative actual available credit in USD
otherCommittedUsd: finite nonnegative committed other-project costs in USD
grantStartsAt: exact config.grant.startsAt, independently verified grant-year start
grantEndsAt: exact config.grant.endsAt, independently verified grant-year end
academyGrantToDateUsd: actual finite nonnegative Academy spend since this grant began
monthlySpendUsd: finite nonnegative verified Academy month-to-date spend (fallback only)
costsCompleteThrough: ISO UTC meter-completeness time (fallback only; <=24 hours old)
```

Do not put credentials, account tokens, student records or raw billing exports in
this small control input. Keep source evidence in the operator's controlled record.
A sequence replay with altered content, older sequence, future timestamp, expired
snapshot, wrong period, missing values, NaN, negative amounts or unverified source
produces a protective state and blocks deallocation. An unchanged snapshot may be
reused only while fresh. JSON field order must remain stable for equal sequences;
republish with a new sequence after serializing it differently. Academy grant-to-date
spend must never decrease at month rollover. Missing grant spend or dates are not
replaced with zero or guessed from the grant award/benefit expiry.

The manual path prefers an `ActualCost`, `MonthToDate`, `PreTaxCost` query at
**the exact Academy RG scope** for current-month spend. A successful query's fetch time is not proof that
all meters are current. Empty rows, unsupported offers, 204, authentication errors,
429, network errors, non-USD amounts, negative adjustments or paginated/incomplete
responses are not interpreted as zero spending. No currency conversion is guessed.

For a Sponsorship offer without the required Cost Management API, absent an
explicit valid manual path the result is `discretionary-stop`, a failed Function
invocation with an actionable operator status, and **no deallocation**. Explicitly enabling
`allowOperatorCostFallback:true` permits only the same fresh verified operator
snapshot's spend and meter-completeness timestamp to replace unavailable billing.
The operator must refresh actual account evidence at least every 24 hours. No
credential scraping or undocumented credit endpoint is used.

## Telemetry and actual checkpoint receipts

The gateway writes only its local aggregate counters. A trusted VM collector must
copy and enrich those counters, then atomically publish `telemetry/telemetry.json`:

```text
version: 1
vmResourceId: exact allowlisted VM resource ID
period: UTC YYYY-MM
observedAt: ISO UTC, <=15 minutes old
sequence: positive safe integer, persistent across reboot AND month rollover
monthlyOutboundBytes: nonnegative safe integer; persistent within the month
pendingVariableUsd: finite nonnegative conservative unmetered variable-charge estimate
diskUsedRatio: finite number in [0,1], maximum actual data/object filesystem used fraction
activeRequests: nonnegative safe integer
queuedRequests: nonnegative safe integer
activeExamAttempts: nonnegative safe integer queried from the actual database
```

The collector supplies `pendingVariableUsd` from bounded usage and reviewed
per-unit rates for traffic, email, storage operations, logging and other variable
meters. It must include observed unbilled use and bounded in-flight exposure;
never inject zero merely because a meter is unavailable. Gateway telemetry is not
a billing source and cannot truthfully derive this USD figure on its own. Missing
collector, missing price estimate, stale telemetry, replay or decreasing counters
fails closed. A new UTC month permits a byte/month-spend counter reset with fresh input;
the global sequences and grant totals must still advance or remain monotonic. Do not upload the gateway's detailed
ledger or request bodies.

The guard publishes `control/maintenance.json`:

```json
{
  "version": 1,
  "mode": "drain",
  "updatedAt": "2026-10-25T10:00:00.000Z",
  "expiresAt": "2026-10-25T10:15:00.000Z",
  "drainStartedAt": "2026-10-25T10:00:00.000Z",
  "drainReason": "financial"
}
```

These timestamps illustrate format only. Real invocations refresh `updatedAt`
and `expiresAt`; `drainStartedAt` is stable for the drain and omitted otherwise.
Allowed modes are `normal`, `discretionary-stop`, and `drain`. The VM poller must
use managed identity, validate freshness/shape, and atomically fsync/rename the
file into `/srv/academy/control/maintenance.json` (mounted read-only at the gateway
path). A missing, corrupt or expired file must fail closed at gateway admission.
The guard does not expose a public maintenance endpoint.

After seeing drain, a trusted host maintenance process must stop accepting new
work, wait for the running and queued work to finish, flush durable database/object
writes, complete and verify the required backup, and only then publish
`telemetry/checkpoint.json`:

```text
version: 1
vmResourceId: exact allowlisted VM ID
drainStartedAt: exactly the drain token from the control blob
recordedAt: ISO UTC, after drain began and <=15 minutes old
activeRequests: 0
activeExamAttempts: actual nonnegative database count (must be 0 for scheduled backup)
databaseFlushed: true
backupCompleted: true
backupReference: nonempty opaque completed-backup receipt reference
```

**Neither the guard nor the gateway fabricates this receipt.** The host maintenance
implementation must actually complete its flush/backup hook and still requires a
live restore rehearsal before shutdown is enabled. Current running-request and queue counters must be zero. Scheduled backups also
require zero active exams. Financial shutdown can preserve acknowledged in-progress
attempt rows and then interrupt the session; it does not require those semantic
attempts to transition to complete. A receipt for another VM or drain cannot be
reused. The first drain invocation cannot immediately deallocate from a preexisting
receipt. At 30 minutes after full drain without an accepted receipt, the guard stays drained,
reports `checkpoint-timeout`, and requires operator intervention; it never forces
a power-off. A valid receipt after that timeout requires an audited new operator
recovery/drain action. This is a bounded waiting policy, not a zero-loss guarantee.

## Daily backup pause

The host may publish `telemetry/backup-request.json` with `version:1`, the exact
`vmResourceId`, a nonempty `requestId` containing only letters/digits/underscores/
hyphens (at most 128 characters), and ISO `requestedAt` / `expiresAt` timestamps.
The request must be for today's UTC date, no more than 30 minutes old, and expire
within 30 minutes of being requested. The guard accepts at most one request per
UTC day and persists request history, preventing replay from opening another cycle.
Old requests are ignored; malformed or wrongly scoped requests fail closed.

A request is accepted only with fresh normal financial state and zero active exams.
The guard publishes `mode:drain`, `drainReason:scheduled-backup`, `backupRequestId`,
and a stable `drainStartedAt`. This deliberately pauses availability for the host's
bounded backup workflow. The host must still recheck active exams and finish
running/queued work before stopping services and taking the actual backup.

A scheduled receipt uses the checkpoint schema above plus `requestId` exactly
matching the accepted request. The guard may publish normal only after that receipt,
with fresh valid finance still normal, no prior financial latch, no active exams,
no running/queued requests, and the drain still within its 30-minute window.
A different-cycle receipt, stale input, elapsed timeout or financial threshold
keeps the drain in place. A real financial stop requires an operator to reset it; a later backup receipt
cannot clear that latch. A temporary uncertain-input hold can recover only with
fresh monotonic normal accounting and the original matching receipt within the
bounded maintenance window.
At the 90% financial threshold during backup the hold remains drained but does not
cause deallocation; a real 95%/credit-reserve shutdown cause plus a valid receipt is
required. A scheduled-backup cause alone **never deallocates or restarts the VM**.

The host also publishes `telemetry/backup-alert.json` with `version:1`, the exact VM,
`recordedAt` and `status:attention-required|completed`. An attention status produces
`operatorAttention:backup-attention-required` and a failed Function invocation for
alerting; the raw host reason/payload is never logged. It remains actionable until
the host explicitly writes completed. The alert cannot clear financial protection.

## Decisions and continuing charges

The operating envelope is $90/month, or $70 only with explicitly confirmed actual
benefit meter IDs and a future benefit-expiry timestamp. Expired benefits revert
to $90. Untested eligibility is not a discount.

```text
pending = maximumHourlyUsd * min(24, hours elapsed since verified grant start) + pendingVariableUsd
shutdownGrace = maximumHourlyUsd * (120 / 3600)
monthlyRetainedTail = retainedDailyUsd * time from now to the current UTC month end
projected = observed month spend + pending + monthlyRetainedTail + shutdownGrace
retainedTail = retainedDailyUsd * retainedDays
remainingAnnualAllowance = max(0, min(1080 - academyGrantToDateUsd,
                                     remainingCreditUsd - otherCommittedUsd - 400))
remainingOperatingNeed = prorated reviewed operating forecasts from now to the grant end
requiredAnnualHeadroom = pending + remainingOperatingNeed
```

`remainingOperatingNeed` uses the separately reviewed
`rates.operatingMonthlyUsdWithBenefits` only until confirmed benefits expire, then
`rates.operatingMonthlyUsdNoBenefits`. These are required positive finite forecasts
no higher than their respective $70/$90 spending envelopes. The example uses
$65/$85; these are conservative planning estimates, not vendor price guarantees. Proration uses twelve months over the actual
365/366-day year anchored at the verified grant start. A shorter grant period
covers only its remaining duration; an expired grant requests drain. A six-month
remaining period therefore does not repeatedly require a full $1,080. Unbilled past
charges and future operating need are summed because they are distinct obligations.
At grant start the fixed lag horizon is zero; no charges are invented before the
verified grant begins. Variable pending usage still requires a real bounded estimate.
The actual example at grant-start plus five minutes reserves $0.0125 of fixed lag
and approximately $1,019.99 of future operations, fitting the unchanged $1,080
annual allowance. Forecasts are distinct from maximum spending envelopes, leaving
intentional startup/operating headroom without discarding the sum of obligations.
Before activation, an operator must reconcile forecast evidence against the priced
fixed inventory and confirmed meter benefits, including 300 GiB bounded backups,
50 GB transfer ceiling, guard hosting, SMTP and storage/logging operations. Never
derive a forecast from unmeasured MAU or silently reduce it to make admission pass.

The 30-day durable tail, pending estimate and shutdown grace must fit **inside the separate $400
safety reserve**. They are not charged again in each monthly stopping estimate.
The current-month tail represents future retained charges through month end;
observed spending already includes earlier disk/IP/backup charges, while the lag
estimate covers the unmetered past. For example, with illustrative test rates a
$72.54 month at its last hour projects about $76.79, below the $90 stop threshold.
Those fixture rates are test inputs, not live price evidence. The backup-storage ceiling
is now 300 GiB; the template uses `retainedDailyUsd:1.5` conservatively. A fully
reported $79.34 month plus a worst-case 24-hour lag reserve can cross the $81
(90% of $90) discretionary threshold. This is an explicit conservative early-stop
risk near the envelope: the API query timestamp does not prove meter completeness,
so the guard cannot honestly remove that reserve. The $90 cap and approved 80/90/95
thresholds are unchanged; review real rates and the available margin before launch.

A complete inventory rate must cover both the VM RG and any separately billed
independent guard resources that the exact-RG query does not include. Billing data
can lag 8–24 hours and may be delayed further in incidents: 24 hours is a planning
reserve, not a guarantee. Reserve at least 30 days of retained charges; the horizon
is an operator decision and never a deletion TTL. VM disks, Standard IPv4, backups,
registry, monitoring and the independent Function may keep accruing charges after
deallocation. Review/renew the horizon as long as durable resources are retained.

- At 80% of the envelope (or 40 GB outbound or 70% disk use), warn.
- At 90% (or 45 GB outbound or 85% disk use), stop discretionary work/new starts.
  Disk pressure alone never deletes data or deallocates the VM.
- At 95% (or 50 GB outbound), latch the financial shutdown request. If exams are
  active, publish discretionary stop with a fixed `financialRequestedAt` and
  `drainAfter` exactly 120 seconds later, allowing bounded critical saves/finalization.
  The gateway enforces that deadline locally even though the guard polls every
  five minutes. Polls, restarts and uncertain-input holds never extend the deadline.
  After it, full drain applies regardless of still-in-progress semantic attempts.
  With no active exams, full drain is immediate. The independent 50 GB gateway
  ceiling can interrupt sooner. Unsaved work or user completion can be interrupted;
  the real flush/backup preserves acknowledged durable data, not unreceived work.
- Insufficient remaining annual allowance for the **sum** of pending past charges
  and the remaining operating period requests drain. A retained tail plus pending charges above the
  $400 safety reserve also requests drain. Academy grant-to-date spend is deducted
  from the $1,080 grant-year maximum and persists across monthly counter resets.
- Missing or invalid input creates a separate uncertain-input hold, preserves any
  financial latch/deadline or ongoing drain, and **blocks destructive action**. Fresh
  monotonic valid accounting can recover that uncertainty hold; it cannot reset a
  genuine financial stop or restart a VM. Control/storage/identity failure leaves the
  last control to expire closed; it cannot safely invent an authoritative update.

Actual financial stops latch across month rollover and recovered inputs until
an operator reviews and resets them. The latch is persisted before publishing
control, so an uncertain blob write cannot erase it. Deallocation intent is written to durable state before
the ARM request. A crash or unknown HTTP outcome then requires explicit operator
reconciliation rather than retrying. A 200/202 is only request acceptance, not
proof that the VM is deallocated; confirm actual instance state separately.

## Live acceptance prerequisites

1. Verify subscription, offer, remaining grant, other commitments, period coverage,
   actual price/benefit meters and the complete post-deallocation retained charges.
2. Confirm independent Function scheduling and exact effective RBAC, private blob
   access, host-storage permissions, UTC month boundaries, and clock correctness.
3. Implement/rehearse the persistent VM telemetry enrichment, atomic poller, real
   flush/backup checkpoint producer and a complete timed restore. Confirm the
   gateway blocks new work while preserving already accepted durable work.
4. Run dry-run against actual fresh data; confirm normal, warning, discretionary,
   invalid input/recovery, 120-second drain deadline, lease race, and unknown-result states. Configure alerts for
   Function failure, missing five-minute heartbeat, warning and checkpoint timeout.
   `host.json` sampling is not an enforceable 0.5 GB/month logging ceiling; provision
   the monitoring cap independently and include its cost in the inventory.
5. Only after these gates, explicitly activate writes and observe a controlled
   checkpoint/deallocate drill on the exact Academy VM outside exams. Verify disk,
   object and identity recovery plus actual ongoing charges. No automatic restart.

Local lane command: `npx vitest run tests/infra/azure-cost-guard.test.ts --maxWorkers=2`.
After all integrated edits, repository policy still requires Graphify refresh/check
and the complete `verify:local`; these tests alone do not establish release readiness.

References: [Cost Management Query](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01),
[VM Deallocate](https://learn.microsoft.com/en-us/rest/api/compute/virtual-machines/deallocate?view=rest-compute-2025-04-01),
[Functions Node programming models](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node),
[Functions/App Service managed identity](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).
