-- Apply after the transformed Academy migrations. These functions are server-only;
-- never grant them to authenticated, anon, or the PostgREST authenticator role.
create schema if not exists academy_identity;
revoke all on schema academy_identity from public, anon, authenticated;
alter table academy_identity.users add column if not exists disabled_at timestamptz;
alter table academy_identity.users add column if not exists deleted_at timestamptz;

create table if not exists academy_identity.mappings (
  issuer text not null,
  subject uuid not null,
  user_id uuid not null references academy_identity.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
create table if not exists academy_identity.login_transactions (
  state_hash text primary key check(length(state_hash)=64),
  browser_hash text not null check(length(browser_hash)=64),
  payload jsonb not null,
  expires_at timestamptz not null
);
create table if not exists academy_identity.sessions (
  token_hash text primary key check(length(token_hash)=64),
  user_id uuid not null references academy_identity.users(id) on delete cascade,
  provider text not null default 'external-id' check(provider in ('external-id','microsoft')),
  issuer text not null,
  subject uuid not null,
  oidc_subject text not null,
  expires_at timestamptz not null,
  token_expires_at timestamptz not null,
  refresh_ciphertext text,
  version integer not null default 1,
  refresh_lease text,
  refresh_lease_until timestamptz
);
-- Permit replay over an earlier local identity rehearsal without retaining unfenced columns.
alter table academy_identity.sessions add column if not exists provider text not null default 'external-id' check(provider in ('external-id','microsoft'));
alter table academy_identity.sessions add column if not exists refresh_lease text;
alter table academy_identity.sessions add column if not exists refresh_lease_until timestamptz;
create index if not exists identity_sessions_expiry on academy_identity.sessions(expires_at);
create index if not exists identity_sessions_user on academy_identity.sessions(user_id);

create or replace function public.academy_identity_start_login(p_state_hash text,p_browser_hash text,p_payload jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  delete from academy_identity.login_transactions where expires_at < now();
  delete from academy_identity.sessions where expires_at < now();
  insert into academy_identity.login_transactions values(p_state_hash,p_browser_hash,p_payload,now()+interval '10 minutes');
end; $$;
create or replace function public.academy_identity_consume_login(p_state_hash text,p_browser_hash text)
returns jsonb language sql security definer set search_path = pg_catalog, academy_identity as $$
  delete from academy_identity.login_transactions where state_hash=p_state_hash and browser_hash=p_browser_hash and expires_at > now() returning payload;
$$;

create or replace function public.academy_identity_find_user(p_issuer text,p_subject uuid)
returns jsonb language sql security definer set search_path = pg_catalog, academy_identity as $$
  select to_jsonb(u) from academy_identity.users u join academy_identity.mappings m on m.user_id=u.id where m.issuer=p_issuer and m.subject=p_subject and u.disabled_at is null and u.deleted_at is null;
$$;
-- Internal Microsoft login never provisions an account. Staff eligibility is
-- evaluated through the current authorization model, including branch suspension.
create or replace function public.academy_identity_find_staff(p_issuer text,p_subject uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, academy_identity as $$
  select to_jsonb(u) from academy_identity.users u join academy_identity.mappings m on m.user_id=u.id
  where m.issuer=p_issuer and m.subject=p_subject and u.disabled_at is null and u.deleted_at is null
    and p_issuer='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0'
    and exists (
      select 1 from public.role_assignments a join public.role_definitions d on d.id=a.role_definition_id
      cross join lateral unnest(d.permissions) p(permission)
      where a.user_id=u.id and public.authorization_has_permission(u.id,p.permission,d.scope_kind,a.branch_id)
    );
$$;
-- Called only after signed member/UPN validation and mapped active staff lookup.
-- Category persists after staff permissions change; it never grants permission.
create or replace function public.academy_identity_initialize_staff_profile(p_issuer text,p_subject uuid,p_display_name text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare identity_user jsonb; target uuid;
begin
  identity_user:=public.academy_identity_find_staff(p_issuer,p_subject);
  if identity_user is null then raise exception 'Staff identity required'; end if;
  target:=(identity_user->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('profile-handle:'||target::text,0));
  begin
    update public.profiles set handle_category='VFU',
      handle=case when handle is null then null else 'VFU-'||substring(handle from 5) end
      where id=target and handle_category='STU';
  exception when unique_violation then
    update public.profiles set handle_category='VFU',handle=null
      where id=target and handle_category='STU';
  end;
  return public.profile_initialize(target,p_display_name);
end; $$;
revoke all on function public.academy_identity_initialize_staff_profile(text,uuid,text) from public,anon,authenticated;
grant execute on function public.academy_identity_initialize_staff_profile(text,uuid,text) to service_role;
create or replace function public.academy_identity_resolve_user(p_issuer text,p_subject uuid,p_email text,p_email_verified boolean,p_display_name text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
declare result jsonb; new_id uuid; safe_email text;
begin
  -- Serialize first registration for an object across concurrent callback requests.
  perform pg_advisory_xact_lock(hashtextextended(p_issuer || ':' || p_subject::text,0));
  select public.academy_identity_find_user(p_issuer,p_subject) into result;
  if result is not null then
    perform public.profile_initialize((result->>'id')::uuid,p_display_name);
    return result;
  end if;
  if exists(select 1 from academy_identity.mappings where issuer=p_issuer and subject=p_subject) then raise exception 'Identity is disabled'; end if;
  safe_email := case when p_email_verified then nullif(lower(trim(p_email)),'') else null end;
  -- Never link by email. A migrated identity must have an operator-reviewed mapping.
  if safe_email is not null and exists(select 1 from academy_identity.users where lower(email)=safe_email) then
    raise exception using errcode='28000',message='Identity mapping required';
  end if;
  new_id := gen_random_uuid();
  insert into academy_identity.users(id,email,raw_user_meta_data)
    values(new_id,safe_email,jsonb_build_object('full_name',coalesce(nullif(left(p_display_name,160),''),'')));
  insert into academy_identity.mappings(issuer,subject,user_id) values(p_issuer,p_subject,new_id);
  return public.academy_identity_find_user(p_issuer,p_subject);
end; $$;
drop function if exists public.academy_identity_create_session(text,uuid,text,uuid,text,timestamptz,timestamptz,text);
create or replace function public.academy_identity_create_session(p_hash text,p_user_id uuid,p_issuer text,p_subject uuid,p_oidc_subject text,p_expires_at timestamptz,p_token_expires_at timestamptz,p_refresh_ciphertext text,p_provider text default 'external-id')
returns void language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  if p_expires_at > now()+interval '24 hours 1 minute' or p_expires_at <= now() or p_token_expires_at <= now() then raise exception 'Invalid session lifetime'; end if;
  if not exists(select 1 from academy_identity.mappings m join academy_identity.users u on u.id=m.user_id where m.issuer=p_issuer and m.subject=p_subject and m.user_id=p_user_id and u.disabled_at is null and u.deleted_at is null) then raise exception 'Identity mapping missing'; end if;
  if p_provider='microsoft' and public.academy_identity_find_staff(p_issuer,p_subject) is null then raise exception 'Staff identity required'; end if;
  insert into academy_identity.sessions(token_hash,user_id,provider,issuer,subject,oidc_subject,expires_at,token_expires_at,refresh_ciphertext)
    values(p_hash,p_user_id,p_provider,p_issuer,p_subject,p_oidc_subject,p_expires_at,p_token_expires_at,p_refresh_ciphertext);
end; $$;
create or replace function public.academy_identity_read_session(p_hash text)
returns jsonb language sql security definer set search_path = pg_catalog, academy_identity as $$
  select to_jsonb(s)||jsonb_build_object('user',to_jsonb(u)) from academy_identity.sessions s join academy_identity.users u on u.id=s.user_id
  where s.token_hash=p_hash and s.expires_at>now() and u.disabled_at is null and u.deleted_at is null
    and (s.provider<>'microsoft' or public.academy_identity_find_staff(s.issuer,s.subject) is not null);
$$;
-- A refresh grant has exactly one active owner across application instances.
create or replace function public.academy_identity_claim_refresh(p_hash text,p_version integer,p_lease text)
returns boolean language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  if p_lease !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid refresh lease'; end if;
  update academy_identity.sessions set refresh_lease=p_lease,refresh_lease_until=clock_timestamp()+interval '45 seconds'
    where token_hash=p_hash and version=p_version and expires_at>clock_timestamp()
      and (refresh_lease_until is null or refresh_lease_until<=clock_timestamp());
  return found;
end; $$;
create or replace function public.academy_identity_release_refresh(p_hash text,p_version integer,p_lease text)
returns boolean language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  update academy_identity.sessions set refresh_lease=null,refresh_lease_until=null
    where token_hash=p_hash and version=p_version and refresh_lease=p_lease and refresh_lease_until>clock_timestamp();
  return found;
end; $$;
create or replace function public.academy_identity_revoke_refresh(p_hash text,p_version integer,p_lease text)
returns boolean language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  delete from academy_identity.sessions
    where token_hash=p_hash and version=p_version and refresh_lease=p_lease and refresh_lease_until>clock_timestamp();
  return found;
end; $$;
-- Remove the earlier unfenced overload if rehearsing an in-place schema update.
drop function if exists public.academy_identity_rotate_session(text,integer,timestamptz,text);
create or replace function public.academy_identity_rotate_session(p_hash text,p_version integer,p_token_expires_at timestamptz,p_refresh_ciphertext text,p_lease text)
returns boolean language plpgsql security definer set search_path = pg_catalog, academy_identity as $$
begin
  if p_token_expires_at<=clock_timestamp() then raise exception 'Invalid token lifetime'; end if;
  update academy_identity.sessions set token_expires_at=p_token_expires_at,refresh_ciphertext=p_refresh_ciphertext,version=version+1,refresh_lease=null,refresh_lease_until=null
    where token_hash=p_hash and version=p_version and expires_at>clock_timestamp()
      and refresh_lease=p_lease and refresh_lease_until>clock_timestamp();
  return found;
end; $$;
drop function if exists public.academy_identity_delete_session(text,integer);
create or replace function public.academy_identity_delete_session(p_hash text,p_version integer default null)
returns text language sql security definer set search_path = pg_catalog, academy_identity as $$
  delete from academy_identity.sessions where token_hash=p_hash and (p_version is null or version=p_version) returning provider;
$$;

revoke all on all tables in schema academy_identity from public,anon,authenticated;
-- Explicit signatures make it impossible to accidentally grant an unrelated public function.
revoke all on function public.academy_identity_start_login(text,text,jsonb),public.academy_identity_consume_login(text,text),public.academy_identity_find_user(text,uuid),public.academy_identity_find_staff(text,uuid),public.academy_identity_resolve_user(text,uuid,text,boolean,text),public.academy_identity_create_session(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text),public.academy_identity_read_session(text),public.academy_identity_rotate_session(text,integer,timestamptz,text,text),public.academy_identity_claim_refresh(text,integer,text),public.academy_identity_release_refresh(text,integer,text),public.academy_identity_revoke_refresh(text,integer,text),public.academy_identity_delete_session(text,integer) from public,anon,authenticated;
grant execute on function public.academy_identity_start_login(text,text,jsonb),public.academy_identity_consume_login(text,text),public.academy_identity_find_user(text,uuid),public.academy_identity_find_staff(text,uuid),public.academy_identity_resolve_user(text,uuid,text,boolean,text),public.academy_identity_create_session(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text),public.academy_identity_read_session(text),public.academy_identity_rotate_session(text,integer,timestamptz,text,text),public.academy_identity_claim_refresh(text,integer,text),public.academy_identity_release_refresh(text,integer,text),public.academy_identity_revoke_refresh(text,integer,text),public.academy_identity_delete_session(text,integer) to service_role;
