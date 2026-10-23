-- Operational setup, intentionally outside the app migration ledger. Installed
-- only by configure-exam-sweep.ts after verifying the production target.
create schema if not exists vfuture_ops;
revoke all on schema vfuture_ops from public, anon, authenticated, service_role;

create table if not exists vfuture_ops.exam_sweep_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);
alter table vfuture_ops.exam_sweep_requests enable row level security;
revoke all on vfuture_ops.exam_sweep_requests from public, anon, authenticated, service_role;

create or replace function vfuture_ops.enqueue_exam_sweep(force_check boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential text;
  request_id bigint;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(732719, 1) then return null; end if;

  -- Retain only this job's history. No learner data or credentials are logged.
  delete from vfuture_ops.exam_sweep_requests where requested_at < now() - interval '1 day';
  delete from cron.job_run_details
    where jobid in (select jobid from cron.job where jobname = 'vfuture-exam-sweep')
      and end_time < now() - interval '7 days';

  -- pg_net is asynchronous. Avoid a second call while an earlier one is live.
  if exists (
    select 1 from vfuture_ops.exam_sweep_requests request
    where request.requested_at > now() - interval '150 seconds'
      and not exists (select 1 from net._http_response response where response.id = request.request_id)
  ) then return null; end if;

  -- The app's existing 30-second grace window remains authoritative. Idle ticks
  -- do not wake the app or send an HTTP request.
  if not force_check and not exists (
    select 1 from public.exam_attempts
    where status = 'in_progress' and deadline_at < now() - interval '30 seconds'
  ) then return null; end if;

  select decrypted_secret into credential from vault.decrypted_secrets
    where name = 'vfuture_exam_sweep_cron_secret';
  if credential is null or length(credential) = 0 then
    raise exception 'Exam sweep credential is not configured in Vault';
  end if;

  request_id := net.http_post(
    url := '__ACADEMY_EXAM_SWEEP_URL__',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || credential),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  insert into vfuture_ops.exam_sweep_requests(request_id) values (request_id);
  return request_id;
end;
$$;
revoke all on function vfuture_ops.enqueue_exam_sweep(boolean) from public, anon, authenticated, service_role;
