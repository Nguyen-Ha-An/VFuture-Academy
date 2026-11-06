-- Canonical handles are service-managed categories plus an editable lowercase suffix.
-- Categories identify the approved identity mapping; they never grant permissions.
alter table public.profiles drop constraint if exists profiles_handle_check;
alter table public.profiles add column handle_category text not null default 'STU'
  check (handle_category in ('STU','VFU'));
create table public.profile_handle_aliases (
  handle text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index profile_handle_aliases_casefold on public.profile_handle_aliases(lower(handle));
alter table public.profile_handle_aliases enable row level security;
revoke all on public.profile_handle_aliases from public, anon, authenticated;
grant all on public.profile_handle_aliases to service_role;

create or replace function public.profile_initialize(p_user_id uuid,p_display_name text default '')
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare profile public.profiles%rowtype; candidate text; suffix text; base text; attempt integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('profile-handle:'||p_user_id::text,0));
  select * into profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if profile.handle is null then
    -- PostgreSQL normalizes Vietnamese combining accents before ASCII slugging.
    base:=trim(both '-' from regexp_replace(regexp_replace(lower(translate(
      normalize(coalesce(nullif(trim(p_display_name),''),profile.display_name),NFD),'đĐ','dD')),
      '[̀-ͯ]','','g'),'[^a-z0-9]+','-','g'));
    base:=left(base,25);
    if length(base)<3 then base:=left(replace(gen_random_uuid()::text,'-',''),16); end if;
    loop
      suffix:=case when attempt=0 then base else base||'-'||left(replace(gen_random_uuid()::text,'-',''),6) end;
      candidate:=profile.handle_category||'-'||suffix;
      perform pg_advisory_xact_lock(hashtextextended('profile-handle-value:'||lower(candidate),0));
      exit when not exists(select 1 from public.profiles where lower(handle)=lower(candidate))
        and not exists(select 1 from public.profile_handle_aliases where lower(handle)=lower(candidate));
      attempt:=attempt+1;
    end loop;
    update public.profiles set handle=candidate where id=p_user_id;
  else candidate:=profile.handle; end if;
  update public.profiles set display_name=left(trim(p_display_name),160)
    where id=p_user_id and trim(display_name)='' and nullif(trim(p_display_name),'') is not null;
  return candidate;
end; $$;
revoke all on function public.profile_initialize(uuid,text) from public,anon,authenticated;
grant execute on function public.profile_initialize(uuid,text) to service_role;

-- Preserve every existing shared URL, including private profiles, without exposing it.
insert into public.profile_handle_aliases(handle,user_id)
  select handle,id from public.profiles where handle is not null;
-- Explicit operator-reviewed workforce mappings are stable membership evidence.
-- Dynamic SQL keeps the same migration usable on the retained Supabase schema.
do $$ begin
  if to_regclass('academy_identity.mappings') is not null then
    execute $q$update public.profiles p set handle_category='VFU' where exists(
      select 1 from academy_identity.mappings m join academy_identity.users u on u.id=m.user_id where m.user_id=p.id
        and m.issuer='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0'
        and u.disabled_at is null and u.deleted_at is null and u.email ~* '^[^@\s]+@vfuturelabs\.org$'
        and exists(select 1 from public.role_assignments a join public.role_definitions d on d.id=a.role_definition_id
          cross join lateral unnest(d.permissions) permission(value)
          where a.user_id=u.id and public.authorization_has_permission(u.id,permission.value,d.scope_kind,a.branch_id)))$q$;
  end if;
end $$;
do $$ declare row record; candidate text; begin
  for row in select id,handle,handle_category,display_name from public.profiles order by id loop
    candidate:=case when row.handle is null then null else row.handle_category||'-'||row.handle end;
    if candidate is not null and not exists(select 1 from public.profile_handle_aliases a
      where lower(a.handle)=lower(candidate) and a.user_id<>row.id) then
      update public.profiles set handle=candidate where id=row.id;
    else
      update public.profiles set handle=null where id=row.id;
      perform public.profile_initialize(row.id,row.display_name);
    end if;
  end loop;
