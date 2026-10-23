# Studio simplification delivery

This document describes retained source behavior and its source-era validation. Independent Academy infrastructure and production cutover are pending; use [the current deployment runbook](../deployment.md) for release status.

The authoring workspace now keeps edits local until Save draft. Preview compiles an unsaved snapshot without persistence. Importing into the open course and restoring a published version only replace the local working copy. Creating a separate course is an explicit Create and save draft action.

Desktop uses outline / JSON / preview. Small screens use JSON and Preview tabs plus an outline drawer. Form editing and the prompt tool were removed from the workspace; content schema files are in [content-schema](./content-schema/README.md).

Studio has Courses and Media. Other existing features are under Admin, with their original per-feature and branch permissions. Legacy Studio page links redirect to the matching Admin page; API URLs are unchanged. Learner version migration is an explicit Admin operation.

## Deploy

1. Review and apply `supabase/migrations/0034_studio_atomic_workspace.sql` using the existing migration runner against the intended deployment environment.
2. Release the application after the migration succeeds. Existing individual-document APIs continue to work.
3. Verify save, preview, publish and legacy redirects with an authorized test account. Do not automatically migrate learners.

This implementation session does not apply a migration to the shared remote database or deploy the application.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `node scripts/verify-studio-transactions.mjs`
- `npx playwright test --config playwright.studio.config.ts`

Final verification: 261 Vitest suites / 2,150 tests and all 8 isolated Chromium browser tests pass. Typecheck, lint and the production build pass. Browser coverage includes real CodeMirror edits, preview without writes, atomic save payloads, invalid JSON fallback, responsive drawers, unsaved navigation, Back/Forward, read-only mode and Vietnamese/English. Publication now requires an `If-Match` header; callers must send the revision of the draft they reviewed.

The PostgreSQL harness uses a temporary pinned PGlite installation and actual migration SQL; see [backend verification](./backend-verification.md). It checks transaction rollback, revision conflicts and role privileges. It does not emulate a multi-session concurrency blocking schedule.

The isolated browser harness exercises actual Studio UI with controlled API responses and routing adapters. It does not certify remote authentication or a deployed database. The authenticated main Playwright suite remains the deployment-environment integration check.
