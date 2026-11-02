# Academy Azure database and retained Storage

The application remains on Supabase unless both `ACADEMY_BACKEND` and `NEXT_PUBLIC_ACADEMY_BACKEND` are `azure`. Azure data requests use the existing `.from()`/`.rpc()` interfaces over PostgREST. The server signs a fresh 60-second HS256 token with audience `academy-data`, issuer `academy-server`, and either `authenticated` plus the mapped Academy UUID or `service_role`. There is no anonymous data role. Configure `PGRST_DB_PRE_REQUEST=academy_private.authorize_request` and expose only `public`.

`AZURE_POSTGREST_URL` is the HTTPS origin of native PostgREST, without `/rest/v1`. `AZURE_POSTGREST_JWT_SECRET` stays server-side and must contain at least 32 bytes. `SUPABASE_STORAGE_URL` and `SUPABASE_STORAGE_SERVICE_ROLE_KEY` exclusively configure retained Storage. The Azure auth facade uses the owned identity RPC and never calls Supabase Auth; unsupported legacy administration operations fail closed. Runtime Vercel code never connects directly to private PostgreSQL.

## Schema and local rehearsal

The fresh-target bootstrap creates owned identity records in `academy_identity.users`, stable UUID foreign keys, compatibility `auth.uid()`/`auth.role()` helpers, fixed database roles, and the private inventory. `schema.mjs` replays all checked-in application migrations with explicit `auth.users` reference replacements and three exact, digest-recorded Storage DDL omissions. Applied legacy migrations remain unchanged. The Azure media quota variation is derived separately. Only regular migration files with a four- or fourteen-digit prefix and lowercase snake-case `.sql` name are eligible. AppleDouble sidecars, `.DS_Store`, `__MACOSX` and unknown SQL names abort generation before any database connection; they are never silently omitted or executed. Any new unmapped vendor dependency aborts generation. Identity/session SQL is appended after all application migrations. No GoTrue, Storage schema, Vault, pg_net or pg_cron is installed.

Install the optional local runtime outside the checkout and reuse it:

```sh
npm install --prefix /tmp/vfuture-azure-core-pglite --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
PGLITE_MODULE_PATH=/tmp/vfuture-azure-core-pglite/node_modules/@electric-sql/pglite node scripts/azure-core/rehearse.mjs
```

The rehearsal covers all 63 owned public tables, identity triggers, RLS isolation, private RPC ACLs, JWT issuer checks, fenced/idempotent media finalize, one-byte signed-upload quota evasion, delayed quota release, full synthetic transfer and FK/row/sequence reconciliation. It writes a nonsecret receipt to ignored `build/azure-core/local-rehearsal.json`. This is PostgreSQL semantics evidence; PGlite does not establish native multi-connection concurrency, Azure role provisioning, private routing or hosted performance.

## Source capture and restore

Prefer one read-only database snapshot through an authorized SQL connector. The sensitive JSON contract is:

- `format: 1` and `schemaSha256` from `buildAzureSchema().receipt`.
- `tables`: all 63 application public base tables, excluding the source migration ledger, with complete row objects. Do not export views as tables.
- `users`: only `id`, `email`, `raw_user_meta_data`, `created_at` from legacy identity records. Never include passwords, provider tokens or sessions.
- `sequences`: `name`, `last_value` as a decimal string and `is_called` for `analytics_events_id_seq` and `audit_log_id_seq`.
- `storage`: `bucket_id`, `name` and `metadata: {size, mimetype}`. SQL metadata alone is explicitly insufficient to activate upload admission.

Save it mode 0600 under `build/azure-core/private/source-snapshot.json`. An API-only fallback exists in `export.mjs`: it requires an operator-confirmed source write freeze, expired native upload tokens, two matching deterministic paginated reads, and separately supplied read-only sequence states in `build/azure-core/source-sequences.json`. API pagination is not a database snapshot. `SOURCE_SUPABASE_URL` and `SOURCE_SUPABASE_SERVICE_ROLE_KEY` are read-only operation credentials; never print or commit their values.

Run `node scripts/azure-core/verify-storage.mjs` with those source credentials to compare the snapshot with actual Storage object-info APIs, verify private buckets, and record actual native bucket caps. Only a matching API receipt enables upload admission after import. This tool only reads the source; it does not configure buckets. Keep source writes frozen through the final cutover capture. A live-source capture is useful rehearsal evidence only.

```sh
PGLITE_MODULE_PATH=/tmp/vfuture-azure-core-pglite/node_modules/@electric-sql/pglite node scripts/azure-core/rehearse-snapshot.mjs
node scripts/azure-core/migrate.mjs schema
```

The second command generates reviewable SQL and a source/hash receipt without opening a database connection. From the approved private-network migration runner, provide `AZURE_DATABASE_URL` plus `AZURE_TARGET_HOST` from the verified PostgreSQL resource output and run `schema --apply`, then `import --apply`. Both write helpers require that exact host, database `/academy`, login `academy_admin`, and the default PostgreSQL port. Only an absent query or one `sslmode=verify-full` parameter is accepted; connection-parameter overrides and fragments are rejected before a client is constructed. Certificate verification remains enabled. The bootstrap requires an empty target. Its ordered owned-file steps execute inside one transaction; any failed step rolls the schema back. Safe diagnostics report only the exact owned step identifier, SQLSTATE/connection code and positive statement position, never raw database messages or import values. The combined review SQL and schema digest are identical to the concatenated steps. The import requires a fresh `prepared` migration state and refuses to overwrite an active target. It disables only user triggers inside its transaction, temporarily defers/reinstates foreign keys, excludes generated columns from inserts, restores sequence counters, and compares all row/identity/storage hashes before committing. Timestamp comparison preserves all six microsecond digits across session time zones. A failed transaction rolls back data; the target must be reviewed privately before retrying.

