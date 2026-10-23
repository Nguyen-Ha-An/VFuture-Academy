-- Keep learner answer admission and terminal grading transitions atomic with the
-- attempt lifecycle. Both functions remain callable only by service-role code.

create or replace function public.exam_save_active_answers(
  p_attempt_id uuid,
  p_user_id uuid,
  p_answers jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_attempt public.exam_attempts;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 250 then
    raise exception 'invalid exam answer batch' using errcode = '22023';
  end if;

  select attempt.* into locked_attempt
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found
     or locked_attempt.user_id <> p_user_id
     or locked_attempt.status <> 'in_progress' then
    return false;
  end if;

  insert into public.exam_answers (
    attempt_id, user_id, question_id, answer, updated_at
  )
  select
    p_attempt_id,
    locked_attempt.user_id,
    entry.value ->> 'questionId',
    entry.value -> 'answer',
    (entry.value ->> 'updatedAt')::timestamptz
  from jsonb_array_elements(p_answers) as entry(value)
  on conflict on constraint exam_answers_pkey do update
  set answer = excluded.answer,
      updated_at = excluded.updated_at;

  return true;
end
$$;

create or replace function public.exam_finalize_attempt(
  p_attempt_id uuid,
  p_status text,
  p_late boolean,
  p_submitted_at timestamptz,
  p_points numeric,
  p_max_points numeric,
  p_percent numeric,
  p_expected_answers jsonb,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_attempt public.exam_attempts;
  accepted_answers jsonb;
begin
  if p_status not in ('graded', 'pending_manual', 'expired')
     or jsonb_typeof(p_expected_answers) <> 'object'
     or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'invalid exam finalization' using errcode = '22023';
  end if;

  select attempt.* into locked_attempt
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception 'exam attempt not found' using errcode = '22023';
  end if;
  if locked_attempt.status <> 'in_progress' then
    return jsonb_build_object(
      'transitioned', false,
      'answersChanged', false,
      'attempt', to_jsonb(locked_attempt)
    );
  end if;

  select coalesce(jsonb_object_agg(answer.question_id, answer.answer), '{}'::jsonb)
  into accepted_answers
  from public.exam_answers as answer
  where answer.attempt_id = p_attempt_id;

  if accepted_answers is distinct from p_expected_answers then
    return jsonb_build_object(
      'transitioned', false,
      'answersChanged', true,
      'attempt', to_jsonb(locked_attempt)
    );
  end if;

  insert into public.exam_answers (
    attempt_id, user_id, question_id, answer, result,
    manual_points, manual_feedback, graded_by, updated_at
  )
  select
    p_attempt_id,
    locked_attempt.user_id,
    entry.value ->> 'questionId',
    entry.value -> 'answer',
    entry.value -> 'result',
    (entry.value ->> 'manualPoints')::numeric,
    entry.value -> 'manualFeedback',
    (entry.value ->> 'gradedBy')::uuid,
    (entry.value ->> 'updatedAt')::timestamptz
  from jsonb_array_elements(p_answers) as entry(value)
  on conflict on constraint exam_answers_pkey do update
  set answer = excluded.answer,
      result = excluded.result,
      manual_points = excluded.manual_points,
      manual_feedback = excluded.manual_feedback,
      graded_by = excluded.graded_by,
      updated_at = excluded.updated_at;

  update public.exam_attempts
  set status = p_status,
      late = p_late,
      submitted_at = p_submitted_at,
      points = p_points,
      max_points = p_max_points,
      percent = p_percent
  where id = p_attempt_id
    and status = 'in_progress'
  returning * into locked_attempt;

  return jsonb_build_object(
    'transitioned', true,
    'answersChanged', false,
    'attempt', to_jsonb(locked_attempt)
  );
end
$$;

revoke all on function public.exam_save_active_answers(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.exam_save_active_answers(uuid, uuid, jsonb) to service_role;
grant execute on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb) to service_role;
