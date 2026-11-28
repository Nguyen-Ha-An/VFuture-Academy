# Academy private assignment attachment pilot

This workflow uses the existing learner assignment upload, retry, remove and open controls. Select one approved standalone assignment that accepts PDFs up to 4 MiB. The pilot requires a known enrollment school scope. The existing provider handles uploads outside the pilot’s course, assignment, file type and size.

## Prepare with writes disabled

1. Apply the private assignment journal migration through Academy’s approved migration lane. Verify the table and completion function through the Academy server role. Confirm signed-out and browser roles have no direct access.
2. Provision a dedicated `academyassignment` service identity in the matching Files environment with `assignments:read` and `assignments:write`. Set the server-held bearer in Academy as `ACADEMY_FILES_ASSIGNMENT_TOKEN`. Configure a separate random 32-byte hex proof key in Files as `FILES_ACADEMY_ASSIGNMENT_PROOF_KEY` and in Academy as `ACADEMY_FILES_ASSIGNMENT_PROOF_KEY`.
3. Configure the chosen course and standalone assignment as `ACADEMY_FILES_ASSIGNMENT_COURSE_ID` and `ACADEMY_FILES_ASSIGNMENT_ITEM_ID`. Keep `ACADEMY_FILES_ASSIGNMENT_WRITES_ENABLED=false` on the production reader release. Keep the normal learner and grader authorization paths in place.
4. Verify with approved fixtures on an isolated deployment. From the learner UI, submit a PDF, interrupt a transfer response and retry, and replace the attachment in a revision. Verify the old and new bytes, the source relationships and the one-result retry. Check a learner, assigned grader, signed-out user, unrelated learner and wrong-school grader against the exact URLs. Repeat after turning writes off in the isolated deployment and verify both Files-backed and legacy reads.
5. Record the exact dual-reader rollback revision, scope, test checksums and unresolved operations before production activation. Keep the service identity, proof key, journal and dual readers available when pausing writes. Use only a dual-reader build for rollback after it has produced Files-backed references.

The app journals the operation and SHA-256 before transfer. Files stores immutable bytes and uses the operation ID for idempotency. Academy attaches its stable media ID and the returned Files ID in one database transaction. Removing a draft attachment only removes the selection. Earlier submitted attempts retain their file IDs. The Files assignment scope does not publish these attachments.

Inspect expired, cancelled or interrupted journal operations in the Academy server lane. A Files response lost before checkpoint can be recovered with the original operation and bytes while the reservation is active. Retain unresolved operations and reconcile them with the Files operator before cleanup. Physical deletion and migration of existing submissions are separate rollout steps.

## Local checks

Run the Academy local verifier, which includes the assignment journal SQL contract and the learner Chromium harness. The harness drives the actual attachment controls with fixture responses. The route tests run the learner client and Academy handlers together with fixture storage and authorization. The Files repository separately tests record proofs, cross-service denial, replay and the publication boundary.
