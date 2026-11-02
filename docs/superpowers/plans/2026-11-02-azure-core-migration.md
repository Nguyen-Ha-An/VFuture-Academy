# Academy Azure core migration

Owner-approved on 2026-11-02. Status: implementation in progress; no cutover evidence yet.

## Accepted decisions

- PostgreSQL 17 on Azure Flexible Server B1ms, Southeast Asia, 32 GB, seven-day backups, no HA. Subscription `a5981803-fc8a-4ad2-85d7-bd20ec6b9320`, tenant `157419c9-2de9-45e7-a6f9-91546dbef629`.
- Portal inspection confirmed unused monthly 750 B1ms hours, 32 GB data and 32 GB backup benefits, expiring 2027-10-23. Benefit attribution must be checked after deployment. Separate grant balance remains unverified.
- Preserve query/RPC compatibility with authenticated PostgREST on Container Apps Consumption: 0–1 replicas, 0.25 vCPU, 0.5 GiB, eight DB connections, private PostgreSQL connectivity.
- Entra External ID customer tenant; branded Microsoft-hosted login domain. Google is the primary public login for everyone, with email/password retained as backup. Per the owner's subsequent correction, the optional Microsoft button uses a separate, single-tenant workforce app and admits only prelinked, currently authorized internal staff. Personal and other organizations' Microsoft accounts are denied. Preserve stable Academy UUIDs; never link by unverified email. Reauthentication and password reset for migrated password accounts.
- Azure Communication Services branded transactional email and authenticated Entra email extension. Move scheduler away from pg_net/Vault, exactly one five-minute exam sweep owner.
- Keep Next.js/Vercel and private Supabase Storage. Separate data, identity and storage clients. No Central/Competition changes or Supabase deletion.
- USD35/month is a soft operating target. Actual alerts at 50/80/100 percent and forecast 100 percent; availability takes priority. Count credits as spending. No automatic upgrades. Notify an@vfuturelabs.org. Include outside-RG identity charges.
- Prefer federation/managed identities. Necessary expiring application credentials use longest service/tenant-policy-permitted lifetime; record expiry without committing secrets. Session/token expiry is unchanged by this request.
- Rehearse data/schema/identity/storage migration; local tests plus Graphify refresh/check/full verify before review-ready. Pilot load acceptance:25 concurrent learners, autosave p95<=2s, submit p95<=5s, no loss/duplicates/isolation failures. Hosted verification separate. Rollback after Azure writes requires reconciliation.
- Commit/push on codex branch and open PR. GitHub Actions deployment-only. No credential/data exports in Git.

## Implementation ownership and contracts

1. Identity: owns src/lib/identity, auth routes/components, src/lib/auth.ts, middleware auth behavior and identity tests. Export provider selector (`ACADEMY_BACKEND=azure`), verified server user and application session APIs. Coordinate exact contracts with database implementer. Keep legacy provider default until cutover gates pass.
2. Database: owns src/lib/supabase/server.ts and service-client.ts, new database/storage adapters, Azure-specific migration/export/rehearsal scripts, affected storage services and tests. PostgreSQL/PostgREST clients remain source-compatible; auth facade delegates to identity module. Keep Supabase-only storage credentials distinct from Azure data credentials.
3. Infrastructure: owns infra/azure-core, deployment/preflight scripts and tests. Do not modify legacy VM deployment. Provide deterministic Bicep and configuration validation with no secret output. Include cost and email/timer handlers.
4. Coordinator: integration, environment/package coordination, MCP integration, docs, full verification, cloud setup and GitHub delivery.

## Initial inspection

Live source project czmahomzcspvtddvqium: PostgreSQL 17.11, two users/profiles, one storage object, approximately17MB. These are observations, not migration completion receipts.

Ruling: work on the requested codex branch in the existing clean checkout because only approximately1GB disk is available; avoid duplicating dependencies. Preserve all unrelated files.
Ruling: production provider stays Supabase until the complete Azure acceptance passes; this preserves an operable rollback while implementation is underway.

## Interface review

| Tasks | Shared boundary | Resolution |
|---|---|---|
| Identity / database | User resolution and auth facade | Agree explicit exports before editing shared clients; identity module must not import shared supabaseUser recursively |
| Database / infrastructure | API JWT issuer, credentials and DB roles | Server-only signing, short-lived tokens, fixed role allowlist; no anonymous data role |
| Identity / infrastructure | Entra email extension and OIDC | Exact tenant/issuer/audience validation; deployment configuration is separate from source |
| All / verification | Graphify and local checks | Coordinator refreshes only after agents finish edits; no agent commits independently |

## Progress

- Branch created: codex/academy-azure-core.
- Source/infrastructure implementation pending.
- Hosted provisioning, rehearsal, cutover and billing attribution pending.

## Provisioning observations, 2026-11-02

- Created `rg-vfuture-academy-core-sg` and the Academy customer tenant `f3152aa5-61de-40fd-bb76-780b9fbe5428` (`vfutureacademy.onmicrosoft.com`). The owner completed its MFA enrollment.
- Created and linked `AcademySignIn` to the Academy web application. Google configuration is being completed under separate owner authorization; public login has not been cut over.
- Base deployment succeeded: private PostgreSQL 17/B1ms/32 GB/seven-day backups, Container Apps environment, Key Vault, ACS, private operational Storage and the monthly USD35 notification budget. The database has public network access disabled.
- The billing profile showed USD2,000 sponsorship credit remaining, expiring 2027-10-20. The distinct free-service meters expire 2027-10-23. New resource billing attribution remains a separate check.
- Dedicated sending domain is `notify.academy.vfuturelabs.org`. The owner approved its verification, SPF, two DKIM and strict DMARC records; existing website and root-mail DNS were preserved. Azure verified ownership, SPF and both DKIM records.
- Two necessary confidential web credentials use the accepted 24-month Entra lifetime and expire in November 2028. Values remain outside Git; only expiry metadata belongs in deployment evidence.
- Source snapshot rehearsal passed locally. The first private hosted import failed; read-only diagnostics are required before retry. No source write freeze or application cutover has occurred.
- The current verification and deployment evidence lives under ignored `build/azure-core/`; private snapshots and credentials must never be committed. An implementation commit is not proof of a completed production migration.
