-- Additive runtime controls. Existing hosted installs retain unlimited starts;
-- self-host bootstrap explicitly sets max_active_exam_attempts = 25.
create table public.academy_runtime_limits (
  singleton boolean primary key default true check (singleton),
  max_active_exam_attempts integer check (max_active_exam_attempts between 1 and 25),
  new_exam_starts_paused boolean not null default false
);
insert into public.academy_runtime_limits(singleton) values (true);
alter table public.academy_runtime_limits enable row level security;
revoke all on table public.academy_runtime_limits from public, anon, authenticated;
grant select, update on table public.academy_runtime_limits to service_role;
create policy academy_runtime_limits_service on public.academy_runtime_limits
  for all to service_role using (true) with check (true);

-- Session/network digests only; no raw cookies, IPs, or identity assertions from
-- clients. Expired windows are removed inside each transaction, and the hard row
-- cap never evicts an active budget (eviction would reset an attacker's quota).
create table public.public_request_buckets (
  key text primary key check (length(key) <= 80),
  started_at timestamptz not null,
  count integer not null check (count >= 0)
);
alter table public.public_request_buckets enable row level security;
revoke all on table public.public_request_buckets from public, anon, authenticated;

create or replace function public.public_rate_limit(p_session text, p_connection text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_time timestamptz;
  keys text[];
  limits integer[];
  bucket_key text;
  issue_session boolean := false;
  idx integer;
  missing integer;
begin
  if p_connection is null or p_connection !~ '^[a-f0-9]{64}$'
    or (p_session is not null and p_session !~ '^[a-f0-9]{64}$') then
    raise exception 'invalid public rate identity' using errcode = '22023';
  end if;
  -- All claims and issuance budgets commit together across every API process.
  perform pg_catalog.pg_advisory_xact_lock(719031, 1);
  bucket_time := pg_catalog.clock_timestamp();
  delete from public.public_request_buckets where started_at <= bucket_time - interval '60 seconds';
  keys := array['global', 'ip:' || p_connection];
  -- A coarse NAT budget includes 25 x 60 requests plus initial cookie traffic.
  limits := array[3600, 1800];
  if p_session is not null then
    keys := array_append(keys, 'session:' || p_session);
    limits := array_append(limits, 60);
  end if;
  for idx in 1..array_length(keys, 1) loop
    if exists (select 1 from public.public_request_buckets b where b.key = keys[idx] and b.count >= limits[idx]) then
      return jsonb_build_object('allowed', false, 'issueSession', false);
    end if;
  end loop;
  if p_session is null then
    issue_session := not exists (
      select 1 from public.public_request_buckets b
      where (b.key = 'mint:global' and b.count >= 128)
        or (b.key = 'mint:' || p_connection and b.count >= 32)
    );
    if issue_session then keys := keys || array['mint:global', 'mint:' || p_connection]; end if;
  end if;
  select count(*)::integer into missing from unnest(keys) k
    where not exists (select 1 from public.public_request_buckets b where b.key = k);
  if (select count(*) from public.public_request_buckets) + missing > 4096 then
    return jsonb_build_object('allowed', false, 'issueSession', false);
  end if;
  foreach bucket_key in array keys loop
    insert into public.public_request_buckets as bucket(key, started_at, count)
      values (bucket_key, bucket_time, 1)
      on conflict (key) do update set count = bucket.count + 1;
  end loop;
  return jsonb_build_object('allowed', true, 'issueSession', issue_session);
end;
$$;
revoke all on function public.public_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.public_rate_limit(text, text) to service_role;

-- Preserve the existing per-learner resume and retake contract; add the global
-- admission check only after resume and attempts-allowed checks have completed.
create or replace function public.exam_start_attempt(
  p_id uuid,
  p_user_id uuid,
  p_course_version_id uuid,
  p_item_id text,
  p_question_set jsonb,
  p_grading_snapshot jsonb,
  p_started_at timestamptz,
  p_deadline_at timestamptz,
  p_attempts_allowed integer
)
returns public.exam_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  admitted public.exam_attempts;
  attempts_used integer;
  capacity integer;
  paused boolean;
begin
  if p_attempts_allowed < 1 then
    raise exception using errcode = 'P3001', message = 'NO_ATTEMPTS';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text || ':' || p_course_version_id::text || ':' || p_item_id, 0
  ));
  select attempt.* into admitted
  from public.exam_attempts as attempt
  where attempt.user_id = p_user_id and attempt.course_version_id = p_course_version_id
    and attempt.item_id = p_item_id and attempt.status = 'in_progress'
  order by attempt.attempt_no limit 1;
  if found then return admitted; end if;
  select count(*)::integer into attempts_used
  from public.exam_attempts as attempt
  where attempt.user_id = p_user_id and attempt.course_version_id = p_course_version_id
    and attempt.item_id = p_item_id;
  if attempts_used >= p_attempts_allowed then
    raise exception using errcode = 'P3001', message = 'NO_ATTEMPTS';
  end if;

  -- This singleton row serializes admission and operator configuration changes
  -- until the enclosing transaction commits the new attempt. No deadline-based
  -- eviction: the existing sweeper/finalizer must transition expired attempts.
  select max_active_exam_attempts, new_exam_starts_paused into capacity, paused
    from public.academy_runtime_limits where singleton = true for update;
  if not found or paused then
    raise exception using errcode = 'P3003', message = 'EXAM_STARTS_PAUSED';
  end if;
  if capacity is not null and (select count(*) from public.exam_attempts where status = 'in_progress') >= capacity then
    raise exception using errcode = 'P3002', message = 'EXAM_CAPACITY';
  end if;
  insert into public.exam_attempts (
    id, user_id, course_version_id, item_id, attempt_no, status, late,
    question_set, grading_snapshot, started_at, deadline_at
  ) values (
    p_id, p_user_id, p_course_version_id, p_item_id, attempts_used + 1,
    'in_progress', false, p_question_set, p_grading_snapshot, p_started_at, p_deadline_at
  ) returning * into admitted;
  return admitted;
end;
$$;
revoke all on function public.exam_start_attempt(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.exam_start_attempt(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz, timestamptz, integer) to service_role;
