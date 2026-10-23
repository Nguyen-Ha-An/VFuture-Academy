-- Public profile projection and durable handle-change throttling.

create view public.public_profiles
with (security_invoker = true)
as
select
  p.id,
  p.handle,
  p.display_name,
  p.avatar_url,
  b.name as branch_name
from public.profiles p
left join public.branches b on b.id = p.branch_id
where p.profile_public is true;

revoke all on public.public_profiles from public;
grant select on public.public_profiles to anon, authenticated, service_role;

create table public.profile_handle_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  changed_at timestamptz not null default now()
);

create index profile_handle_changes_user_changed_at
  on public.profile_handle_changes (user_id, changed_at desc);

alter table public.profile_handle_changes enable row level security;
revoke all on public.profile_handle_changes from anon, authenticated;

create or replace function public.profile_change_handle(
  p_user_id uuid,
  p_handle text,
  p_now timestamptz
)
returns table (
  id uuid,
  handle text,
  profile_public boolean,
  outcome text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile public.profiles%rowtype;
  change_count integer;
begin
  if p_handle !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    raise exception 'INVALID_HANDLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('profile-handle:' || p_user_id::text, 0));

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*)::integer into change_count
  from public.profile_handle_changes as change
  where change.user_id = p_user_id
    and change.changed_at >= p_now - interval '24 hours';

  if change_count >= 3 then
    return query select current_profile.id, current_profile.handle, current_profile.profile_public, 'HANDLE_RATE_LIMITED'::text;
    return;
  end if;

  insert into public.profile_handle_changes (user_id, changed_at)
  values (p_user_id, p_now);

  if current_profile.handle is not distinct from p_handle then
    return query select current_profile.id, current_profile.handle, current_profile.profile_public, 'UNCHANGED'::text;
    return;
  end if;

  begin
    update public.profiles as profile
    set handle = p_handle,
        updated_at = p_now
    where profile.id = p_user_id
    returning profile.* into current_profile;
  exception
    when unique_violation then
      return query select current_profile.id, current_profile.handle, current_profile.profile_public, 'HANDLE_TAKEN'::text;
      return;
  end;

  return query select current_profile.id, current_profile.handle, current_profile.profile_public, 'CHANGED'::text;
end;
$$;

revoke all on function public.profile_change_handle(uuid, text, timestamptz) from public;
revoke all on function public.profile_change_handle(uuid, text, timestamptz) from anon, authenticated;
grant execute on function public.profile_change_handle(uuid, text, timestamptz) to service_role;
