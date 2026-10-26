# Academy managed production deployment

Infrastructure was created independently on 2026-10-26. This records initialization and the remaining release gates; it does not establish a completed production launch. No historical Central backend or user data was moved.

| Resource | Academy target |
| --- | --- |
| Supabase organization | `ycbdckpnrmtrocxcawcn` |
| Supabase project | `czmahomzcspvtddvqium`, Singapore |
| Supabase API | `https://czmahomzcspvtddvqium.supabase.co` |
| Vercel team | `team_NHnG60zwaEFcFVctjZktpN0q` (`an-nguyen-ha`) |
| Vercel project | `prj_ZhPnvDYEX8cO4LL7xf1KWDZfJ0wZ` (`vfuture-academy-production`) |
| Canonical application origin | `https://academy.vfuturelabs.org` |
| Additional trusted Auth origin | `https://vfuture-academy-production.vercel.app` |

## Database initialization

All 49 checked-in SQL files were applied in lexical filename order to the new project, with each SQL file and its exact filename receipt committed in one transaction. The canonical ledger is `public.schema_migrations`, not Supabase CLI's separate migration history. Initial application used the connected SQL API because no direct database connection was available. Future migrations use `npm run migrate` with an explicitly checked Academy `SUPABASE_DB_URL`; never renumber or rewrite applied files.

The ledger matches the 49 source filenames through `20261026145220_restrict_internal_function_execution.sql`. The initial live schema has 64 public tables, all with RLS enabled, 16 role definitions, and the three inherited schools. The schema bootstrap contains no real users, course catalog or learning history. Production fixture seeding is not part of initialization.

The final migration removes hosted Supabase's explicit `anon`/`authenticated` grants from internal SECURITY DEFINER functions. Live ACL inspection confirms that the three progress mutation RPCs permit only trusted service access, and no public SECURITY DEFINER function is executable by `anon`. The two authenticated read helpers, `can_access_course` and `current_branch_id`, remain available for existing RLS policies. Security advisors retain their two intentional authenticated-helper warnings and 40 informational RLS-without-policy notices for tables whose clients are denied direct access. Do not add permissive policies to silence those notices. See [Supabase function advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

`node scripts/verify-function-execution-grants.mjs` reproduces hosted explicit default grants in disposable PostgreSQL. It checks client RPC denial, retained service RPC access, authenticated read helpers and Auth/profile/account bootstrap. It is included in `verify:local`.

## Managed Supabase configuration

Use only this project's URL, public key and server-only service key. Leave self-hosted `SUPABASE_GATEWAY_KEY` and transfer-grant configuration unset. Set `NEXT_PUBLIC_APP_URL` to the canonical origin and `AUTH_REDIRECT_ORIGINS` to the additional trusted origin above. Keep `STUDIO_MCP_ENABLED=0` until its separate OAuth/access acceptance passes, and leave notebook runtime unset until a separate runtime origin exists.

All four Storage buckets must exist and remain private: `media`, `submissions`, `certificates`, `notebooks`. The SQL ledger creates `certificates` and `notebooks`; create missing `media` and `submissions` through the Storage API, then inspect their actual visibility and exercise signed upload/download paths. Do not use the staging-only storage setup script as a production escape hatch.

Set Auth Site URL to `https://academy.vfuturelabs.org`. Allow the exact trusted callback/recovery paths on both application origins, including callback query parameters used by `?next=`. The browser sends `/auth/callback?next=...` for signup, email resend, Google and Microsoft, and `/auth/recovery` for password reset. Both OAuth provider applications must register the exact Supabase redirect URI `https://czmahomzcspvtddvqium.supabase.co/auth/v1/callback`. The application callback then exchanges the PKCE code and preserves only allowed internal destinations. See [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

Google and Microsoft integration configuration is being finalized. Provider registration, enabled Supabase settings and a successful consent/session walkthrough must be checked separately before recording either login method as operational.

- Google: create an Academy Web application OAuth client. Configure its authorized application origins and the Supabase redirect URI above. Limit consent to `openid`, email and basic profile scopes; place the client ID and secret in this project's Supabase Google provider settings. See [Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
- Microsoft: create an Academy Entra application supporting accounts in any organizational directory and personal Microsoft accounts. Register the Supabase redirect URI above as a Web redirect, and set Supabase's Azure tenant URL to `https://login.microsoftonline.com/common`. Add optional ID-token claims `email` and `xms_edov`, plus access-token claim `xms_edov`, so Supabase can determine whether the email domain is verified. Set its client ID and client-secret value in the Supabase Azure provider. The browser requests provider `azure` with the `email` scope for basic identity; do not add mailbox, calendar, files or other Microsoft Graph permissions. Record secret expiry privately for rotation. See [Microsoft setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure).

Production SMTP remains deferred. Configure a production SMTP provider and sender identity before opening signup/recovery to learners. Supabase's default email service is restricted to organization-team recipients and is unsuitable for production delivery. See [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Remaining release gates

- Complete canonical-domain DNS/TLS, deploy the locally validated revision, and confirm its exact SHA and Vercel READY state.
- Finalize and inspect Google and Microsoft provider configuration; verify each consent flow, real login, cancellation, onboarding and host-bound session redirect. Production SMTP remains a separate deferred gate; verify actual email delivery, confirmation and recovery after it is configured.
- Select the authorized first administrator. Create or authenticate that person's real Auth account, then run `npm run grant-role -- <selected-email> central_admin` using the Academy service environment. The reviewed bootstrap also confirms the account email. Routine grants belong in Admin; never run `seed:dev` to create production administrator fixtures.
- Confirm all private buckets and test permitted media uploads/downloads and denied cross-user access. Publish owner-approved content through Studio and review; the fresh catalog is intentionally empty.
- Configure one owner for `rate_limit_gc()` every five minutes. After the application endpoint is live, use `scripts/configure-exam-sweep.ts apply` with the exact production ref/database, app origin and independent `CRON_SECRET`; inspect successful HTTP/application responses before considering the exam scheduler active. GitHub Actions performs deployment only, with no database credentials, migrations or checks.
- Run `npm run graphify:refresh`, `npm run graphify:check`, and the complete `npm run verify:local` after final edits. Record actual results and tested SHA. Local harnesses do not establish hosted Auth, Storage, database capacity or deployment correctness.
- Complete the live root/catalog, learner progress/assessment, Studio review/publication, Grading/Admin and private-media acceptance in [the deployment runbook](../deployment.md), plus backup/restore and incident procedures. Retain `PUBLIC_POLICIES_APPROVED=false` until owner approval and a real effective date exist; adding Google and Microsoft to the privacy draft does not approve publication.

Secrets belong in Vercel or private operator storage. GitHub's production environment receives only the Vercel deployment credentials for the new project. Keep database URLs, keys, Auth tokens and account records out of tracked documentation and CI output.
