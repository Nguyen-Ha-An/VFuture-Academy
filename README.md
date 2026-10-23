# VFuture Academy

Standalone bilingual learning platform extracted from `Nguyen-Ha-An/VFuture-Central` at source commit `6959342e8d687d76d3ece4c553f7020b79558bf4` (including the source snapshot's unmerged fixes). This repository starts a fresh history; it contains no runtime import, submodule, or committed symlink to Central.

Academy owns public course/resource/project/opportunity catalogs and their APIs, learner `/app` and legacy learning routes, authentication/accounts, Studio, Admin, Grading, certificates/profiles, content engine and schemas, Studio MCP/OAuth, and the isolated notebook runtime. `/` is the Academy gateway; `/academy` redirects there while retaining query context. Competition implementation and its eight migrations belong to the separate Competition repository. The corporate Labs website belongs to Central. The geometric brand mark and small public presentation primitives are independent local copies.

**Infrastructure status:** the user deferred creation of new Supabase projects. Academy is prepared for its own future Database, Auth, Storage and OAuth configuration. No new project, user-data migration, credential transfer, or live database/schema change is performed by this extraction. Existing Central production observations do not establish readiness of this new deployment. Keep the product offline until its independent configuration and end-to-end gates are complete.

## Local setup

Use Node 24 and npm 11, then:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Supply Academy's own Supabase URL/public key/service-role key and `NEXT_PUBLIC_APP_URL`; the service key stays server-only. `NEXT_PUBLIC_CENTRAL_URL` links to the corporate site. `NEXT_PUBLIC_COMPETITION_URL`, if set, links to the separate Competition deployment. Do not point Academy at Central's old backend by default. `.env.local`, Vercel linkage, browser states, dumps, synthetic fixture data, generated workers/builds and `node_modules` are not committed.

The package install can be shared by a temporary uncommitted local symlink while extracting on a disk-constrained machine; deployment and `npm ci` use this repository's own lockfile and source.

## Mandatory local release gate

All applicable validation runs locally before merging. GitHub Actions is **deployment-only**. A deployment does not substitute for local checks or hosted acceptance.

```sh
npm run graphify:refresh
npm run graphify:check
npm run verify:local
# Optional full Firefox/WebKit and reviewed student visual coverage:
npm run verify:local -- --full
# Lower disk usage on machines where the Turbopack cache is too large:
npm run verify:local -- --webpack
```

Graphify analyzes the whole repository with an explicit inventory/fingerprint manifest; see [Graphify policy](docs/architecture/Graphify-policy.md). Refresh the graph after source, configuration, SQL, test or documentation changes. `verify:local` begins with `graphify:check`, then runs types, ESLint, all Vitest projects with at most two workers, authored content/schema validation, production build, disposable local PostgreSQL contracts, and the retained Studio/Admin/student browser harnesses. It refuses to run on a GitHub Actions runner. SQL fixtures create isolated local databases and do not connect to hosted Supabase. The Studio concurrency contract uses native PostgreSQL with an exclusive temporary Unix socket and TCP disabled; it stops and deletes that cluster afterward. Supply `STUDIO_POSTGRES_BIN=/path/to/postgresql/bin` (or `POSTGRES_BIN`) to reuse existing `initdb`, `pg_ctl` and `postgres` binaries. Without an override, the macOS/Linux local gate installs the exact `@embedded-postgres/<platform>-<arch>@17.10.0-beta.17` toolchain into a temporary prefix with lifecycle scripts disabled, hydrates only its bounded native-library symlinks, and deletes that toolchain after the test. Keep enough disk available for one native toolchain and cluster.

Targeted work can use `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=2`, `npm run content:validate`, `npm run content:audit`, `npm run content:compile`, and `npm run schema:check`. A targeted green check is not the complete release gate. Product public browser acceptance is retained under `tests/e2e/public-site/`; start a local production preview and run its independent config. Hosted seeded tests are opt-in and must use a designated nonproduction Academy project.

## Independent database and Auth setup

Provisioning is pending and is deliberately separate from the source split. When authorized, create an Academy-only Supabase project, configure `.env.local`/hosting variables, then apply the checked-in migration files in lexical order with `npm run migrate`. The executor records each exact filename in `public.schema_migrations`; historical filenames and SQL are preserved byte-for-byte. Gaps in the inherited numeric sequence are intentional. Competition-only migrations are excluded; no Academy bootstrap requires Competition tables or RPCs. The forward `20261023120729_preserve_shared_content_destinations.sql` fix preserves learner links for read-only shared content while keeping editable Studio links and publication privacy. It has not been applied to any live database. See [database ownership and cutover](docs/database-ownership.md).

Configure the Auth Site URL to Academy's canonical origin and allow its exact `/auth/callback` and `/auth/recovery` return URLs. Configure Google/provider credentials and redirect URIs for this new Supabase project. Preserve host-bound PKCE/session cookies; Central links and redirects do not create an Academy session. Set up the private `media`, `submissions`, and `certificates` Storage buckets, intended policies and media MIME/size controls; revalidate asset access and signed downloads. The retained `setup:staging-auth`, `setup:staging-storage`, and `seed:dev` commands target explicit nonproduction projects only. Configure `SUPABASE_PRODUCTION_PROJECT_REF` to protect the Academy production identity from fixture seeding.

Keep `STUDIO_MCP_ENABLED=0` until the independent OAuth server/client and consent flow is configured. `MCP_RESOURCE_URL` must be Academy's exact canonical `/api/mcp` URL; configure OAuth authorization path `/studio/connect/authorize`, allowed clients/redirects, `MCP_ALLOWED_ORIGINS`, and a fresh server-only preparation proof secret. Reconnect external clients to the new resource and verify consent, permissions, refresh/revocation and read-only tool behavior. The source deployment's grants and tokens are not proof of access to the new project. See [Studio MCP](docs/studio/mcp.md).

Notebook runtime assets are built/deployed from `notebook-runtime/` to an isolated origin configured with `NEXT_PUBLIC_NOTEBOOK_RUNTIME_URL`; using Academy's own origin is rejected. Retain the notebook COOP/COEP, CSP, upload and execution constraints.

The rate-limit storage needs periodic expiry cleanup on the Academy database. Configure a database-owned schedule when deployment is authorized, for example:

```sql
select cron.schedule('rate-limit-gc', '*/5 * * * *', $$select public.rate_limit_gc();$$);
```

The exam sweep operational setup is in `scripts/configure-exam-sweep.ts` and `scripts/sql/exam-sweep-scheduler.sql`, outside migration history. It requires the designated Academy project, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, Vault/pg_net/pg_cron and a successful HTTP/application probe before activating the job. Its endpoint is rendered from Academy's configured origin, never Central's old hostname. Do not run setup during source extraction.

## Deployment

The sole active workflow is [deploy.yaml](.github/workflows/deploy.yaml): `main` pushes or a manual run deploy that exact revision via Vercel. It contains no test, build-validation, seed or migration jobs, and uses Academy-specific deployment concurrency. Automatic Vercel Git deployments of `main` are disabled in `vercel.json` to avoid duplicate deployments.

The separate Academy Vercel project and its `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` GitHub production-environment secrets are configured. Application runtime variables are intentionally pending the deferred independent backend. Deploy only a locally validated commit after that setup. Never reuse Central's project linkage. A new URL/domain and future Database/Auth project still need provisioning/configuration; publishing source alone is not a live cutover. Verify the deployed SHA, READY state, root/catalog routes, login/recovery, Studio/Admin/Grading, private media, MCP and notebook flows before claiming production readiness. [Deployment runbook](docs/deployment.md).

Use Git history for rollback. Keep database changes forward-only; do not delete old production tables, rewrite migration records, or restore production data as part of repository cleanup. Policy pages remain drafts unless the existing publication/effective-date gate and reviewed copy are explicitly approved.

If using a self-managed reverse proxy, match the accepted upload/server-action ceiling: `client_max_body_size 50m;`.
