# Canvas redesign: Azure release sequence

This is a release plan, not evidence of a production change. The release owner must verify the target, prerequisites, execution receipts and deployed revision. The website deploys from `main`; the deployment workflow does not apply database migrations. Keep the existing 49 historical migrations unchanged.

## Before release

- Complete the repository's Graphify and `verify:local` gates on the exact integrated revision. Confirm a private-network Azure administration path and a tested backup/recovery plan; do not expose PostgreSQL publicly or put credentials in logs or Git.
- Inspect live migration and object state through an approved read-only procedure. Confirm migrations `20261105000000_teaching_canvas.sql` and `20261105010000_teaching_announcement_revisions.sql` have not already been applied with earlier bytes. A filename, an aggregate bootstrap digest, or an old receipt alone does not prove this. Stop for reconciliation if state is ambiguous.
- Review the exact source and Azure-transformed SQL hashes, expected starting schema, privileges, and recovery plan. The original Azure bootstrap/import job only supports a fresh target; do not rerun it on the populated production database. The generic `npm run migrate` uses a different filename-only ledger and is not the Azure incremental release procedure.

## Bounded private execution path

`forward.mjs` and `forward-cli.mjs` admit only the reviewed 50/51 expansion pair and separate 52 activation. They never replay the historical 49 files or rewrite the import-time ledger. The executor checks the exact Azure host/database/admin/TLS guard, PostgreSQL 17, recognized imported/source baseline hashes, required protected built-in roles, all role permission-array bytes, nullable deadline columns, revision trigger and guarded RPC privileges. A reviewed plan is rechecked under transaction/advisory/role-table locks. Expansion plus its two checksum receipts is atomic; activation and receipt 3 are a separate transaction. Successful phases issue the PostgREST schema-cache reload notification.

The existing encrypted private migration job now has four fixed forward actions. Its managed identity, per-secret grants, exact target and archive rules remain bounded to Academy. Forward packages contain the reviewed SQL/code and locked `pg` closure, never a source snapshot or data importer. A forward apply requires a clean committed checkout: the package records its exact commit/tree and both preparation and start reject missing, dirty or stale provenance. Read-only preflight packages may truthfully record null commit/tree with `sourceClean: false`; they cannot be used for a write. Remote receipts are immutable and uniquely named. Local selected receipt copies are metadata only. The activation evidence is an external operator attestation: the CLI checks it but does not independently prove deployment readiness.

After local verification, obtain the read-only expansion plan:

```sh
node infra/azure-core/migration/package.mjs --forward
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare --forward-plan
node infra/azure-core/migration/deploy.mjs --start --forward-plan
```

Wait for the selected execution to report `Succeeded`, then retrieve and review it:

```sh
node infra/azure-core/migration/deploy.mjs --receipt --forward-plan
install -m 600 build/azure-core/hosted-forward-plan.json build/azure-core/private/forward-plan.json
```

Only after the integrated full local gate, plan review and commit of the tested tree, package that exact plan from the clean committed checkout and execute expansion:

```sh
node infra/azure-core/migration/package.mjs --forward
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare --forward-schema
node infra/azure-core/migration/deploy.mjs --start --forward-schema
```

After execution succeeds, retrieve `--receipt --forward-schema`, run a fresh `--forward-plan`, and verify receipt count 2, source/transformed checksums, unchanged role digest and new table/column/RPC visibility through the live PostgREST schema cache. Do not deploy the application until those gates pass. Unknown outcomes require inspection and a fresh plan; never blindly replay an old apply plan.

After the compatible production deployment is independently observed Ready at the intended tested code/SHA, prepare/start/retrieve `--forward-activation-plan`. Copy `hosted-forward-activation-plan.json` to the fixed private `forward-plan.json`. Write the independently verified attestation to mode-0600 `build/azure-core/private/forward-deployment-evidence.json` with `{ "rootVerifiedReady": true, "reviewedSha": "<40-character deployed SHA>", "verifiedSha": "<same independently verified SHA>" }`. Bind the deployed merge tree to the locally tested tree; matching two manually supplied strings alone is not deployment evidence. Repackage/verify, then prepare/start/retrieve `--forward-activate`. Verify receipt count 3, exact grants and protection trigger, followed by the live role/feature checks below. The fixed activation CLI refuses missing, mismatched or unverified evidence before connecting.

## Expand, deploy, activate

1. Apply the reviewed schema expansion **only through migration 51**: `20261105000000_teaching_canvas.sql` then `20261105010000_teaching_announcement_revisions.sql`. These add teaching schema and revision enforcement but do not add the new teaching permissions to persisted built-in role definitions. Confirm transaction outcome, exact checksums, permissions, snapshot triggers, audit behavior and PostgREST schema visibility before application deployment. If an outcome is uncertain, inspect it before any retry.
2. Deploy the locally verified compatible application revision. Confirm the actual production deployment is Ready and serves the intended SHA, then verify authentication and existing learner, grading and administrative flows. The current application reads the new snapshot columns, so deployment before the expansion is not compatible. Do not treat a merge or local fixture as proof that deployment is ready.
3. Only after the compatible parser is live and verified, separately apply `20261105020000_teaching_permissions_activation.sql`. It adds missing teaching permissions to teacher and central administrator built-in definitions without granting them to School Admin. Confirm each grant once, authorization by selected school, announcement revision conflicts and schedule behavior. Verify live functionality and deployment independently of local tests. The activation must never be swept into a pre-deploy apply-all run.

The release owner records actual execution evidence, source and transformed hashes, deployment SHA, verification results and any remaining gates in the authorized release record. This document makes no assertion that these steps have occurred.

## Rollback

The previous application at `bba972b` rejects unknown permissions while resolving actors. After activation, do not roll back to it unless **all** built-in and custom role assignments carrying either teaching permission have been reconciled and the permissions removed safely, or choose a compatible application revision instead. Verify role definitions, assignments, actor resolution and active sessions before reopening traffic. The schema migrations are forward-only; selecting an earlier application deployment does not reverse them. Preserve and reconcile accepted Azure writes and deadline snapshots under the incident recovery procedure before any database or provider rollback; do not assume the frozen legacy source contains later changes.
