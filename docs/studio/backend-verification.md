# Studio backend transaction verification

Run the Studio database harness from the repository root:

```sh
node scripts/verify-studio-transactions.mjs
```

The script installs pinned `@electric-sql/pglite` into a temporary npm prefix, executes the real `0034_studio_atomic_workspace.sql` migration against an in-memory PostgreSQL engine, and removes the temporary runtime afterward. It does not add a production dependency or connect to a local or remote Supabase project.

Local operators can reuse an already isolated npm prefix to avoid downloading the runtime on every run:

```sh
npm install --prefix /tmp/vfuture-pglite --no-save --ignore-scripts @electric-sql/pglite@0.5.8
PGLITE_MODULE_PATH=/tmp/vfuture-pglite node scripts/verify-studio-transactions.mjs
```

The prefix may also be passed as the first argument. A caller-provided prefix remains caller-owned and should be removed by the local cleanup step.

The harness verifies complete workspace replacement, stale revision conflicts, rollback on item failure, immutable item kinds, verified restore bases, transactional course import, duplicate course conflicts, guarded publish with atomic skill synchronization, and `service_role`-only execution privileges.

## Native concurrency contract

`node scripts/verify-studio-workflow-concurrency.mjs` now provisions an exclusive `/tmp/studio-postgres.*/socket` fixture by default, initializes the same CMS fixture schema used by the PGlite review contract, executes the existing multi-connection lock/race assertions, and shuts down/removes the cluster. TCP listening is disabled and verified; no application connection URL is accepted. Set `STUDIO_POSTGRES_BIN` (or `POSTGRES_BIN`) to reuse a local PostgreSQL binary directory. Otherwise the macOS/Linux runner installs pinned platform-native PostgreSQL 17.10.0 binaries in a disposable prefix and removes them after the test. Explicit expert invocation with the fixture socket and `studio_*` database name remains supported. The native fixture is required because PGlite does not reproduce independent connection lock waits.
