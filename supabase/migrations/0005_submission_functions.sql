-- Atomic server-only mutations for assignment submissions and grading.

create table public.learner_upload_rate_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.learner_upload_rate_limits enable row level security;

create table public.assignment_submission_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null references public.course_versions(id) on delete cascade,
  item_id text not null,
  block_id text not null default '',
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_version_id, item_id, block_id)
);

alter table public.assignment_submission_rate_limits enable row level security;

alter table public.grades
  add column passed boolean not null default false;

alter table public.media_assets
  add column item_id text;

create index media_assets_orphan_submissions
  on public.media_assets (created_at, item_id)
  where bucket = 'submissions';

create or replace function public.claim_learner_upload(
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resulting_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid upload rate limit' using errcode = '22023';
  end if;

  insert into public.learner_upload_rate_limits as bucket (
    user_id, window_started_at, request_count, updated_at
  ) values (
    p_user_id, p_now, 1, p_now
  )
  on conflict (user_id) do update
  set window_started_at = case
        when bucket.window_started_at <= p_now - make_interval(secs => p_window_seconds) then p_now
        else bucket.window_started_at
      end,
      request_count = case
        when bucket.window_started_at <= p_now - make_interval(secs => p_window_seconds) then 1
        else bucket.request_count + 1
      end,
      updated_at = p_now
  returning request_count into resulting_count;

  return resulting_count <= p_limit;
end;
$$;

create or replace function public.claim_assignment_submission(
  p_user_id uuid,
  p_course_version_id uuid,
  p_item_id text,
  p_block_id text,
  p_now timestamptz,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resulting_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid submission rate limit' using errcode = '22023';
  end if;

  insert into public.assignment_submission_rate_limits as bucket (
    user_id, course_version_id, item_id, block_id,
    window_started_at, request_count, updated_at
  ) values (
    p_user_id, p_course_version_id, p_item_id, coalesce(p_block_id, ''),
    p_now, 1, p_now
  )
  on conflict (user_id, course_version_id, item_id, block_id) do update
  set window_started_at = case
        when bucket.window_started_at <= p_now - make_interval(secs => p_window_seconds) then p_now
        else bucket.window_started_at
      end,
      request_count = case
        when bucket.window_started_at <= p_now - make_interval(secs => p_window_seconds) then 1
        else bucket.request_count + 1
      end,
      updated_at = p_now
  returning request_count into resulting_count;

  return resulting_count <= p_limit;
end;
$$;

create or replace function public.submit_assignment(
  p_user_id uuid,
  p_course_id text,
  p_course_version_id uuid,
  p_item_id text,
  p_block_id text,
  p_attempt_no integer,
  p_payload jsonb,
  p_submitted_at timestamptz,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_submission public.assignment_submissions%rowtype;
  existing_attempts integer;
begin
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then
    raise exception 'submission files must be an array' using errcode = '22023';
  end if;

  if p_attempt_no < 1 then
    raise exception 'invalid assignment attempt' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_user_id::text, p_course_version_id::text, p_item_id, coalesce(p_block_id, '')),
    0
  ));
  select count(*)
  into existing_attempts
  from public.assignment_submissions
  where user_id = p_user_id
    and course_version_id = p_course_version_id
    and item_id = p_item_id
    and block_id is not distinct from p_block_id;
  if existing_attempts >= 20 or p_attempt_no > 20 then
    raise exception 'ATTEMPT_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.assignment_submissions (
    user_id,
    course_version_id,
    item_id,
    block_id,
    attempt_no,
    payload,
    status,
    submitted_at
  ) values (
    p_user_id,
    p_course_version_id,
    p_item_id,
    p_block_id,
    p_attempt_no,
    p_payload,
    'submitted',
    p_submitted_at
  )
  returning * into new_submission;

  insert into public.submission_files (
    submission_id,
    user_id,
    asset_id,
    name,
    size_bytes,
    mime
  )
  select
    new_submission.id,
    p_user_id,
    file.asset_id,
    file.name,
    file.size_bytes,
    file.mime
  from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as file(
    asset_id text,
    name text,
    size_bytes bigint,
    mime text
  );

  return jsonb_build_object(
    'id', new_submission.id,
    'status', new_submission.status,
    'attempt_no', new_submission.attempt_no
  );
