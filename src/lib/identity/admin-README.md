# Azure account administration

Administration > Members keeps **Invite member** as the primary Google onboarding action. The existing invitation must be accepted by the signed-in owner of a verified email; it never links an existing Academy identity by email. The email backup creation form is separate and explicitly describes that distinction.

The Azure controls appear only in Central scope with `member.manage` and configured server credentials. The server and SQL independently require `admin.access` and `member.manage` in Central scope. Branch managers retain existing scoped profile/membership workflows, without directory account authority.

## Credentials and customer boundary

- Existing `ENTRA_TENANT_ID` must equal `f3152aa5-61de-40fd-bb76-780b9fbe5428`.
- `ENTRA_ADMIN_CLIENT_ID` and `ENTRA_ADMIN_CLIENT_SECRET` belong to a dedicated confidential application in that customer tenant. The web-login/workforce credentials are never a fallback.
- Graph **application** permissions, with tenant-admin consent: `User.ReadWrite.All`, `User.Read.All`, `User.EnableDisableAccount.All`, `User.RevokeSessions.All`.
- Assign **no Entra administrator directory role** to this service principal. Do not elevate it to manage privileged tenant accounts.
- Provider targets come only from the stored Academy UUID → pinned customer issuer/object mapping. HTTP inputs cannot supply a Graph object ID, tenant, issuer, password or arbitrary provider properties. Workforce issuer mappings are never sent to Graph.
- Before mutations of an existing provider account, require a customer creation type with a local-email/federated identity, then inspect transitive directory memberships. Any directory role, incomplete membership response or failed inspection denies mutation. Large paginated memberships fail closed pending operator investigation.

These restrictions protect tenant administrators and corporate Microsoft accounts even when an Academy operator supplies their Academy UUID. An Academy-only or workforce-only account may be disabled/deleted locally; its corporate identity is untouched.

## User-visible operations

- **Create email backup account:** reserves a disabled Academy UUID and unique email, creates a disabled customer local account, records its explicit object mapping, enables the provider and finally enables Academy access. Generated initial passwords are discarded and never returned or logged. The local-account password profile sets `forceChangePasswordNextSignIn=false`; onboarding uses password reset rather than a temporary password handed to the user. The owner uses the hosted email **Forgot password** flow. This does not add a Google identity to the account.
- **Edit:** profile display name is synchronized with the mapped customer identity. Login email and provider identities are not mutable through this surface.
- **Disable:** suspends the Academy account and deletes all application sessions atomically before provider session revocation and `accountEnabled=false`.
- **Enable:** enables the provider first, then the Academy account. Deleted login tombstones cannot be enabled.
- **Delete login:** requires the exact `DELETE LOGIN` confirmation. Suspends/revokes locally, revokes provider sessions, deletes only the mapped customer directory object, and records a tombstone. Academic UUID, profiles, coursework, roles, mappings and audit history remain. Directory deletion is subject to Microsoft's provider retention, not a promise of immediate permanent erasure.

An administrator cannot disable/delete their own login. The authorization guard and existing final-admin trigger prevent removal of the last active built-in Central Admin. Disabled/deleted identities cannot resolve or create/read sessions. The database request guard separately rejects already-issued application data tokens for these accounts.

## Recovery and audit

`academy_identity.admin_account_operations` is a private, durable journal. `academy_admin_account(uuid,text,jsonb)` is a service-role-only RPC for `read`, `begin`, `record`, `complete`, and `fail`. One pending operation per account and a two-minute fenced lease prevent concurrent conflicting mutations. Request IDs cannot be reused for a different target/payload. Local blocks remain on remote failure; the profile shows **Retry pending change**. Another currently authorized Central manager can resume the recorded operation.

Creation uses an operation-derived customer UPN/mail nickname. Following an ambiguous remote response, retry reads that exact operation identity and checks its markers; it never adopts a directory user based on email equality. A provider-only orphan remains disabled until journal recovery maps it. Never manually delete an uncertain orphan as compensation.

Audit actions `user.account.{create|edit|disable|enable|delete}.{requested|retry_required|completed}` include the operation ID, not passwords or provider tokens. A retry completes the same operation. Completed operation replays do not create duplicate completion audit records.

## Local and hosted acceptance

Focused tests: `tests/lib/azure-admin-accounts.test.ts`, `tests/scripts/azure-admin-schema.test.ts`, `tests/features/admin/account-controls.test.tsx`. SQL tests require `PGLITE_MODULE_PATH`; skipped tests are not evidence. Full Graphify/local verification is coordinated after all migration edits.

Before enabling production controls, rehearse with a designated disposable customer account: Graph consent, creation with deterministic UPN, hosted password reset, rename, disable/re-enable, failed-call retry, revoke/delete and preserved academic history. Check Google sign-up and invitation acceptance using actual verified-email claim evidence; do not loosen verification because a claim is absent. No existing production user should be deleted during implementation or verification.

Provider session revocation can take minutes and does not revoke a Google session at Google. Academy's immediate local denial is independent of that delay. Local tests establish neither hosted directory behavior nor live Google claim availability.

## Primary sources checked 2026-11-02

- [Create a customer account, example 3](https://learn.microsoft.com/en-us/graph/api/user-post-users?view=graph-rest-1.0): customer local identity and password-profile contract.
- [Update user](https://learn.microsoft.com/en-us/graph/api/user-update?view=graph-rest-1.0): property-specific permission requirements.
- [Delete user](https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0): deletion permission and provider retention.
- [Revoke sign-in sessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0): application permission and delayed revocation semantics.
- [Transitive memberships](https://learn.microsoft.com/en-us/graph/api/user-list-transitivememberof?view=graph-rest-1.0): `User.Read.All` and limited directory-object information.