end $$;
create unique index profiles_handle_casefold on public.profiles(lower(handle));
alter table public.profiles add constraint profiles_handle_check
  check(handle ~ '^(STU|VFU)-[a-z0-9][a-z0-9_-]{2,31}$' and split_part(handle,'-',1)=handle_category);

create or replace function public.profile_guard_handle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare reserved_handle text;
begin
  if tg_op='UPDATE' and (new.handle is distinct from old.handle or new.handle_category is distinct from old.handle_category)
    and (auth.uid() is not null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') in ('anon','authenticated')) then
    raise exception 'PROFILE_HANDLE_SERVICE_ONLY' using errcode='42501';
  end if;
  -- Lock both the released URL and destination. A competing rename must wait
  -- until the old URL's alias is visible, before checking its reservation.
  for reserved_handle in select distinct value from unnest(array[
    lower(new.handle),case when tg_op='UPDATE' then lower(old.handle) else null end
  ]) value where value is not null order by value loop
    perform pg_advisory_xact_lock(hashtextextended('profile-handle-value:'||reserved_handle,0));
  end loop;
  if new.handle is not null then
    if exists(select 1 from public.profile_handle_aliases a where lower(a.handle)=lower(new.handle) and a.user_id<>new.id)
      or exists(select 1 from public.profiles p where lower(p.handle)=lower(new.handle) and p.id<>new.id) then
      raise unique_violation using message='Handle is reserved';
    end if;
  end if;
  if tg_op='UPDATE' and old.handle is not null and old.handle is distinct from new.handle then
    insert into public.profile_handle_aliases(handle,user_id) values(old.handle,old.id) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.profile_guard_handle() from public,anon,authenticated;
create trigger profiles_guard_handle before insert or update on public.profiles
for each row execute function public.profile_guard_handle();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profiles(id,display_name,avatar_url) values(new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),new.raw_user_meta_data->>'avatar_url');
  perform public.profile_initialize(new.id,coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $$;

create or replace view public.public_profile_handles with (security_invoker=true) as
select p.id,p.handle,p.display_name,p.avatar_url,p.branch_name,p.handle as lookup_handle from public.public_profiles p
union all
select p.id,p.handle,p.display_name,p.avatar_url,p.branch_name,a.handle as lookup_handle
from public.profile_handle_aliases a join public.public_profiles p on p.id=a.user_id
where a.handle<>p.handle;
revoke all on public.public_profile_handles from public,anon,authenticated;
-- Only the public-profile service can resolve aliases. Its source view enforces visibility.
grant select on public.public_profile_handles to service_role;

create or replace function public.profile_change_handle(p_user_id uuid,p_handle text,p_now timestamptz)
returns table(id uuid,handle text,profile_public boolean,outcome text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_profile public.profiles%rowtype; change_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('profile-handle:'||p_user_id::text,0));
  select p.* into current_profile from public.profiles p where p.id=p_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
  if p_handle !~ '^(STU|VFU)-[a-z0-9][a-z0-9_-]{2,31}$'
    or split_part(p_handle,'-',1)<>current_profile.handle_category then
    raise exception 'INVALID_HANDLE' using errcode='22023';
  end if;
  select count(*)::integer into change_count from public.profile_handle_changes c
    where c.user_id=p_user_id and c.changed_at>=p_now-interval '24 hours';
  if change_count>=3 then
    return query select current_profile.id,current_profile.handle,current_profile.profile_public,'HANDLE_RATE_LIMITED'::text; return;
  end if;
  insert into public.profile_handle_changes(user_id,changed_at) values(p_user_id,p_now);
  if current_profile.handle is not distinct from p_handle then
    return query select current_profile.id,current_profile.handle,current_profile.profile_public,'UNCHANGED'::text; return;
  end if;
  begin
    update public.profiles p set handle=p_handle,updated_at=p_now where p.id=p_user_id returning p.* into current_profile;
  exception when unique_violation then
    return query select current_profile.id,current_profile.handle,current_profile.profile_public,'HANDLE_TAKEN'::text; return;
  end;
  return query select current_profile.id,current_profile.handle,current_profile.profile_public,'CHANGED'::text;
end; $$;
revoke all on function public.profile_change_handle(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.profile_change_handle(uuid,text,timestamptz) to service_role;
