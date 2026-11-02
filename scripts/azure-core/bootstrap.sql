-- Fresh Azure database only. These NOLOGIN roles match preserved application ACLs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role academy_authenticator nologin noinherit;
grant authenticated, service_role to academy_authenticator;
create schema academy_identity;
create schema academy_private;
create schema auth;
revoke all on schema academy_identity, academy_private, auth from public;
grant usage on schema public, auth to authenticated, service_role;
grant usage on schema academy_private to authenticated, service_role;
create table academy_identity.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table academy_identity.users enable row level security;
-- Keep auth helper names so RLS expressions and RPC definitions retain semantics.
create function auth.uid() returns uuid language sql stable set search_path='' as $$
  select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid;
$$;
create function auth.role() returns text language sql stable set search_path='' as $$
  select current_setting('request.jwt.claims',true)::jsonb->>'role';
$$;
grant execute on function auth.uid(),auth.role() to authenticated,service_role;
create function academy_private.authorize_request() returns void language plpgsql security definer set search_path='' as $$
declare c jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; now_seconds numeric:=extract(epoch from clock_timestamp());
begin
  if c is null or c->>'iss' is distinct from 'academy-server' or c->>'aud' is distinct from 'academy-data'
    or c->>'role' not in ('authenticated','service_role') or c->>'role' is null
    or (c->>'exp')::numeric<=now_seconds or (c->>'iat')::numeric>now_seconds+5
    or (c->>'exp')::numeric-(c->>'iat')::numeric>60 or c->>'exp' is null or c->>'iat' is null then
    raise insufficient_privilege using message='Invalid application token';
  end if;
  if c->>'role'='authenticated' and not exists(select 1 from academy_identity.users where id=auth.uid()) then
    raise insufficient_privilege using message='Unknown application identity';
  end if;
end $$;
revoke all on function academy_private.authorize_request() from public;
grant execute on function academy_private.authorize_request() to authenticated,service_role;
-- Verified metadata mirror, not a fake Storage backend. Only service RPCs write it.
create table academy_private.storage_objects (
  bucket_id text not null,
  name text not null,
  metadata jsonb not null,
  observed_at timestamptz not null default now(),
  primary key(bucket_id,name)
);
create table academy_private.storage_inventory_receipts (
  singleton boolean primary key default true check(singleton),
  reconciled_at timestamptz not null,
  object_count bigint not null,
  inventory_sha256 text not null check(inventory_sha256 ~ '^[a-f0-9]{64}$')
);
alter table academy_private.storage_objects enable row level security;
alter table academy_private.storage_inventory_receipts enable row level security;
-- Mimic Supabase's baseline table ACLs. Later explicit revokes remain authoritative.
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage,select on sequences to authenticated,service_role;
create table academy_private.migration_state (
  singleton boolean primary key default true check(singleton),
  state text not null default 'prepared' check(state in ('prepared','imported')),
  schema_sha256 text,
  imported_at timestamptz
);
insert into academy_private.migration_state(singleton) values(true);
alter table academy_private.migration_state enable row level security;
