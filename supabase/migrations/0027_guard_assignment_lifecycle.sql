-- Serialize learner revisions and instructor release against the same immutable
-- assignment locator. These functions are service-role-only; HTTP routes still
-- derive identity, validate the pinned grading snapshot, and authorize branches.

create or replace function public.submit_assignment_guarded(
  p_user_id uuid,
  p_course_id text,
  p_course_version_id uuid,
  p_item_id text,
  p_block_id text,
  p_expected_latest_submission_id uuid,
  p_resubmission text,
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
  latest_submission public.assignment_submissions%rowtype;
  new_submission public.assignment_submissions%rowtype;
  existing_attempts integer;
  existing_files jsonb;
  requested_files jsonb;
  released_change_requested boolean;
begin
  if p_resubmission not in ('until_approved', 'once', 'never') then
    raise exception 'invalid assignment resubmission policy' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 10 then
    raise exception 'invalid submission files' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_user_id::text, p_course_version_id::text, p_item_id, coalesce(p_block_id, '')),
    0
  ));

  select submission.*
  into latest_submission
  from public.assignment_submissions as submission
  where submission.user_id = p_user_id
    and submission.course_version_id = p_course_version_id
    and submission.item_id = p_item_id
    and submission.block_id is not distinct from p_block_id
  order by submission.attempt_no desc, submission.id desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'asset_id', file.asset_id,
      'name', file.name,
      'size_bytes', file.size_bytes,
      'mime', file.mime
    ) order by file.asset_id
  ), '[]'::jsonb)
  into requested_files
  from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as file(
    asset_id text,
    name text,
    size_bytes bigint,
    mime text
  );

  if latest_submission.id is not null then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'asset_id', file.asset_id,
        'name', file.name,
        'size_bytes', file.size_bytes,
        'mime', file.mime
      ) order by file.asset_id
    ), '[]'::jsonb)
    into existing_files
    from public.submission_files as file
    where file.submission_id = latest_submission.id;

    if latest_submission.payload = p_payload and existing_files = requested_files then
      return jsonb_build_object(
        'id', latest_submission.id,
        'status', latest_submission.status,
        'attempt_no', latest_submission.attempt_no,
        'submitted_at', latest_submission.submitted_at,
        'created', false
      );
    end if;
  end if;

  if latest_submission.id is distinct from p_expected_latest_submission_id then
    raise exception 'SUBMISSION_STALE' using errcode = 'P0001';
  end if;

  select count(*)
  into existing_attempts
  from public.assignment_submissions as submission
  where submission.user_id = p_user_id
    and submission.course_version_id = p_course_version_id
    and submission.item_id = p_item_id
    and submission.block_id is not distinct from p_block_id;

  if exists (
    select 1
    from public.assignment_submissions as submission
    join public.grades as grade on grade.submission_id = submission.id
    where submission.user_id = p_user_id
      and submission.course_version_id = p_course_version_id
      and submission.item_id = p_item_id
      and submission.block_id is not distinct from p_block_id
      and grade.released = true
      and grade.decision = 'approved'
  ) then
    raise exception 'ASSIGNMENT_ALREADY_APPROVED' using errcode = 'P0001';
  end if;
  if existing_attempts >= 20 then
    raise exception 'ATTEMPT_LIMIT' using errcode = 'P0001';
  end if;
  if existing_attempts > 0 and p_resubmission = 'never' then
    raise exception 'RESUBMISSION_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if existing_attempts > 0 and p_resubmission = 'once' then
    select exists (
      select 1
      from public.grades as grade
      where grade.submission_id = latest_submission.id
        and grade.released = true
        and grade.decision = 'changes_requested'
    ) into released_change_requested;
    if existing_attempts >= 2 or not released_change_requested then
      raise exception 'RESUBMISSION_NOT_ALLOWED' using errcode = 'P0001';
    end if;
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
    existing_attempts + 1,
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
    'attempt_no', new_submission.attempt_no,
    'submitted_at', new_submission.submitted_at,
    'created', true
  );
end;
$$;

create or replace function public.grade_assignment_submission_guarded(
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
  p_audit_before jsonb,
  p_audit_after jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored_submission public.assignment_submissions%rowtype;
  existing_grade public.grades%rowtype;
  next_status text;
  became_released_approved boolean;
begin
  select submission.*
  into stored_submission
  from public.assignment_submissions as submission
  where submission.id = p_submission_id;

  if stored_submission.id is null then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if stored_submission.user_id is distinct from p_user_id then
    raise exception 'submission user does not match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(
      ':',
      stored_submission.user_id::text,
      stored_submission.course_version_id::text,
      stored_submission.item_id,
      coalesce(stored_submission.block_id, '')
    ),
    0
  ));

  select submission.*
  into stored_submission
  from public.assignment_submissions as submission
  where submission.id = p_submission_id
  for update;

  if exists (
    select 1
    from public.assignment_submissions as newer
    where newer.user_id = stored_submission.user_id
      and newer.course_version_id = stored_submission.course_version_id
      and newer.item_id = stored_submission.item_id
      and newer.block_id is not distinct from stored_submission.block_id
      and (newer.attempt_no, newer.id) > (stored_submission.attempt_no, stored_submission.id)
  ) then
    raise exception 'STALE_SUBMISSION' using errcode = 'P0001';
  end if;

  select grade.*
  into existing_grade
  from public.grades as grade
  where grade.submission_id = p_submission_id
  for update;

  if existing_grade.id is not null
    and existing_grade.released = true
    and existing_grade.decision = 'approved' then
    raise exception 'GRADE_RELEASED' using errcode = 'P0001';
  end if;

  next_status := case when p_released then p_decision else 'in_review' end;
  became_released_approved := p_released and p_decision = 'approved';

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
  set status = next_status
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

  return jsonb_build_object(
    'id', p_submission_id,
    'status', next_status,
    'became_released_approved', became_released_approved
  );
end;
$$;

revoke all on function public.submit_assignment_guarded(uuid, text, uuid, text, text, uuid, text, jsonb, timestamptz, jsonb) from public;
revoke all on function public.submit_assignment_guarded(uuid, text, uuid, text, text, uuid, text, jsonb, timestamptz, jsonb) from anon, authenticated;
grant execute on function public.submit_assignment_guarded(uuid, text, uuid, text, text, uuid, text, jsonb, timestamptz, jsonb) to service_role;

revoke all on function public.grade_assignment_submission_guarded(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, jsonb, jsonb) from public;
revoke all on function public.grade_assignment_submission_guarded(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, jsonb, jsonb) from anon, authenticated;
grant execute on function public.grade_assignment_submission_guarded(uuid, uuid, text, uuid, jsonb, numeric, numeric, jsonb, text, boolean, timestamptz, boolean, jsonb, jsonb) to service_role;
