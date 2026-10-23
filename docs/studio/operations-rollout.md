# Studio operations

This document describes retained source behavior and its source-era validation. Independent Academy infrastructure and production cutover are pending; use [the current deployment runbook](../deployment.md) for release status.

Content management and learning operations now live in Studio. Admin retains members, schools, roles and audit. Old operator URLs redirect before the Admin layout runs, so a Studio-only role can follow an old bookmark without requiring Admin access.

## Delivered surfaces

- `/studio`: permission-aware overview, recent content and pending review workload.
- `/studio/library`, `/studio/bank`: content inventory and dedicated question bank. Resources, projects and opportunities use canonical Studio editor URLs.
- `/studio/assessments`: assignment inventory and exam operations.
- `/studio/grading`: assignment/exam queues with URL-backed filters and full-page grading. Prompts use the submitted course version or attempt snapshot; nested question groups expose individual manual questions and shared context. Published assignment results lock immediately from the server response. Unsaved edits are guarded and errors retain edits.
- `/studio/reviews`: separate queue and snapshot workbench with rendered content, differences, pinned resources and review history. Bank references resolve against pinned version IDs. Preview cannot create learner attempts or notebook sessions.
- `/studio/analytics`: period/course/school/publication filters; separate quiz, exam and assignment samples; cohort completion and current grading workload. Report-only users do not receive grading links or answer keys.

Avatar and submission assets are classified separately from authoring content. The library, CMS inventory, project covers, metadata updates, ownership assignment and publishing dependency checks reject non-content assets. Existing asset IDs, paths and authenticated playback URLs are preserved.

## Migration order

Apply these forward migrations in filename order before serving the new application:

1. `20260907090000_media_asset_purpose.sql`: classify existing content/avatar/submission assets in place.
2. `20260907090001_media_authoring_guards.sql`: restrict authoring entry points and normalize CMS links.
3. `20260907091000_quiz_attempt_branch_history.sql`: stamp immutable historical branch attribution for quizzes. Ambiguous migrated history is available only to Central, not inferred from a learner's current school.
4. `20260907091001_studio_learning_reports.sql`: reporting RPC and indexes.
5. `20260907091002_review_queue_permissions.sql`: align review-only permissions in both SQL admission and row filtering.

No production database migration, hosted deployment, push or merge was performed in this implementation task. The worktree starts from `41d17b7`; unrelated uncommitted authentication and authoring-document changes remain in the original checkout.

## Verification and repeatability

- Baseline: 296 files / 2,369 tests.
- Final application suite: 305 files / 2,409 tests, passing.
- TypeScript, ESLint and production build pass.
- Playwright Studio harness: 13 passing tests, including account keyboard/focus, mobile grading, report tabs/overflow and existing authoring regression journeys.
- Production `next start` HTTP checks: five legacy redirects return 307 and preserve encoded IDs and repeated query parameters.
- All 38 real migrations execute in PGlite against local Supabase auth/storage schema stubs. Seeded RPC assertions cover asset classification and authoring rejection, pinned media history, report publication and score samples, pending manual grading, readable question prompts, immutable quiz attribution across enrollment migration, and review-only access.
- Independent backend review passed after fixing review-only SQL permissions, migrated quiz history and release-only answer-key exposure. Final UI integration was reviewed and verified locally after subagent quota was exhausted.

The SQL harness is optional tooling, not an application dependency. From the repository root:

```sh
npm install --prefix /tmp/vfuture-sql-runtime --no-audit --no-fund @electric-sql/pglite@0.5.8
PGLITE_RUNTIME=/tmp/vfuture-sql-runtime/node_modules/@electric-sql/pglite node scripts/fixtures/studio-assets-sql.mjs
PGLITE_RUNTIME=/tmp/vfuture-sql-runtime/node_modules/@electric-sql/pglite node scripts/fixtures/studio-reports-sql.mjs
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test --config playwright.studio.config.ts
```

The harness accepts no database connection URL and creates only in-memory databases. Browser fixtures exercise real UI components using synthetic data; they do not replace authenticated staging acceptance against the deployed database and storage integrations.

Graphify's existing graph was used for dependency tracing and then checked against current source. It was not rebuilt; graph metadata still reflects the earlier source snapshot.
