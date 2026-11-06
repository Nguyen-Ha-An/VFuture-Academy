# Simple entrance and managed handles release

This runbook executes the [approved behavior](../superpowers/specs/2026-11-06-simple-entrance-managed-handles.md). It records a procedure, not a claim of production completion. The private migration applies `20261106000000_managed_profile_handles.sql` and then the exact reviewed `src/lib/identity/schema.sql` in one transaction. Existing UUIDs, non-handle profile fields, roles, academic records, the imported baseline and historical Canvas/assessment receipts are retained. Every previous non-null handle is checked against an alias for the same UUID before commit.

## Prepare the tested revision

1. Integrate current main, including `20261105030000_exam_attachment_bindings.sql`. Inspect its actual completed production receipt through the private target; filenames and old logs alone are insufficient. The handle executor requires the full frozen Canvas and assessment boundary, checksums and committed assessment provenance. Unknown or partially applied state must be reconciled before another write.
2. Review migration 54, the identity suffix, all new package code, the operator read-only plan and database backup/recovery. The frozen `scripts/azure-core/baselines/identity-pre-handles.sql` is the pre-handle identity suffix, retained only for explicit historical schema boundaries through migration 53. Do not edit it or update older receipt digests to match current code.
3. Finish all source, configuration, SQL, documentation and tests. Run `npm run graphify:refresh`, `npm run graphify:check`, then `npm run verify:local`. Resolve failures and review the tracked Graphify manifest with the source. Any later source change requires another refresh. Commit the exact tested tree, including the manifest, and keep the full graph, provider responses, authentication state and keys ignored.
4. Record the prior Vercel deployment and its actual source SHA, plus the bounded recovery plan. Keep PostgreSQL public networking disabled, and use only the approved Academy subscription/resource group and its existing migration identity.

## Provider configuration

Google sign-in now uses direct Google OIDC, with an Academy-owned `/auth/callback`; it does not enter the Entra CIAM user flow or its Add details page. Configure the approved Google Web client's exact canonical redirect URI and server-only `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on the target deployment. Keep downloaded client JSON, secret values, provider tokens and account evidence in ignored private storage; expose no credential through public build variables or logs. Request only `openid profile email`, with state/nonce/PKCE, `access_type=offline` and `prompt=select_account consent`. Read back the exact client redirect configuration and target environment separately; those configuration checks do not prove a successful login.

Direct Google requires the existing customer-directory administration app and its existing `User.ReadWrite.All` grant in the pinned Academy customer tenant. Do not add a Graph permission, administrator role or email-linking rule for this release. After verifying the signed Google token, the adapter resolves immutable Google `sub` to the exact enabled `google.com` federated directory identity, then resolves that Entra object UUID through the existing Academy mapping. Existing Academy UUIDs must survive. New disposable users may create a federated directory identity only after Google validation; unknown-sub email collisions fail closed. Refresh cannot provision or link accounts.

