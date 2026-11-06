# Simple Entrance and Managed Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved login-only Academy entrance and migrate every profile to its managed `STU-` or authorized `VFU-` handle while preserving old profile links.

**Architecture:** Keep existing Entra sessions, UUIDs and authorization. Put canonical allocation, aliases and category enforcement in PostgreSQL; update the profile lookup and identity resolver to consume that contract. Apply the bounded private Azure forward migration before deploying the compatible application, then verify real provider and route behavior separately.

**Tech Stack:** Next.js 15.5, React 19, TypeScript, PostgreSQL 17, Entra External ID, Azure Container Apps private migration job, Vercel.

**Spec:** [Approved behavior](../specs/2026-11-06-simple-entrance-managed-handles.md).

## Global Constraints

- All ordinary Google and email accounts receive an actual canonical handle beginning `STU-`.
- Only a preapproved, active staff mapping for the approved Microsoft tenant and exact `@vfuturelabs.org` identity receives `VFU-`.
- Preserve existing account UUIDs, school/role assignments and academic records.
- Preserve every previous profile handle as a reserved alias to the same user.
- Retain legal pages, invitation and verification routes, and public profile URLs.
- Historical SQL, import digests and completed forward receipts remain unchanged.
- GitHub Actions remains deployment-only.

## Review Focus

- A Microsoft login with the right suffix but no active approved mapping must be denied rather than upgraded.
- A former canonical handle or alias must remain reserved across concurrent changes and account creation.
- Private, missing and invalid profiles must remain indistinguishable through old aliases and metadata.
- A failed migration or changed plan must leave all handle changes and its ledger uncommitted.
- A signup returning from Google or hosted CIAM must not request the name twice or lose the provider name.

---

### Task 1: Canonical identity and profile contract

**Files:** Create `supabase/migrations/20261106000000_managed_profile_handles.sql`; modify `src/lib/identity/schema.sql`, `src/features/profile/service.ts`, `src/app/u/[handle]/page.tsx`, profile contracts and focused identity/profile tests.

**Interfaces:** PostgreSQL owns category, canonical allocation and permanent aliases. Existing identity resolution returns the same user UUID; profile lookup accepts canonical or historical handle and emits the current canonical handle.

- [ ] Add regression cases for existing Google/email users, authorized Microsoft staff, unmapped/disabled staff, alias preservation, private alias denial and conflicting/concurrent allocation.
- [ ] Run the focused tests and confirm the expected behavior fails before implementation.
- [ ] Implement the migration, identity initializer, guarded handle change and alias-aware profile lookup; preserve role and academic data.
- [ ] Run the focused identity/profile tests plus real disposable PostgreSQL migration/concurrency checks. Require all cases to pass.

### Task 2: Centered entrance and provider details

**Files:** Modify `src/app/(public)/page.tsx`, `src/app/(public)/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/components/AzureAuthPanel.tsx`, `src/features/workspace-ui/auth/AuthMain.tsx`, `next.config.ts`, `src/app/sitemap.ts`; create `src/features/workspace-ui/auth/EntranceShell.tsx` and `entrance.css`; update focused browser and auth tests.

**Interfaces:** Existing auth endpoints/session and safe return-path policy remain authoritative. Canonical handles are returned by Task 1, never synthesized only in display copy.

- [ ] Add route/UI regressions for signed-out root, authenticated redirect, Google/email signup and recovery, staff Microsoft, retained legal/invite/verification/profile routes and safe return paths.
- [ ] Implement the approved centered VFuture form, provider-name defaults and removal of redundant entrance navigation.
- [ ] Read the current Academy CIAM user-flow attribute settings, change only redundant display-name collection and read it back. Keep raw provider responses private.
- [ ] Run auth/route tests and browser checks at mobile/desktop widths, keyboard and both shipped themes; exercise loading/error/recovery states.

### Task 3: Private Azure forward release and hosted acceptance

**Files:** Add a bounded handle-forward executor and focused transport/migration tests under `scripts/azure-core` and `infra/azure-core`; update only the fixed package/action allowlists and [release runbook](../../deployment/simple-entrance-handles-release.md).

**Interfaces:** Consume exactly the migration and identity suffix from Task 1, preserve historical import/Canvas receipts, emit a row-free read-only plan and immutable apply receipt. The existing target/TLS/private-network guards and clean commit/tree apply checks remain enforced.

- [ ] Pin/review the actual latest main and live starting schema, including migration 53, before setting the forward baseline.
- [ ] Test exact file/hash admission, stale or changed plan rejection, bad baseline rejection, rollback, idempotent replay and no credential/row leakage; implement the minimum fixed action path.
- [ ] Finish all source, test, configuration and documentation edits. Run `npm run graphify:refresh`, `npm run graphify:check`, then `npm run verify:local`; resolve failures and review the tracked manifest diff. Refresh again after source changes.
- [ ] Commit the tested integrated tree with the reviewed Graphify manifest. Keep generated Graphify, keys, snapshots and operational artifacts ignored.
- [ ] Follow the release runbook to obtain/review a private read-only plan, package from that exact clean commit and apply transactionally; retrieve and inspect the immutable receipt and fresh post-migration plan.
- [ ] Deploy the compatible revision, observe Vercel Ready with its actual source SHA, and run the runbook's live login, canonical/alias/privacy and retained-route probes. Record results and remaining limits without replacing hosted evidence with local passes.
