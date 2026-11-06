# Teacher assignment release: private database gate

This runbook does not authorize production changes. Complete the local repository gates and obtain release authorization before using Azure prepare/start. Local SQL and packaging evidence does not establish hosted database state, deployment correctness, capacity, or provider behavior.

## Exact release boundary

The `--forward-55` lane applies this explicit ordered suffix in **one transaction**, after the completed managed-handle migration54:

1. `20261106010000_course_teaching_assignments.sql`
2. `20261106011000_exam_teaching_scope.sql`
3. `20261106020000_teaching_grading_guards.sql`
4. `20261106030000_teaching_report_scope.sql`
5. `20261106040000_management_teaching_scope.sql`

The feature action then applies the reviewed current `src/lib/identity/schema.sql` to permit30-day sessions. Its new `identitySha256` is bound in the plan and successor receipt. The completed54 identity bytes remain frozen in `scripts/azure-core/baselines/identity-post-handles.sql`, including its24-hour bound;54 source evidence is checked against that frozen file, never the new suffix. Explicit54 schema/artifact/executor reads are deliberately pinned to preserve the released54 semantics as the live identity source evolves. Existing stored session expiries are retained.

The archive includes exactly59 migration inputs for source/transformed-hash inspection. The executor applies only these five files. V1 and the53/54 executors, ledgers and released archive boundaries remain separate. Never run schema/import, replay54 over changed role definitions, or edit receipts to force a match. A later SQL file requires a separately reviewed boundary; it is never implicitly included.

Review the SQL and actual service/API authorization, including immutable enrollment/attempt/submission branch history. School/central admins gain `teaching.assignment.manage` and `teaching.scope.all`; their existing operation capabilities remain necessary. The package verifies that every preexisting permission is retained and no automatic grading permission is added. Teachers receive no broad fallback. Initial assignment groups and rows must be empty: free-text manifest instructors do not establish authority. Releasing this application can therefore remove ordinary teachers' course access until an authorized school administrator assigns them explicitly. Plan that initial assignment step before rollout.

## Local evidence

Complete source, configuration, SQL, documentation and test edits. Run `npm run graphify:refresh`, `npm run graphify:check`, then `npm run verify:local`; inspect and commit the tracked Graphify manifest with the source while keeping `graphify-out/` ignored. Run the native SQL rehearsal with an existing local PostgreSQL17 installation:

```sh
STUDIO_POSTGRES_BIN=<existing-local-bin> node scripts/azure-core/rehearse-forward-55.mjs
```

The script refuses automatic runtime installation and creates a disposable socket-only cluster. It builds the genuine pre54 baseline, applies V1/53/54, then exercises the five-file release, failure on the final file and full transaction rollback, stale source/plan rejection, unchanged predecessor receipts and old role capabilities, empty initial assignments, service/public ACLs, schema-drift rejection and matching-receipt noop. Its fabricated clean-source metadata is local rehearsal data; a real package requires the final clean committed checkout.

## Exact predecessor evidence

During an independently authorized read-only private-network probe, inspect PostgreSQL17 `academy`/`academy_admin`, the import ledger, V1 activation deployment and receipts, migration53, and the handle54 postconditions/receipt. Retain the completed54 receipt's six metadata fields exactly. Record mode0600 `build/azure-core/private/forward-55-v1-evidence.json`:

```json
{
  "verified": true,
  "activationSha": "<verified 40-character V1 activation deployment SHA>",
  "predecessor": {
    "filename": "20261106000000_managed_profile_handles.sql",
    "source_sha256": "<64-character migration54 source hash>",
    "azure_sha256": "<64-character migration54 transformed hash>",
    "identity_sha256": "<64-character migration54 identity-schema hash>",
    "source_commit": "<40-character completed54 committed source SHA>",
    "source_tree": "<40-character completed54 source tree SHA>"
  }
}
```

This file is operator attestation, not independent proof. The executor matches its entire predecessor object against the actual private handle receipt and the packaged source hashes. It verifies existing handle protections and private receipt ACLs, hashes predecessor receipt metadata, and refuses absent/partial/mismatched state. New55 source provenance can differ from the completed54 source commit; both must be independently reviewed. Never replace the predecessor fields with the current application SHA.

