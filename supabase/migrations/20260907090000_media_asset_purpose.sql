-- Classify stored assets without moving or deleting any existing object.
-- The purpose is server assigned and keeps learner uploads out of authoring inventories.
alter table public.media_assets
  add column purpose text;

update public.media_assets
set purpose = 'submission'
where bucket = 'submissions';

update public.media_assets asset
set purpose = 'avatar'
where asset.purpose is null
  and (
    asset.path ~ ('^' || asset.owner_id::text || '/avatar/')
    or exists (
      select 1
      from public.profiles profile
      where profile.id = asset.owner_id
        and profile.avatar_url is not null
        and (
          profile.avatar_url like '%' || asset.id
          or profile.avatar_url like '%' || asset.id || '?%'
        )
    )
  );

update public.media_assets
set purpose = 'content'
where purpose is null;

alter table public.media_assets
  alter column purpose set default 'content',
  alter column purpose set not null;

alter table public.media_assets
  add constraint media_assets_purpose_check
  check (purpose in ('content', 'avatar', 'submission'));

create index media_assets_authoring_inventory_idx
  on public.media_assets (ownership_kind, owner_branch_id, created_at desc)
  where purpose = 'content';
