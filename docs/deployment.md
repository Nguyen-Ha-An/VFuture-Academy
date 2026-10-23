# Academy deployment

The repository is self-contained source prepared for an independent deployment. New Supabase Database/Auth projects, user-data transfer and production cutover are deferred by the user. No Central deployment, project ID, token, Auth grant or historical green test is inherited evidence for this deployment.

1. Run `npm ci`, configure a local nonproduction Academy environment, `npm run graphify:refresh`, and the complete `npm run verify:local` gate. Save the tested commit SHA and actual local results. Use `--webpack` only as the documented lower-cache build option; use `--full` for the full student browser/visual matrix.
2. When infrastructure creation is authorized, provision Academy's own Supabase project and use the unchanged Academy migration ledger. Complete [database ownership/cutover](database-ownership.md), exact Auth Site URL/callback/recovery and provider settings, private Storage buckets, initial account grants, rate-limit cleanup and scheduler verification. Do not mutate the old Central backend.
3. Create a separate Vercel project for this repository. Configure `NEXT_PUBLIC_APP_URL`, cross-product origins, Academy Supabase keys, rate-limit identity and all enabled features from `.env.example`. Set the GitHub production-environment secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` to this Academy project. Keep database credentials out of GitHub deployment jobs.
4. Merge the locally validated revision to `main`. The sole GitHub workflow deploys that exact SHA through Vercel; it runs no tests or migrations. `vercel.json` disables automatic Vercel Git deployments of main. Use the same local gate before manual workflow dispatch.
5. Verify deployed SHA/READY state and root/catalog, Auth, learner progress/assessment, Studio publication/review, Grading/Admin, private media, MCP and notebooks. The isolated harnesses do not prove live OAuth, email delivery, Storage policy or hosted capacity readiness.

Keep `STUDIO_MCP_ENABLED=0` until [the independent MCP setup](studio/mcp.md) and live access/revocation gates pass. Notebook runtime requires its own origin. Retain draft policy publication gates until the owner approves product-specific copy and an effective date.

Rollback selects a known-good compatible Git/Vercel revision. Schema migrations remain forward-only and are a separate authorized operation; do not rewrite their SQL or delete production data for a rollback. Review [incident procedure](admin/incident-and-rollback.md) before an incident action.