## Required read-only teacher cutover inventory review

Every55 read-only plan includes `teacherCutoverInventory`, containing only four nonnegative integer counts and one boolean. The query works before55 exists and on a matching post55 noop; it uses existing authorization/account/membership policy and simulates the specific built-in central/school admin scope-all grants before applying SQL. No IDs, names, handles, email addresses or rows are returned.

- `ordinaryActorCount`: active actors with an effective teaching/read/grading/report/analytics capability in an ordinary branch or global scope who require course assignments under the new enforcement. Effective central admins are excluded globally. School admins are exempt only at their own active admin branches: an ANS admin who also teaches at VinSMC is counted once and needs VinSMC assignments. A global reporter with one school-admin branch remains ordinary in other branches/global history. Already assigned ordinary teachers remain in this count on noop; this is an affected-actor inventory, not an unassigned-actor count.
- `eligibleBranchTeacherPairCount`: distinct active ordinary-actor/branch pairs outside the actor’s school-admin branches, with active membership and the exact six enterable capabilities accepted by `teaching_candidate`. Read-only `learning.read`/`grading.read`/`grading.manage` actors can appear in the first count but are not eligible through those capabilities alone.
- `activeEnrollmentCourseBranchPairCount`: distinct active enrollment course/historical-branch pairs in branches where an actor has ordinary operation authority after its specific school-admin branches are removed. Unknown enrollment branch history is excluded from this known-pair count.
- `ordinaryGlobalActorWithoutMembershipCount`: ordinary actors with an effective central teaching/report capability but no active branch membership. These actors are included in `ordinaryActorCount`; the inventory does not manufacture membership or assignments for them.
- `requiresInitialAssignments`: exactly `ordinaryActorCount > 0`. It conservatively requires operator review even when the eligible pair count is zero. It does not automatically assign teachers, grant capabilities or reject an otherwise matching apply.

Review the actual private55 plan's inventory before deciding whether the rollout needs an explicit membership/course mapping and initial assignment step. If the ordinary actor count is zero, no ordinary-teacher assignment cutover is indicated by this inventory. If nonzero, retain the separately authorized operator mapping/review decision; counts alone cannot identify or approve specific assignments. Do not infer an unaffected rollout from an empty assignment table or a zero eligible-pair count. A change to these counts between reviewed plan and apply is stale database state and requires a fresh read-only plan. Apply locks the relevant input tables and authorization guard while rechecking and applying; pre/post55 inventory must remain equal.

## Production candidate and promotion order

Prepare a production-target web candidate from the exact clean, locally verified commit before applying the database suffix. Set the production server session bound to `ENTRA_SESSION_MAX_AGE_SECONDS=2592000` before creating that candidate, and verify the direct Google server configuration prepared by the identity release owner. Use Vercel's production target with automatic domain assignment disabled (`--prod --skip-domain`, or `autoAssignCustomDomains: false` in the deployment API). Confirm the expected Academy project/team, source commit/tree and `READY` state; the canonical hostname must still serve the previous release.

Review `teacherCutoverInventory` in the real private plan before apply. If ordinary actors require initial assignments, obtain the explicit authorized course/school mapping and cutover plan first; never infer it from names. Zero ordinary actors means no existing ordinary teaching authority is removed, while unassigned courses remain explicit in the new management UI.

After the selected database apply succeeds, validate its immutable receipt, fresh noop plan and schema-cache visibility, then promote the already-ready matching web candidate promptly. The old authorization parser cannot accept the newly persisted admin permission names, and old grading clients cannot call the newly guarded RPC overloads: do not start a long web build only after committing the suffix. Do not promote the dependent candidate if database execution fails or remains ambiguous. Existing academic writes and receipt provenance must be preserved.

Merge the tested tree through the deployment-only workflow after database acceptance and promotion. Confirm the workflow's main deployment reaches `READY`, has the same tested source tree, and serves the canonical hostname. A web rollback does not undo this forward-only permission/RPC change; recovery requires a compatible web deployment or an independently reviewed forward correction.

## Authorized private-job execution

