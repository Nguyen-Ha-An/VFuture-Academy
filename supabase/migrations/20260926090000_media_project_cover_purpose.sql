-- Allow learner-uploaded project covers as their own server-assigned purpose.
-- Adding the check not valid avoids a full scan under the table lock; the
-- separate validate step then checks existing rows under a lighter lock.
alter table public.media_assets
  drop constraint media_assets_purpose_check;

alter table public.media_assets
  add constraint media_assets_purpose_check
  check (purpose in ('content', 'avatar', 'submission', 'project_cover')) not valid;

alter table public.media_assets
  validate constraint media_assets_purpose_check;
