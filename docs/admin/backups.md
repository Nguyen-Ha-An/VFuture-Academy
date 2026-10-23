# Supabase backup and PITR verification

This is an operator procedure, not an automated production action. The repository does not contain Supabase credentials and the verification script refuses to run without an explicit restored-database URL.

Supabase documents daily backup retention and PITR in [Database Backups](https://supabase.com/docs/guides/platform/backups). Use [Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project) for drills so the source project remains available.

## Schedule and evidence

- Run a restore drill before launch, after material schema/storage changes, and on the organization's recurring recovery schedule.
- Record the source project reference, operator, UTC restore target, earliest/latest available recovery point, expected recovery point objective (RPO), start/end times, and ticket link.
- Capture an approved baseline of critical table counts near the chosen restore target. Never put connection strings in the ticket, terminal history, or process arguments.

## Restore drill

1. In the source project's **Database → Backups**, verify a current daily backup and the configured PITR window. A project with no recent writes can show an older latest WAL point even though its state is current.
2. Select **Restore to a New Project** and choose a point inside the displayed recovery window. Double-check the timezone and project name before confirming.
3. Wait for the new project to become healthy. Do not point application DNS, environment variables, webhooks, or scheduled jobs at it.
4. Obtain a short-lived direct/session Postgres connection URL for the restored project. Write it directly from the approved secret manager into a protected temporary file; do not type it on a command line. Then run:

   ```bash
   npm run verify:backup -- --url-file "/secure/path/restored-db-url.txt"
   ```

5. Save the JSON output securely. Compare every public-table count with the approved baseline, allowing only differences explained by the selected recovery time.
6. Verify `schema_migrations`, foreign-key checks, one published course/version/render, one enrollment/progress chain, one exam attempt, one submission/grade, and one audit entry with read-only queries.
7. Verify non-database surfaces separately. Supabase's new-project restore copies database schema/data, roles, Auth users, encryption roots, and enabled database extensions. It does not copy Storage objects/settings, Edge Functions, Auth settings/API keys, Realtime settings, extension/project settings, or read replicas. Immediately disable copied extensions that can perform external work (for example, `pg_net`, `pg_cron`, or wrappers) until the drill owner approves them.
8. Record pass/fail, discrepancies, measured RPO/RTO, and remediation owners. Securely delete the URL file, revoke its credential, and remove the drill project through the approved retention/change process.

## Emergency restore notes

An in-place restore makes the project inaccessible during restoration. Plan downtime and communications. Non-Realtime replication slots/subscriptions may need to be removed and recreated as described by Supabase. Require incident-commander and second-operator approval before any production restore.