The schema creates `academy_authenticator NOLOGIN NOINHERIT`; the private provisioning workflow must separately grant a restricted login credential and verify Azure can create the required `service_role BYPASSRLS`. Run `configure-authenticator.mjs` inside the private runner with `AZURE_DATABASE_URL`, `AZURE_AUTHENTICATOR_PASSWORD` and an explicit `AZURE_AUTHENTICATOR_EXPIRES_AT`; it validates the exact role memberships and emits only the role/expiry. The application does not receive the migration administrator URL. Imported password users require explicit verified Entra object-to-Academy UUID mappings, reauthentication and password reset; email equality never links identities.

## Storage quota and cleanup

Hosted native signed tokens do not enforce the browser's declared file size. Before signing, the adapter reads the actual private bucket and rejects missing, nonpositive or excessive `file_size_limit`: media/submissions must be at most 50 MiB and notebooks at most 10 MiB. Azure reservations conservatively hold two full native-cap copies (100 MiB or 20 MiB), even for a declared one-byte upload. The larger holds affect admission capacity deliberately. Actual bytes/checksum validation and immutable ready objects remain mandatory.

Successful writes are observed through Storage's object-info API before inventory publication. Generic writes reserve bytes before upload, reject upserts, and have a 120-second network bound. Failed writes retain a 15-minute conservative hold. Notebook native-token holds persist through the actual signed expiry plus five minutes, including after pending-path removal. Direct-upload leases/quarantine retain their existing fenced cleanup contract.

The authenticated five-minute exam sweep also reconciles up to 25 expired inventory holds in Azure mode. It calls actual object-info: a confirmed 404 permits quota release, an existing object becomes real counted inventory, and an ambiguous response retains quota. SQL checks the observation version and expiry again, so a newly extended hold cannot be released by a stale worker. Abandoned existing bytes remain counted until an approved object-deletion workflow removes them. Do not allow a legacy deployment or other application to write these owned Storage paths after cutover; external writes require a fresh inventory reconciliation.

## Remaining hosted gates

No local receipt proves final source write freeze, actual Storage API verification, native bucket caps, private Azure connectivity, PostgREST schema-cache behavior, Azure role capability, identity/provider configuration, sole scheduler ownership, pilot load acceptance, billing attribution or rollback after Azure writes. Preserve those release gates. Keep snapshots, keys and full Graphify output ignored; commit only reviewed source and nonsecret evidence selected by the coordinator.

## Account lifecycle and Studio media deletion

The Azure schema now includes `src/lib/identity/admin-schema.sql`, followed by the database request guard in `account-access.sql`. Account lifecycle journals and retained user records remain private. An authenticated API token issued before suspension, disable or deletion is rejected by the next PostgREST pre-request check; service calls still require their actor-specific permission checks.

`media-delete.sql` adds service-only `academy_media_delete_begin(actor,asset,scope,branch)` and `academy_media_delete_finish(actor,asset,scope,branch)`. Both recheck effective persisted `content.edit` or `media.upload` permission in the requested scope. Only unused `media` bucket assets with purpose `content` are eligible. Drafts, all historical course/question versions and renders, CMS snapshots/reviews/publications, resources/projects, submissions, certificates and notebook records remain protected. Reference matching includes asset IDs, app/public media URLs and retained Storage object URLs, including percent-encoded paths.

Every reference writer updates a per-asset guard row in the same transaction as its reference. Deletion locks that same row before its reference scan and then commits a pending tombstone. Writers cannot reference pending/deleted assets or introduce aliases for the same Storage object. Updating the row revision, rather than only acquiring a lock, also forces an old REPEATABLE READ deletion transaction to abort if another writer committed since its snapshot. Existing CMS content lock ordering is retained.

After actual Storage removal and object-info-confirmed absence, the adapter reconciles inventory. Finish refuses remaining inventory or token holds, removes the active library row, and retains the original metadata and audit history in the private tombstone. Repeated begin/finish calls are idempotent. A 404 from remove is treated as success only after an independent object-info 404; ambiguous responses preserve quota and pending state.

Focused local contracts (run sequentially when the coordinator permits):

```sh
PGLITE_MODULE_PATH=/tmp/vfuture-azure-core-pglite/node_modules/@electric-sql/pglite npx vitest run tests/scripts/azure-admin-schema.test.ts tests/scripts/azure-media-delete-schema.test.ts
npx vitest run tests/lib/database/retained-storage.test.ts
```

`verify-media-delete-concurrency.mjs` is a separate native multi-connection test. It accepts only an explicitly empty dedicated loopback database whose name ends in `_media_delete_test`, configured by `ACADEMY_NATIVE_TEST_DATABASE_URL`, and requires a fresh test cluster without the application roles. It tests both writer/deleter commit orders and old REPEATABLE READ snapshots. It intentionally does not accept production or Azure URLs, and does not establish hosted concurrency until separately rehearsed in the approved release environment.