end;
$$;

create or replace function public.grade_assignment_submission(
  p_submission_id uuid,
  p_user_id uuid,
  p_course_id text,
  p_grader_id uuid,
  p_rubric_scores jsonb,
  p_total_points numeric,
  p_max_points numeric,
  p_feedback jsonb,
  p_decision text,
  p_passed boolean,
  p_graded_at timestamptz,
  p_released boolean,
  p_status text,
  p_audit_before jsonb,
  p_audit_after jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored_user_id uuid;
  submission_status text;
begin
  select submission.user_id, submission.status
  into stored_user_id, submission_status
  from public.assignment_submissions as submission
  where submission.id = p_submission_id
  for update;

  if stored_user_id is null then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if stored_user_id is distinct from p_user_id then
    raise exception 'submission user does not match' using errcode = '22023';
  end if;
  if submission_status = 'approved' and exists (
    select 1 from public.grades
    where submission_id = p_submission_id and released = true
  ) then
    raise exception 'GRADE_RELEASED' using errcode = 'P0001';
  end if;

  insert into public.grades as grade (
    submission_id,
    user_id,
    grader_id,
    rubric_scores,
    total_points,
    max_points,
    feedback,
    decision,
    passed,
    graded_at,
    released
  ) values (
    p_submission_id,
    p_user_id,
    p_grader_id,
    p_rubric_scores,
    p_total_points,
    p_max_points,
    p_feedback,
    p_decision,
    p_passed,
    p_graded_at,
    p_released
  )
  on conflict (submission_id) do update
  set user_id = excluded.user_id,
      grader_id = excluded.grader_id,
      rubric_scores = excluded.rubric_scores,
      total_points = excluded.total_points,
      max_points = excluded.max_points,
      feedback = excluded.feedback,
      decision = excluded.decision,
      passed = excluded.passed,
      graded_at = excluded.graded_at,
      released = excluded.released;

  update public.assignment_submissions
  set status = p_status
  where id = p_submission_id;

  insert into public.audit_log (
    actor_id, action, target_type, target_id, before, after
  ) values (
    p_grader_id,
    'submission.grade',
    'assignment_submission',
    p_submission_id::text,
    p_audit_before,
    p_audit_after
  );

  return jsonb_build_object('id', p_submission_id, 'status', p_status);
end;
$$;

revoke all on function public.submit_assignment(uuid, text, uuid, text, text, integer, jsonb, timestamptz, jsonb) from public;
revoke all on function public.submit_assignment(uuid, text, uuid, text, text, integer, jsonb, timestamptz, jsonb) from anon, authenticated;
grant execute on function public.submit_assignment(uuid, text, uuid, text, text, integer, jsonb, timestamptz, jsonb) to service_role;

revoke all on function public.grade_assignment_submission(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, text, jsonb, jsonb) from public;
revoke all on function public.grade_assignment_submission(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.grade_assignment_submission(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, text, jsonb, jsonb) to service_role;

revoke all on function public.claim_learner_upload(uuid, timestamptz, integer, integer) from public;
revoke all on function public.claim_learner_upload(uuid, timestamptz, integer, integer) from anon, authenticated;
grant execute on function public.claim_learner_upload(uuid, timestamptz, integer, integer) to service_role;

revoke all on function public.claim_assignment_submission(uuid, uuid, text, text, timestamptz, integer, integer) from public;
revoke all on function public.claim_assignment_submission(uuid, uuid, text, text, timestamptz, integer, integer) from anon, authenticated;
grant execute on function public.claim_assignment_submission(uuid, uuid, text, text, timestamptz, integer, integer) to service_role;
