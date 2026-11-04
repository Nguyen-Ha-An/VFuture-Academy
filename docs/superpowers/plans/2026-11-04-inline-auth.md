# Academy Inline Authentication Implementation Plan

> Execute task-by-task with test-driven development and the repository verification policy.

**Goal:** Restore the user-requested normal login/signup/reset forms on Academy and send the Google popup directly to Google.

**Approved scope:** The user explicitly requests the old inline credentials UI, normal signup, no password popup or external redirect, Google OAuth in a popup, and an optional Microsoft staff entry. Azure database and existing account IDs/permissions remain in use. This implements the direction already requested in the conversation.

**Architecture:** Use Microsoft Entra Native Authentication through a same-origin server adapter. The server keeps provider tokens and continuation state private, reuses the existing browser-bound one-use transaction RPCs, and issues the current HttpOnly server session. Native credentials never enter OAuth popup code. The exact Google issuer-acceleration hint is `Google`, verified against the live tenant; `google` errors and the deployed `google.com` showed the chooser.

**Constraints:** No additional paid Azure resources, no credential logs or browser token storage, no email-based account linking, no tenant/issuer/audience weakening, no Microsoft staff provisioning. Preserve cancellation and popup correlation for social login. Preserve the independently reviewed billing commit; PR5 has now been merged into main.

## Task 1: Social routing
- [x] Add failing tests for canonical Google routing and inline password entry.
- [x] Normalize the Google hint to its observed tenant value; route password/recovery deep links to inline Academy pages.
- [x] Run focused identity route and OIDC tests.

## Task 2: Inline native authentication
- [x] Add failing transport/controller tests for login, signup code verification, password reset, provider errors, expiry and replay.
- [x] Add a pinned-tenant Native Authentication transport with bounded requests and explicit allowed protocol paths.
- [x] Bind encrypted continuation state to HttpOnly browser proof and one-use database transactions. Validate same-origin JSON, payload size and rate limits before provider operations.
- [x] Verify tokens on the server and reuse existing mapping/session/refresh contracts. Never accept browser-supplied tokens.
- [x] Restore inline bilingual form fields, signup/login links, code/password-reset steps and accessible pending/error states. Popups are social-only.
- [x] Run focused UI, endpoint and security regression checks.

## Task 3: Tenant configuration and release
- [x] Inspect the existing application native-auth configuration; enable the required capability using a supported configuration change, preserving existing permissions and redirect URIs.
- [ ] Validate actual native login/signup/reset using disposable customer data; preserve existing user credentials. Verify refresh and direct Google popup behavior.
- [ ] Finish docs/tests, run pinned Graphify refresh/check, review its tracked manifest, and run the complete local verifier.
- [ ] Commit/push the isolated change and deploy the checked source, then verify hosted form, denial paths, native sessions and Google popup. Report any missing hosted evidence explicitly.

## Observed release evidence

- Native/public-client flags and basic `openid profile email offline_access` consent were configured on the existing customer application. Existing permissions and Web redirect URIs were preserved.
- A disposable directory customer completed actual password authentication and public-client refresh; ID token signature/issuer/tenant/audience/OID were verified, and refresh retained the identity. The successful probe was removed with directory absence confirmed. No existing user password was read or changed.
- Independent security review found and verified fixes for real MFA introspection/suberror handling, reset `not_started`, account-existence response metadata and simultaneous-tab proof interference.
- Google console now reports Academy branding verified and shown to users. This changes visible branding, not the CIAM federation callback hostname.
- Existing local-token expiry/refresh remains the recovery revocation boundary for other devices; this change does not implement immediate account-wide Academy session revocation.
- Hosted signup/recovery OTP completion and inbox placement must not be inferred from unit tests or the directory-only password probe.
