# Academy Files pilot

The pilot adds one reviewed PDF to one current Central-owned, globally published Academy resource. Academy stores the attachment reference and the upload operation in `public.resource_files_pilot`. Existing resource attachments still use their existing media or external URL handling.

## Activation

1. Verify the resource ID, its live global publication, and the approved PDF of up to 4 MiB. The [Vercel request cap](https://vercel.com/docs/functions/limitations#request-body-size) leaves room for the multipart envelope at this file size.
2. Apply and verify `supabase/migrations/20261128000000_academy_files_pilot.sql` with the [private forward-57 lane](../../infra/azure-core/README.md#academy-files-pilot-migration). Verify PostgREST visibility for `service_role` and confirm that browser roles have no table access.
3. Provision an Academy Files credential with `files:write`, `releases:draft`, and `releases:read` through the authorized Files operator. Store it as the server-side `ACADEMY_FILES_SERVICE_TOKEN` in the target deployment. Use distinct staging and production credentials.
4. Deploy with `ACADEMY_FILES_PILOT_RESOURCE_ID` set to the approved ID and `ACADEMY_FILES_PILOT_WRITES_ENABLED=false`. In the pilot Studio resource, verify the status panel. Confirm a legacy public resource still opens its existing files.
5. Enable `ACADEMY_FILES_PILOT_WRITES_ENABLED=true` for the pilot. In Central Studio, open the approved published resource as a staff account with resource edit and publish permissions. Use **Submit PDF for review**. On a timeout, submit the same PDF using the same filename. The database keeps the operation ID and completed IDs for retries.
6. In Files, publish the submitted release under the Academy namespace and version `v1` using an Academy-scoped publisher grant. In Studio, use **Check Files release status**. Academy retains the canonical release-page URL as its journal checkpoint. It verifies the published release ID, primary PDF ID, digest, and size with the anonymous Files endpoint. A valid `shareUrl` opens the PDF at `https://files.vfuturelabs.org/api/f/academy-<resourceId>/v1`. For responses without `shareUrl`, Academy uses the exact canonical `openUrl`. A supplied short link that fails verification hides the PDF link.
7. Open the Academy public resource signed out, follow **Open PDF** directly to `files.vfuturelabs.org`, and compare both the public version and the downloaded SHA-256 with the approved source. Verify another resource and a branch-scoped resource have no pilot upload path.

## Withdrawal and rollback

Withdraw the release in Files first so its canonical link stops serving bytes. Use **Check Files release status** in Academy Studio to clear the stored link. Academy also checks live Files visibility before displaying the link and hides it if the public release or Academy resource is unavailable.

Set `ACADEMY_FILES_PILOT_WRITES_ENABLED=false` to stop new integration writes. Keep `ACADEMY_FILES_PILOT_RESOURCE_ID` and the database table for existing reads. Preserve the operation journal and verify both the existing legacy path and an already published Files link before promoting a rollback deployment. If a verified upload is interrupted before draft submission, resume with the original PDF while the resource is still approved; record any unresolved private file ID for operator review.
