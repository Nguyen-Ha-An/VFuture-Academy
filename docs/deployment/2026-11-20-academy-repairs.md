# Academy database repair release

The private PostgreSQL 17 job applies seven numbered November 20 migrations, followed by `src/lib/identity/recovery-sessions.sql` and `scripts/azure-core/owner-reservations.sql`. The fixed action is `forward-56`. An existing Azure installation must have the completed teacher release. A fresh installation uses the same SQL through the normal schema builder.

## Local evidence

Use an existing native PostgreSQL 17 binary directory for the disposable rehearsal.

```sh
STUDIO_POSTGRES_BIN=<existing-postgres-17-bin> node scripts/azure-core/rehearse-forward-56.mjs
```

The rehearsal builds the real V1, assessment, handle and teacher release receipts in a socket-only database. It checks all nine SQL steps, failure at the last step, stale source or plan rejection, a second read-only plan and an idempotent apply. It compares the repaired schema with a fresh installation and detects drift in committed catalog objects. Its source metadata and transport digests are fixtures. The release candidate also requires the repository Graphify refresh, Graphify check and full local verifier. Hosted state, PostgREST visibility and application behavior require separate release evidence.

The PostgreSQL 17 catalog contract records the affected relations and routine families, including their definitions, grants, policies, triggers, constraints and indexes. `--show-catalog` on the disposable rehearsal prints an independently derived contract for SQL review. A deployed mismatch requires investigation of the target and the reviewed SQL.

## Post55 evidence

Use the original **successful post55 read-only plan** from the teacher release. Preserve the complete hosted `forward-55-plan` receipt with `plan.action` equal to `noop` as mode 0600 `build/azure-core/private/forward-56-v1-evidence.json`. Keep its original bytes across all repair packages. The immutable receipt blob and the matching historical package receipt establish its provenance. The short apply acknowledgement identifies a completed job but omits the data needed to package a repair.

| Required metadata | Authoritative source |
| --- | --- |
| V1 activation deployment SHA and the six recorded handle-release predecessor fields | The teacher plan's `activationSha` and `predecessor`, checked against the V1 and handle receipts by the existing teacher job |
| Five migration names and source/Azure hashes, identity hash, import baseline, prior-receipt digest | The same teacher plan, checked against the fixed teacher SQL and imported database ledger |
| Role count, role digest and recorded teacher-release source commit/tree | The post55 `noop` plan. Its executor checks both role digests in `academy_private.teaching_forward_receipt` and the physical teacher-release postconditions |
| Plan source, cutover counts and the three package transport digests | The unmodified hosted plan envelope, including `packageContentSha256`, `encryptedPackageSha256` and `sourceManifestSha256` |

If a retained noop receipt is unavailable, use the already supported, independently authorized `forward-55-plan` manual job. Its SQL transaction is read-only. Use a matching original package and checkout, or rebuild the fixed 55 package from a clean checkout with its verified V1/54 evidence. The original reviewed 55 plan records the `activationSha` and six `predecessor` fields needed to reassemble that evidence. Obtain the immutable plan receipt using the existing teacher release procedure and require `noop`. Preparing a fresh job and retrieving its receipt use the existing Azure control-plane permissions. The generic probe reports counts and import state. The teacher plan supplies the predecessor proof through the existing private network and credential grants. [Teacher release procedure](teacher-assignments-release.md)

The teacher release bound the full set of role definitions, including custom roles. An authorized role addition or permission change after that release can therefore prevent predecessor verification. Preserve the current roles and original receipts, document the intervening change and obtain a separately reviewed release decision.

## Authorized operator sequence

Start from the clean, committed release checkout with local verification complete. Check the intended PostgreSQL maintenance window before creating the package. The SQL builds indexes, backfills existing sequential attempts and retained notebook reservations, and invalidates open course reviews whose bank pins have changed. Schedule the application release after database acceptance.

Verify the retained native bucket maxima are at most 50 MiB for media and submissions and 10 MiB for notebooks. Check the verified Azure storage inventory and the expiry reconciliation job. Existing signed notebook holds must be attributable to their artifact owners. The migration aborts if a historical path cannot be matched. For a classic Supabase installation, verify the older notebook token lifetime fits the 245-minute backfill window counted from artifact creation. It comprises the former two-hour signing window, two-hour token and five minutes of grace. New application grants record their actual expiry.

1. With the recovered evidence in place and no prior repair plan in the private plan slot, create the plan package and verify the encrypted archive offline.

   ```sh
   node infra/azure-core/migration/package.mjs --forward-56
   node infra/azure-core/migration/verify-package.mjs
   ```

2. Under separate release authorization, prepare and start the fixed read-only plan. Check execution completion, then retrieve the receipt.

   ```sh
   node infra/azure-core/migration/deploy.mjs --prepare --forward-56-plan
   node infra/azure-core/migration/deploy.mjs --start --forward-56-plan
   node infra/azure-core/migration/deploy.mjs --receipt --forward-56-plan
   ```

3. Review `build/azure-core/hosted-forward-56-plan.json`. Confirm the action, all nine ordered source/Azure hashes, expected catalog digest, prior-receipt digest, evidence digest, clean source commit/tree and transport digests. Preserve the complete reviewed file as mode 0600 `build/azure-core/private/forward-56-plan.json`. Rebuild with `--forward-56` and repeat the offline archive check. The stable content hash must match the reviewed plan package.

4. With approval for the database change, prepare, start, check completion and retrieve the apply receipt.

   ```sh
   node infra/azure-core/migration/deploy.mjs --prepare --forward-56-apply
   node infra/azure-core/migration/deploy.mjs --start --forward-56-apply
   node infra/azure-core/migration/deploy.mjs --receipt --forward-56-apply
   ```

5. Repeat the read-only plan sequence against the resulting database. Require `noop`, the expected post-release catalog digest and matching recorded release source commit/tree. Independently check the PostgREST schema reload and application behavior under the intended account roles before promoting the dependent application.

The apply operation rechecks the reviewed plan under the existing transaction-level release lock, then commits the SQL and a single private `academy_private.repair_forward_receipt` together. Earlier migration receipts stay intact. If a job times out or receipt delivery fails, inspect the database with a newly authorized read-only plan before retrying. An unchanged pre-release catalog permits a newly reviewed apply. A matching post-release receipt supports a noop. An unknown or partially repaired catalog fails both checks.
