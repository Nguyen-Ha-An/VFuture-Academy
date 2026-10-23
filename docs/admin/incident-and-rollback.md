# Incident and course rollback

Use this runbook when published content is unsafe, incorrect, inaccessible, or exposes assessment material. Name an incident commander, record timestamps in UTC, and preserve correlation IDs and audit evidence.

## Contain and assess

1. Stop new enrollment or remove affected links at the application/deployment layer if the impact is ongoing.
2. Identify the course ID, bad version ID/number, affected branches, first known bad time, and learner-impact window.
3. Check `/studio/audit`, application error reports, exam/submission state, and the immutable version checksums. Do not paste answer keys, tokens, or personal data into the incident channel.
4. Decide whether to roll back the application, course content, database, or a combination. Database PITR is a last resort; use [backup verification](backups.md) before an emergency.

## Restore an immutable course version

1. List versions with `GET /api/v1/studio/courses/<course-id>/versions` and select the last known-good checksum.
2. Call `POST /api/v1/studio/courses/<course-id>/versions/<version>/restore`. This replaces the editable draft; it does not mutate the old version or silently move enrollments.
3. Preview and publish-validate the restored draft in both locales.
4. Complete the normal publishing checklist and publish. The restored content becomes a new immutable version.
5. Verify the catalog, learner-safe render, and `course.restore` plus `course.publish` audit entries.

## Decide whether to migrate enrollments

New enrollments use the newly published good version. Existing enrollments remain pinned by design. Do not run a blanket `UPDATE enrollments`: progress, activity state, quiz attempts, exam attempts, submissions, grades, and completions are version-bound.

Segment affected enrollments into:

- **Not started:** no version-bound learner records. These may be repointed in a reviewed, idempotent transaction.
- **Started:** keep pinned unless every item/block/question ID is compatible and a tested migration maps all dependent state.
- **Exam/submission in progress or completed:** keep pinned and handle individually; never move grading snapshots between versions.

Before an approved migration, pause learner writes, restore production data to a non-production project, test the exact migration there, compare row counts, and take a fresh recovery point. In production, first run a read-only count grouped by `course_version_id` and `status`; have a second operator verify the source/target UUIDs and expected count. Update only the approved cohort in one transaction, require the affected-row count to match, write an incident-specific audit record, then resume traffic and verify sample learners. Roll back the transaction on any mismatch.

## Apply database migrations in canonical order

The runner applies the current checkout's `.sql` files in lexical filename order and records them in `public.schema_migrations`. This Academy extraction retains 45 unchanged historical migration files, excludes the eight Competition-only migrations, and adds the forward `20261023120729_preserve_shared_content_destinations.sql` correction. Gaps in the original numeric sequence are intentional; inspect the actual checkout's files rather than infer ledger state from numbering. For a historical checkout, compare the files present in that checkout with the deployed ledger. Preserve existing migration files and add a new forward migration for a schema correction; numbering alone does not establish that an older application remains compatible.

Before an application rollback, compare the deployed migration ledger with the target commit. Prefer a forward-compatible application rollback; never reverse schema changes ad hoc. If the older application cannot run against the deployed schema, restore the tested recovery point in accordance with [backup verification](backups.md) and record every migration ID in the incident timeline.

## Keep runtime media origins deployment-scoped

The content engine accepts explicitly listed media hosts and, for portable content validation, Supabase hosts ending in `.supabase.co` or `.supabase.in`. The deployed CSP and Next image optimizer deliberately narrow that rule: they allow only the exact Supabase project host configured by `NEXT_PUBLIC_SUPABASE_URL`, plus the engine's explicit media-host list. They never emit a Supabase wildcard.

Treat content that references a different Supabase project as non-renderable in this deployment even if schema validation accepts it. Rehost the asset in the configured project or add a reviewed explicit host to the engine allowlist; then deploy the matching CSP/image configuration before publishing the content.

## Closeout

Confirm monitoring is stable, notify affected users without exposing private data, document the final scope and recovery point, and create follow-up work for root cause and prevention.
