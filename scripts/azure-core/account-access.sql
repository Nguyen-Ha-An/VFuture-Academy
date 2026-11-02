-- Executed after identity lifecycle columns exist. Existing 60-second API tokens
-- must lose database access immediately after disable/delete/account suspension.
create or replace function academy_private.authorize_request()
returns void language plpgsql security definer set search_path='' as $$
declare c jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; now_seconds numeric:=extract(epoch from clock_timestamp());
begin
  if c is null or c->>'iss' is distinct from 'academy-server' or c->>'aud' is distinct from 'academy-data'
    or c->>'role' not in ('authenticated','service_role') or c->>'role' is null
    or (c->>'exp')::numeric<=now_seconds or (c->>'iat')::numeric>now_seconds+5
    or (c->>'exp')::numeric-(c->>'iat')::numeric>60 or c->>'exp' is null or c->>'iat' is null then
    raise insufficient_privilege using message='Invalid application token';
  end if;
  if c->>'role'='authenticated' and not exists(
    select 1 from academy_identity.users u join public.user_accounts a on a.user_id=u.id
      where u.id=auth.uid() and u.disabled_at is null and u.deleted_at is null and a.status='active'
  ) then raise insufficient_privilege using message='Inactive application identity'; end if;
end $$;
revoke all on function academy_private.authorize_request() from public,anon;
grant execute on function academy_private.authorize_request() to authenticated,service_role;