The `configure-entry-flow.mjs` change concerns the retained CIAM/native configuration, rather than the mechanism that bypasses CIAM for Google. Run `node scripts/azure-core/configure-entry-flow.mjs` to inspect the exact proposal, then apply only the reviewed changes with `--apply`. It deselects Display Name from the fixed Academy flow through the documented [Remove attribute relationship API](https://learn.microsoft.com/en-us/graph/api/onattributecollectionexternalusersselfservicesignup-delete-attributes?view=graph-rest-1.0), using `DELETE .../onAttributeCollection/microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp/attributes/displayName/$ref`. Email and unrelated collection attributes remain unchanged; an absent Display Name relationship is a no-op. The script also requests signed workforce account/UPN information without authorizing staff or replacing token validation.

Hiding the Display Name input alone leaves its collection relationship selected. Deleting the relationship alone does not establish that built-in Google federation skips Add details or retains Google names; current Google authentication instead uses the direct adapter above. The script backs up the complete relationship/page configuration and workforce claims in ignored private storage, then checks the resulting collection exactly. Retain the backup for recovery. To restore Display Name, use the documented Add attribute relationship API first, then PATCH only the backed-up page configuration; PATCHing page inputs alone cannot restore the relationship. Restore workforce claims separately only if needed.

The compatible native application stops sending the deselected name as an Entra signup attribute. It retains the submitted full name in the encrypted, browser-bound signup continuation, then initializes the Academy profile after successful signup OTP verification. Existing edited profile names remain unchanged; Academy name storage does not establish the same Entra directory name.

After configuration/deployment, perform a fresh direct Google signup with a disposable account and an existing Google-account login. Confirm the popup opens Google's endpoint, returns directly to Academy without any CIAM details step, and the verified Google email/name reach the server actor/profile. Confirm the existing account retains its Academy UUID, roles and academic records. The known untouched `unknown` name/generated handle may be repaired from the verified Google name while preserving its previous URL alias; edited names and handles must survive. If Google omits a name, test the Academy name-only fallback instead of inventing one from email.

Complete a real Google refresh and recheck the same Google sub, enabled directory object and active Academy UUID mapping. A missing refresh grant gives only an ID-token-lifetime session even though consent was requested; do not claim 30-day continuity from login alone. Check Google logout revokes the local Academy session and returns to Academy without CIAM/global Google logout. Separately confirm a native disposable signup's submitted full name survives OTP and initializes the profile even when Entra emits a generic directory name. These checks require no changes to migration 54 or its frozen identity suffix.

Existing workforce mappings with missing stored company email, a non-exact company domain, a disabled/deleted identity or no active staff permission remain excluded from initial `VFU-` promotion. Review `workforceMappedCount`, `workforceEligibleCount` and `workforceExcludedCount` in the private read-only plan before apply; the executor computes them using the migration eligibility predicate. Keep any account-level investigation private; record only reviewed counts. A missing record must be repaired through the approved identity-mapping procedure, never inferred from a display name or unverified email. Active callback promotion additionally requires the signed workforce account type and exact UPN checks.

## Private read-only plan

From the exact clean committed checkout, put the independently verified existing Canvas activation SHA in mode-0600 `build/azure-core/private/forward-54-v1-evidence.json`:

```json
{ "verified": true, "activationSha": "<actual 40-character activation deployment SHA>" }
```

The file attests the observed predecessor; matching manually supplied strings alone is not hosted evidence. The following package contains fixed source/SQL and the locked `pg` closure, with no data snapshot or fresh-target importer:

```sh
node infra/azure-core/migration/package.mjs --forward-54
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare --forward-54-plan
node infra/azure-core/migration/deploy.mjs --start --forward-54-plan
```

Wait for that selected private Container Apps job execution to report `Succeeded`, then retrieve and review the exact package-bound metadata:

```sh
node infra/azure-core/migration/deploy.mjs --receipt --forward-54-plan
install -m 600 build/azure-core/hosted-forward-54-plan.json build/azure-core/private/forward-54-plan.json
```

Require `action: apply`, the fixed migration filename, migration source/transformed hashes, identity suffix hash, frozen import baseline, actual activation SHA and unchanged predecessor/role digests. The plan/receipt must match the same clean commit/tree and package content. Receipt metadata contains no profile rows, credentials or provider tokens.

## Apply, then deploy

Repackage the reviewed plan from the same clean commit/tree. Both local preparation and start verify source provenance, package/manifest hashes, exact job image/bootstrap, managed identity, target and environment. The private job validates all executable/dependency bytes before fetching database credentials.

```sh
node infra/azure-core/migration/package.mjs --forward-54
node infra/azure-core/migration/verify-package.mjs
node infra/azure-core/migration/deploy.mjs --prepare --forward-54-apply
node infra/azure-core/migration/deploy.mjs --start --forward-54-apply
```

After the selected execution reports `Succeeded`, run `node infra/azure-core/migration/deploy.mjs --receipt --forward-54-apply`. Require `outcome: applied` and exact source/package bindings. Obtain a new read-only plan and require `action: noop`, the committed handle ledger and expected canonical/alias/privacy/privilege postconditions. Confirm PostgREST has reloaded the schema and exposes the new service-only profile projection/RPC contract. A failed or missing receipt does not establish transaction outcome; inspect live state and obtain a fresh plan before retrying.

Keep the apply-to-deploy window short: the previous application may not recognize the new canonical profile format or aliases while its earlier profile editor and public lookup are still live. Deploy the compatible application immediately after schema visibility passes. Merge/deploy through the deployment-only GitHub workflow. Observe the actual Vercel production deployment `Ready` and bind its source SHA/tree to the locally tested revision. Verify the canonical hostname serves that deployment; a merge or successful database job does not prove it.

## Hosted acceptance and recovery

Exercise signed-out root at desktop/mobile widths, existing authenticated redirect and Google/email login. Check signup name behavior, recovery entry, logout and approved staff Microsoft. Confirm an unmapped, inactive, guest or wrong-domain Microsoft identity cannot gain staff access or `VFU-`. Use disposable accounts for new-user writes; do not alter a real learner attempt.

Confirm current Google/email users show actual `STU-` handles and eligible approved staff show actual `VFU-` handles. Test canonical and historical public-profile links, canonical metadata, subsequent handle changes preserving aliases, duplicate/alias reservation and private-profile denial through both routes. Retained legal, invitation, verification and profile routes must remain reachable with their existing security boundaries. Inspect application/provider errors privately without logging credentials or codes.

Record actual job execution/immutable receipt names, package/source/identity hashes, applied source commit/tree, provider readback, Vercel deployment/SHA and each live probe result. State any untested real signup/recovery delivery, role or browser case explicitly. This release does not establish capacity, full administrative CRUD, notebook/MCP acceptance or billing guarantees.

The handle migration is forward-only. Reverting the web deployment does not undo canonical handles or aliases. Prefer a compatible prior application while retaining the new data. If provider configuration must be restored, restore only the backed-up changed fields and read them back. Before database restoration, freeze writes and reconcile all accepted work under the incident procedure; the frozen legacy Supabase source cannot contain later Azure writes. Do not drop aliases, rewrite earlier ledgers, reopen public PostgreSQL access or rerun the importer as rollback.
