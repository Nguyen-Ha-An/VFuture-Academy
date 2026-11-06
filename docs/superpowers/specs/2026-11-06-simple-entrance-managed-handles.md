# Simple Academy entrance and managed profile handles

Status: user-approved behavior, 6 November 2026. This specification authorizes implementation and full live rollout after the repository and hosted release gates. It is not a record that deployment or data migration has completed.

## Entrance

The signed-out root is a simple, centered VFuture Academy login. Keep Google and email/password signup, sign-in and recovery, with Microsoft for approved internal staff. Remove the public discovery entrance and redundant navigation around login. Retain legal pages, invitation and verification routes, and public profile URLs. Existing authenticated users continue to their authorized Academy workspace.

Google signup uses the verified provider's name automatically. Email signup collects the necessary name once in Academy. Hide the redundant CIAM display-name collection in the hosted user flow rather than asking for the same details twice. Do not remove identity verification or change the provider/session trust boundary.

## Canonical handles

All ordinary Google and email accounts receive an actual canonical handle beginning `STU-`. Only a preapproved, active staff mapping for the approved Microsoft tenant and exact `@vfuturelabs.org` identity receives `VFU-`. An email suffix, unverified email, provider display name, selected login button or client request cannot grant this category. Preserve existing account UUIDs, school/role assignments and academic records.

Migrate all existing profiles to their managed category. Preserve every previous profile handle as a reserved alias to the same user, including handles changed later, so old links keep working and cannot be reassigned. Aliases obey current profile visibility: a private profile remains unavailable through both canonical and historical URLs. Public metadata and new links use the canonical handle.

Handle allocation and changes are atomic and collision-safe. The database enforces category and uniqueness; UI validation alone is insufficient. Concurrent account creation or handle changes cannot allocate the same canonical handle or steal another user's alias. Categories remain tied to the authorized account record when a person later uses another sign-in method.

## Release boundaries

Azure PostgreSQL/PostgREST remains the production database, Entra the identity provider and Vercel the web host. Historical SQL, import digests and completed forward receipts remain unchanged. The migration is `supabase/migrations/20261106000000_managed_profile_handles.sql`, followed by the reviewed `src/lib/identity/schema.sql` update on an existing Azure database. Fresh schema builds include the migration before the identity suffix.

Use the Academy private migration job with an encrypted package, exact target validation, read-only plan, clean committed source provenance for apply, transactional recheck and immutable receipt. Do not rerun the fresh-target importer or apply the generic filename-only migration command to production. Keep PostgreSQL private. GitHub Actions remains deployment-only.

Acceptance requires both the full local Graphify/verifier sequence and independent hosted database, deployment, login and canonical/alias route checks. Local passes do not prove live provider configuration, real signup/recovery delivery or hosted capacity. Preserve the existing MCP, notebook, billing and unrelated product release boundaries.
