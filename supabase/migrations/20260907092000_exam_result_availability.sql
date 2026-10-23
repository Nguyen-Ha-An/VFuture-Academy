-- Independent exam result availability.
--
-- `result_available_at` records that GRADING IS COMPLETE and the learner owns the
-- score and manual feedback. It is deliberately NOT `released_at`: `released_at`
-- (with the pinned `exam.review` settings) governs the answer key and explanations,
-- and neither column may ever be read as permission for the other.
--
-- Forward-only and additive. The column is nullable with no default and no backfill,
-- so every pre-existing attempt keeps `result_available_at = null` and stays governed
-- solely by the legacy release path, which remains available for exactly those rows.

alter table public.exam_attempts
  add column if not exists result_available_at timestamptz;

-- A result timestamp is only meaningful for a fully graded attempt.
alter table public.exam_attempts
  drop constraint if exists exam_attempts_result_available_when_graded;
alter table public.exam_attempts
  add constraint exam_attempts_result_available_when_graded
  check (result_available_at is null or status = 'graded');

-- Serves the reporting workload counter for graded-but-unpublished attempts.
create index if not exists exam_attempts_unpublished_results
  on public.exam_attempts (course_version_id, item_id)
  where status = 'graded' and released_at is null and result_available_at is null;

-- Automatic grading publishes results inside the same transition that grades the
-- attempt.
--
-- The pre-availability 9-argument signature is deliberately KEPT, as a thin overload
-- delegating here with a null timestamp. The pipeline migrates before it replaces the
-- running application, and a rollback puts the previous application back in front of
-- this schema, so during both windows a 9-argument caller is live and must keep
-- working with exactly its old behaviour: submissions succeed and publish no result.
-- There is no resolution ambiguity — the tenth parameter has no default, so a
-- 9-argument call can only match the 9-argument function and a 10-argument call can
-- only match this one.
create or replace function public.exam_finalize_attempt(
  p_attempt_id uuid,
  p_status text,
  p_late boolean,
  p_submitted_at timestamptz,
  p_points numeric,
  p_max_points numeric,
  p_percent numeric,
  p_expected_answers jsonb,
  p_answers jsonb,
  p_result_available_at timestamptz
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
     or jsonb_typeof(p_answers) <> 'array'
     or (p_result_available_at is not null and p_status <> 'graded') then
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
      percent = p_percent,
      result_available_at = p_result_available_at
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

-- Backward compatibility for the running application during migrate-before-deploy
-- and for a rollback to it. Legacy behaviour verbatim: no result availability.
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
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.exam_finalize_attempt(
    p_attempt_id, p_status, p_late, p_submitted_at,
    p_points, p_max_points, p_percent, p_expected_answers, p_answers, null
  );
$$;

-- A grading draft must take the same attempt-row lock as completion.
--
-- Without it a draft write can interleave: the caller reads `pending_manual`, a
-- concurrent completion commits, and the draft's `manual_points`/`result` then land
-- on an attempt whose published total was computed without them. The stored answers
-- would disagree with the published score with no way to tell which is right. This
-- function makes the status re-check and the answer write one atomic step, and
-- returns false when the attempt is no longer accepting drafts so the caller can
-- refuse the edit instead of silently corrupting a finalized result.
create or replace function public.exam_save_manual_draft(
  p_attempt_id uuid,
  p_answer jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_attempt public.exam_attempts;
begin
  if jsonb_typeof(p_answer) <> 'object' or (p_answer ->> 'questionId') is null then
    raise exception 'invalid exam manual draft' using errcode = '22023';
  end if;

  select attempt.* into locked_attempt
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found or locked_attempt.status <> 'pending_manual' then
    return false;
  end if;

  insert into public.exam_answers (
    attempt_id, user_id, question_id, answer, result,
    manual_points, manual_feedback, graded_by, updated_at
  )
  values (
    p_attempt_id,
    locked_attempt.user_id,
    p_answer ->> 'questionId',
    p_answer -> 'answer',
    p_answer -> 'result',
    (p_answer ->> 'manualPoints')::numeric,
    p_answer -> 'manualFeedback',
    (p_answer ->> 'gradedBy')::uuid,
    (p_answer ->> 'updatedAt')::timestamptz
  )
  on conflict on constraint exam_answers_pkey do update
  set answer = excluded.answer,
      result = excluded.result,
      manual_points = excluded.manual_points,
      manual_feedback = excluded.manual_feedback,
      graded_by = excluded.graded_by,
      updated_at = excluded.updated_at;

  return true;
end
$$;

-- Explicit completion of a manually graded attempt. Atomic and idempotent:
--   * only a `pending_manual` attempt transitions;
--   * an already `graded` attempt returns its current final state with
--     `transitioned = false`, so a retry or a lost concurrent race is not an error;
--   * the expected-answer snapshot carries `manualPoints` as well as `answer`, so a
--     grading draft saved between the caller's read and this write aborts the
--     completion (`answersChanged`) instead of publishing a stale total;
--   * the first result timestamp is preserved, exactly like `released_at`.
-- It never touches `released_at`: completing grading does not publish an answer key.
create or replace function public.exam_complete_manual_grading(
  p_attempt_id uuid,
  p_points numeric,
  p_max_points numeric,
  p_percent numeric,
  p_result_available_at timestamptz,
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
  if p_result_available_at is null
     or jsonb_typeof(p_expected_answers) <> 'object'
     or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'invalid exam grading completion' using errcode = '22023';
  end if;

  select attempt.* into locked_attempt
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception 'exam attempt not found' using errcode = '22023';
  end if;
  if locked_attempt.status <> 'pending_manual' then
    return jsonb_build_object(
      'transitioned', false,
      'answersChanged', false,
      'attempt', to_jsonb(locked_attempt)
    );
  end if;

  select coalesce(
    jsonb_object_agg(
      answer.question_id,
      jsonb_build_object('answer', answer.answer, 'manualPoints', answer.manual_points)
    ),
    '{}'::jsonb
  )
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
  set status = 'graded',
      points = p_points,
      max_points = p_max_points,
      percent = p_percent,
      result_available_at = coalesce(result_available_at, p_result_available_at)
  where id = p_attempt_id
    and status = 'pending_manual'
  returning * into locked_attempt;

  return jsonb_build_object(
    'transitioned', true,
    'answersChanged', false,
    'attempt', to_jsonb(locked_attempt)
  );
end
$$;

revoke all on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.exam_save_manual_draft(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.exam_complete_manual_grading(uuid, numeric, numeric, numeric, timestamptz, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb) to service_role;
grant execute on function public.exam_save_manual_draft(uuid, jsonb) to service_role;
grant execute on function public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.exam_complete_manual_grading(uuid, numeric, numeric, numeric, timestamptz, jsonb, jsonb) to service_role;

-- Reporting must agree with what learners can actually see: an exam attempt counts as
-- published when its results are available OR its answer key was released. Historical
-- rows have `result_available_at = null`, so their reported publication is unchanged.

create or replace function public.studio_learning_report(
  p_actor_user_id uuid,
  p_branch_id text,
  p_course_id text,
  p_from date,
  p_to date,
  p_publication text default 'released',
  p_include_unknown_historical_branch boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception using errcode = '22023', message = 'Invalid report period';
  end if;
  if p_publication not in ('released', 'unreleased', 'all') then
    raise exception using errcode = '22023', message = 'Invalid publication filter';
  end if;
  if p_branch_id is null then
    if not public.authorization_has_permission(p_actor_user_id, 'report.global.read', 'central', null)
      and not public.authorization_has_permission(p_actor_user_id, 'analytics.global.read', 'central', null) then
      raise exception using errcode = '42501', message = 'Permission denied';
    end if;
  elsif not public.authorization_has_permission(p_actor_user_id, 'report.global.read', 'central', null)
    and not public.authorization_has_permission(p_actor_user_id, 'analytics.global.read', 'central', null)
    and not public.authorization_has_permission(p_actor_user_id, 'report.branch.read', 'branch', p_branch_id)
    and not public.authorization_has_permission(p_actor_user_id, 'analytics.branch.read', 'branch', p_branch_id) then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;
  if p_include_unknown_historical_branch
    and not public.authorization_has_permission(p_actor_user_id, 'report.global.read', 'central', null)
    and not public.authorization_has_permission(p_actor_user_id, 'analytics.global.read', 'central', null) then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;

  with
  versions as (
    select version.id, version.course_id,
      coalesce(version.summary #>> '{meta,title,vi}', version.summary #>> '{meta,title,en}', course.slug) as title
    from public.course_versions version
    join public.courses course on course.id = version.course_id
    where p_course_id is null or version.course_id = p_course_id
  ),
  scoped_enrollments as (
    select enrollment.*
    from public.enrollments enrollment
    where (p_course_id is null or enrollment.course_id = p_course_id)
      and (
        (p_branch_id is not null and enrollment.branch_scope_known and enrollment.branch_id = p_branch_id)
        or (p_branch_id is null and (enrollment.branch_scope_known or p_include_unknown_historical_branch))
      )
  ),
  cohort as (
    select enrollment.course_id,
      count(*)::bigint as enrollments,
      count(*) filter (
        where enrollment.completed_at is not null
          and enrollment.completed_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      )::bigint as completed
    from scoped_enrollments enrollment
    where (enrollment.enrolled_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
    group by enrollment.course_id
  ),
  attempt_rows as (
    select 'quiz'::text as kind, attempt.user_id, version.course_id, attempt.course_version_id,
      attempt.item_id, attempt.submitted_at, attempt.percent::numeric as percent,
      attempt.passed, true as released
    from public.quiz_attempts attempt
    join versions version on version.id = attempt.course_version_id
    where (attempt.submitted_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id = p_branch_id)
        or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch)))
    union all
    select 'exam', attempt.user_id, version.course_id, attempt.course_version_id,
      attempt.item_id, attempt.submitted_at,
      case when attempt.status = 'graded' then attempt.percent else null end,
      case when attempt.status <> 'graded' or attempt.percent is null then null else
        attempt.percent >= coalesce((attempt.grading_snapshot #>> '{exam,passPercent}')::numeric, 50)
      end,
      (attempt.released_at is not null or attempt.result_available_at is not null)
    from public.exam_attempts attempt
    join versions version on version.id = attempt.course_version_id
    where attempt.submitted_at is not null
      and (attempt.submitted_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id = p_branch_id)
        or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch)))
    union all
    select 'assignment', submission.user_id, version.course_id, submission.course_version_id,
      submission.item_id, submission.submitted_at,
      case when grade.max_points > 0 then 100 * grade.total_points / grade.max_points else null end,
      grade.passed, coalesce(grade.released, false)
    from public.assignment_submissions submission
    join versions version on version.id = submission.course_version_id
    left join public.grades grade on grade.submission_id = submission.id
    where (submission.submitted_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and ((p_branch_id is not null and submission.branch_scope_known and submission.branch_id = p_branch_id)
        or (p_branch_id is null and (submission.branch_scope_known or p_include_unknown_historical_branch)))
  ),
  selected_attempts as (
    select * from attempt_rows
    where p_publication = 'all'
      or (p_publication = 'released' and released)
      or (p_publication = 'unreleased' and not released)
  ),
  activities as (
    select distinct event.user_id
    from public.analytics_events event
    where event.user_id is not null
      and (event.at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and (p_course_id is null or event.props ->> 'courseId' = p_course_id)
      and ((p_branch_id is not null and event.branch_scope_known and event.branch_id = p_branch_id)
        or (p_branch_id is null and (event.branch_scope_known or p_include_unknown_historical_branch)))
    union
    select attempt.user_id from attempt_rows attempt
  ),
  course_ids as (
    select course_id from cohort
    union select course_id from selected_attempts
  ),
  course_metrics as (
    select course_id, kind,
      count(*)::bigint as attempts,
      round(avg(percent) filter (where percent is not null), 2) as average_percent,
      count(percent)::bigint as average_sample,
      round(100.0 * count(*) filter (where passed) / nullif(count(passed), 0), 2) as pass_percent,
      count(passed)::bigint as pass_sample
    from selected_attempts
    group by course_id, kind
  ),
  question_metrics as (
    select version.course_id, attempt.course_version_id, attempt.item_id, answer.question_id,
      max(attempt.question_set -> 'learner' ->> 'title') as item_title,
      coalesce(
        max(attempt.grading_snapshot #>> array['questions', answer.question_id, 'sourceRef']),
        attempt.course_version_id::text || ':' || answer.question_id
      ) as question_version_id,
      max(left(private.studio_report_text(
        jsonb_path_query_first(
          attempt.question_set -> 'learner', '$.** ? (@.id == $qid)',
          jsonb_build_object('qid', to_jsonb(answer.question_id))
        ) -> 'content'
      ), 240)) as prompt,
      count(*) filter (where answer.result ->> 'status' in ('correct','partial','incorrect','self_assessed','incomplete')
        and (answer.result ->> 'points')::numeric = 0)::bigint as zero_points,
      count(*) filter (where answer.result ->> 'status' in ('correct','partial','incorrect','self_assessed','incomplete'))::bigint as graded
    from public.exam_answers answer
    join public.exam_attempts attempt on attempt.id = answer.attempt_id and attempt.user_id = answer.user_id
    join versions version on version.id = attempt.course_version_id
    where attempt.submitted_at is not null
      and (attempt.submitted_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id = p_branch_id)
        or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch)))
      and (p_publication = 'all'
        or (p_publication = 'released'
          and (attempt.released_at is not null or attempt.result_available_at is not null))
        or (p_publication = 'unreleased'
          and attempt.released_at is null and attempt.result_available_at is null))
      and attempt.status = 'graded'
    group by version.course_id, attempt.course_version_id, attempt.item_id, answer.question_id
  ),
  latest_assignments as (
    select distinct on (submission.user_id, submission.course_version_id, submission.item_id, submission.block_id)
      submission.*, grade.released
    from public.assignment_submissions submission
    left join public.grades grade on grade.submission_id = submission.id
    join versions version on version.id = submission.course_version_id
    where ((p_branch_id is not null and submission.branch_scope_known and submission.branch_id = p_branch_id)
      or (p_branch_id is null and (submission.branch_scope_known or p_include_unknown_historical_branch)))
    order by submission.user_id, submission.course_version_id, submission.item_id,
      submission.block_id, submission.attempt_no desc, submission.id desc
  ),
  workload as (
    select
      (select count(*) from latest_assignments where status in ('submitted','in_review'))::bigint as assignment_pending,
      (select count(*) from latest_assignments where released is false)::bigint as assignment_unpublished,
      (select count(*) from public.exam_attempts attempt join versions version on version.id=attempt.course_version_id
        where attempt.status='pending_manual'
          and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id=p_branch_id)
            or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch))))::bigint as exam_pending,
      (select count(*) from public.exam_answers answer join public.exam_attempts attempt on attempt.id=answer.attempt_id
        join versions version on version.id=attempt.course_version_id
        where answer.result->>'status'='pending_manual'
          and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id=p_branch_id)
            or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch))))::bigint as question_pending,
      (select count(*) from public.exam_attempts attempt join versions version on version.id=attempt.course_version_id
        where attempt.status = 'graded'
          and attempt.released_at is null and attempt.result_available_at is null
          and ((p_branch_id is not null and attempt.branch_scope_known and attempt.branch_id=p_branch_id)
            or (p_branch_id is null and (attempt.branch_scope_known or p_include_unknown_historical_branch))))::bigint as exam_unpublished
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'activeUsers', (select count(*) from activities),
      'newEnrollments', coalesce((select sum(enrollments) from cohort),0),
      'cohort', jsonb_build_object(
        'enrollments', coalesce((select sum(enrollments) from cohort),0),
        'completedByPeriodEnd', coalesce((select sum(completed) from cohort),0),
        'completionRate', (select round(100.0*sum(completed)/nullif(sum(enrollments),0),2) from cohort)
      ),
      'attempts', jsonb_build_object(
        'quiz', (select count(*) from selected_attempts where kind='quiz'),
        'exam', (select count(*) from selected_attempts where kind='exam'),
        'assignment', (select count(*) from selected_attempts where kind='assignment')
      ),
      'averages', (select jsonb_object_agg(kind, jsonb_build_object('percent',average_percent,'sampleSize',average_sample))
        from (select k.kind, round(avg(a.percent) filter(where a.percent is not null),2) average_percent, count(a.percent) average_sample
          from (values('quiz'),('exam'),('assignment')) k(kind) left join selected_attempts a using(kind) group by k.kind) x),
      'passRates', (select jsonb_object_agg(kind, jsonb_build_object('percent',pass_percent,'sampleSize',pass_sample))
        from (select k.kind, round(100.0*count(*) filter(where a.passed)/nullif(count(a.passed),0),2) pass_percent, count(a.passed) pass_sample
          from (values('quiz'),('exam'),('assignment')) k(kind) left join selected_attempts a using(kind) group by k.kind) x)
    ),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
      'courseId', ids.course_id, 'title', (select max(title) from versions where course_id=ids.course_id),
      'newEnrollments', coalesce(cohort.enrollments,0), 'completedByPeriodEnd',coalesce(cohort.completed,0),
      'completionRate', case when coalesce(cohort.enrollments,0)=0 then null else round(100.0*cohort.completed/cohort.enrollments,2) end,
      'attempts', jsonb_build_object('quiz',coalesce(q.attempts,0),'exam',coalesce(e.attempts,0),'assignment',coalesce(a.attempts,0)),
      'averages', jsonb_build_object('quiz',jsonb_build_object('percent',q.average_percent,'sampleSize',coalesce(q.average_sample,0)),'exam',jsonb_build_object('percent',e.average_percent,'sampleSize',coalesce(e.average_sample,0)),'assignment',jsonb_build_object('percent',a.average_percent,'sampleSize',coalesce(a.average_sample,0))),
      'passRates', jsonb_build_object('quiz',jsonb_build_object('percent',q.pass_percent,'sampleSize',coalesce(q.pass_sample,0)),'exam',jsonb_build_object('percent',e.pass_percent,'sampleSize',coalesce(e.pass_sample,0)),'assignment',jsonb_build_object('percent',a.pass_percent,'sampleSize',coalesce(a.pass_sample,0)))
    ) order by ids.course_id) from course_ids ids left join cohort using(course_id)
      left join course_metrics q on q.course_id=ids.course_id and q.kind='quiz'
      left join course_metrics e on e.course_id=ids.course_id and e.kind='exam'
      left join course_metrics a on a.course_id=ids.course_id and a.kind='assignment'), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
      'courseId',course_id,'courseVersionId',course_version_id,'itemId',item_id,'itemTitle',item_title,
      'questionId',question_id,'questionVersionId',question_version_id,'prompt',nullif(prompt,''),
      'zeroPointAnswers',zero_points,'gradedAnswers',graded,
      'zeroPointRate',case when graded=0 then null else round(100.0*zero_points/graded,2) end,
      'sourceHref','/grading/queue?kind=exam&courseVersionId='||course_version_id||'&itemId='||item_id||'&questionId='||question_id
    ) order by zero_points desc, question_id) from question_metrics), '[]'::jsonb),
    'grading', (select jsonb_build_object('asOf',to_jsonb(now()),'label','current',
      'assignments',jsonb_build_object('pending',assignment_pending,'unpublished',assignment_unpublished),
      'exams',jsonb_build_object('pendingManualAttempts',exam_pending,'pendingManualQuestions',question_pending,'unpublished',exam_unpublished)) from workload)
  ) into result;
  return result;
end;
$$;

revoke all on function public.studio_learning_report(uuid,text,text,date,date,text,boolean) from public;
revoke all on function public.studio_learning_report(uuid,text,text,date,date,text,boolean) from anon, authenticated;
grant execute on function public.studio_learning_report(uuid,text,text,date,date,text,boolean) to service_role;
