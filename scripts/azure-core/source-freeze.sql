-- SOURCE SUPABASE ONLY: czmahomzcspvtddvqium. Keep Storage's service API available.
-- Apply once immediately before the final snapshot. No user rows are deleted.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create schema if not exists academy_cutover;
revoke all on schema academy_cutover from public, anon, authenticated, service_role;
create table if not exists academy_cutover.state (
  singleton boolean primary key default true check(singleton),
  active boolean not null,
  frozen_at timestamptz not null
);
create table if not exists academy_cutover.schedulers (
  jobid bigint primary key,
  was_active boolean not null
);
insert into academy_cutover.schedulers select jobid,active from cron.job where jobname='vfuture-exam-sweep' on conflict do nothing;
insert into academy_cutover.state values(true,true,now()) on conflict(singleton) do update set active=true,frozen_at=excluded.frozen_at;
create or replace function academy_cutover.reject_legacy_writes() returns trigger
language plpgsql security definer set search_path=pg_catalog,academy_cutover as $$
begin
  -- session_user survives SECURITY DEFINER RPCs, unlike current_user/JWT role.
  if session_user<>'postgres' and exists(select 1 from academy_cutover.state where active) then
    raise exception using errcode='25006',message='Academy has moved to Azure. Reload the website and sign in again.';
  end if;
  return null;
end $$;
revoke all on function academy_cutover.reject_legacy_writes() from public;
do $$ declare t record; j record; begin
  for t in select schemaname,tablename from pg_tables
    where schemaname='public' or (schemaname='auth' and tablename in ('users','sessions','refresh_tokens'))
  loop
    execute format('drop trigger if exists academy_azure_read_only on %I.%I',t.schemaname,t.tablename);
    execute format('create trigger academy_azure_read_only before insert or update or delete or truncate on %I.%I for each statement execute function academy_cutover.reject_legacy_writes()',t.schemaname,t.tablename);
  end loop;
  -- Recheck after acquiring the DDL locks, not only before this transaction.
  if exists(select 1 from public.exam_attempts where status='in_progress') then raise exception 'An exam is active; postpone cutover'; end if;
  if exists(select 1 from public.media_upload_reservations where released_at is null and retain_until>now())
    or exists(select 1 from public.notebook_artifacts where status='pending' and created_at>now()-interval '125 minutes') then
    raise exception 'An upload grant is still live; postpone cutover';
  end if;
  for j in select jobid from cron.job where jobname='vfuture-exam-sweep' loop perform cron.alter_job(j.jobid,active:=false); end loop;
end $$;
-- Old Supabase-user JWTs cannot bypass Azure file authorization. Server-side
-- service credentials and already-authorized native signed transfers still work.
drop policy if exists academy_azure_storage_guard on storage.objects;
create policy academy_azure_storage_guard on storage.objects as restrictive for all to anon,authenticated using(false) with check(false);
commit;