Commit the final verified tree first. The local prepare/start path rechecks the exact clean source commit/tree before cloud calls. Keep the evidence file byte-for-byte stable between packages; archive a stale plan privately before creating a fresh plan package.

1. Without `forward-55-plan.json`, run `node infra/azure-core/migration/package.mjs --forward-55`, then `node infra/azure-core/migration/verify-package.mjs`. These only encrypt, validate and relocate local artifacts; they do not connect to a database. The archive contains the locked installed `pg` dependency closure and no snapshot/import executor. Dependency downloads in the job are forbidden.
2. Run `node infra/azure-core/migration/deploy.mjs --prepare --forward-55-plan`, then `--start --forward-55-plan`, inspect execution status and obtain `--receipt --forward-55-plan`. Preparing does not start the manual job; starting does not prove successful execution.
3. Review `build/azure-core/hosted-forward-55-plan.json`: five ordered source/transformed hashes, new identity suffix hash, exact post54 predecessor source and receipts, import/activation facts, clean55 commit/tree, current role digest/count, complete receipt-chain digest, reviewed teacher cutover inventory, and `apply` or matching committed-provenance `noop`. Preserve the full validated receipt including encrypted-package, source-manifest and stable content hashes as mode0600 `build/azure-core/private/forward-55-plan.json`.
4. Rebuild with `--forward-55` and repeat offline verification. Stable package content (source, evidence and locked dependency bytes) must match the plan package. The separately bound reviewed-plan digest and encrypted/source-manifest hashes change. Any source/evidence/vendor/database drift requires a fresh plan, not edited hashes.
5. Prepare/start/read the immutable receipt using `--forward-55-apply`. The trusted bootstrap verifies archive/member/source/dependency bytes before importing packaged code or fetching database administrator credentials. The executor rechecks the reviewed state under the existing advisory transaction lock plus authorization/role/ledger locks, applies all five files and the new identity suffix, validates grants/schema/empty initial assignments, and inserts one private `academy_private.teaching_forward_receipt` atomically. The receipt records the exact suffix hashes, prior receipt digest, pre/post role digests and55 source commit/tree. Neither row data nor credentials are emitted.
6. Use the same artifact for another read-only `--forward-55-plan` job; require `noop`, matching predecessor and successor receipt/source metadata, unchanged preexisting capabilities and full current ACL/schema checks. Independently verify PostgREST schema-cache visibility after transactional reload. SQL commit alone is insufficient.
7. Create initial course+school primary/assistant assignments through the authorized revision-checked admin UI/API. Confirm one primary for every nonempty group, active eligible branch members, explicit unassigned courses, no automatic manifest-name assignments, immediate revoke/suspension enforcement, and course/cross-school restrictions on lists, reports, attachment reads, grading and writes. Perform these hosted mutations only when separately authorized.
8. After identity SQL acceptance, verify hosted `ENTRA_SESSION_MAX_AGE_SECONDS=2592000` (remove or update any old24-hour override) before new30-day logins. Existing stored rows keep their original expiry. Release the application only under the approved deployment order. Because merging main triggers deployment, database acceptance and the initial assignment rollout must be coordinated before merging dependent enforcement. Verify the real hosted deployment SHA/canonical alias and authorized smoke paths separately.

Noop inspection uses the successor receipt's recorded role state; it never reruns54 to reinterpret its original role baseline. Transaction failures roll back all five files and their permission changes. A timeout, failure, missing success receipt or ambiguous job outcome requires read-only state inspection and a fresh plan; missing uploaded receipt does not prove database rollback. Success/failure receipts use create-if-absent destinations and must be read back against the selected action/artifact.

## Recovery

This is a forward-only authorization change. Do not drop assignment/history tables, unguard staff RPCs, grant broad teacher permissions, rewrite historical branch IDs or alter release receipts as recovery. Preserve submitted work, audit history, group revisions and all existing immutable data. Application rollback needs an explicitly reviewed revision compatible with the new permission and SQL contracts; older broad teacher behavior may expose courses after rollback. Resolve assignment errors through the revision-checked authorized API. Hosted cache/provider/authenticated behavior, concurrency and performance remain separate release evidence.
