-- Service-role-only administration and bounded operational analytics.

alter table public.analytics_events
  add constraint analytics_events_name_allowed check (name in (
    'landing.cta_clicked',
    'landing.course_card_clicked',
    'course.enrolled',
    'lesson.completed',
    'quiz.submitted',
    'exam.started',
    'exam.submitted',
    'assignment.submitted',
    'assignment.graded',
    'course.completed',
    'opportunity.viewed',
    'opportunity.clicked'
  )),
  add constraint analytics_events_props_size check (octet_length(props::text) <= 4096);

create table public.admin_user_search_buckets (
  actor_id uuid primary key references public.profiles(id) on delete cascade,
  tokens numeric not null check (tokens >= 0 and tokens <= 30),
  refilled_at timestamptz not null
);

alter table public.admin_user_search_buckets enable row level security;

create or replace function public.admin_consume_user_search_token(p_actor_id uuid)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_tokens numeric;
  bucket_refilled_at timestamptz;
  current_time timestamptz := clock_timestamp();
begin
  insert into public.admin_user_search_buckets (actor_id, tokens, refilled_at)
  values (p_actor_id, 30, current_time)
  on conflict (actor_id) do nothing;

  select search_bucket.tokens, search_bucket.refilled_at
  into bucket_tokens, bucket_refilled_at
  from public.admin_user_search_buckets search_bucket
  where search_bucket.actor_id = p_actor_id
  for update;

  bucket_tokens := least(
    30,
    bucket_tokens + extract(epoch from (current_time - bucket_refilled_at)) * 0.5
  );

  if bucket_tokens >= 1 then
    update public.admin_user_search_buckets
    set tokens = bucket_tokens - 1,
        refilled_at = current_time
    where actor_id = p_actor_id;
    return query select true, 0;
  else
    update public.admin_user_search_buckets
    set tokens = bucket_tokens,
        refilled_at = current_time
    where actor_id = p_actor_id;
    return query select false, greatest(1, ceil((1 - bucket_tokens) / 0.5)::integer);
  end if;
end;
$$;

create or replace function public.admin_find_user_by_email(p_email text)
returns table (
  id uuid,
  email text,
  handle text,
  display_name text,
  branch_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.id, auth_user.email::text, profile.handle, profile.display_name, profile.branch_id
  from auth.users auth_user
  join public.profiles profile on profile.id = auth_user.id
  where auth_user.email = lower(trim(p_email))
  order by auth_user.id
  limit 1
$$;

create or replace function public.admin_user_emails(p_user_ids uuid[])
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth_user.id, auth_user.email::text
  from auth.users auth_user
  where auth_user.id = any(p_user_ids)
  order by auth_user.id
$$;

create or replace function public.admin_apply_mutation(
  p_operation text,
  p_actor_id uuid,
  p_target_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_value jsonb;
  after_value jsonb;
  audit_action text;
  target_type text;
  target_user_id uuid;
  requested_role text;
  requested_branch_id text;
  requested_enabled boolean;
  global_admin_count bigint;
begin
  if p_actor_id is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid admin mutation' using errcode = '22023';
  end if;

  case p_operation
    when 'branch.create' then
      insert into public.branches as branch (id, name, city)
      values (p_target_id, p_payload ->> 'name', p_payload ->> 'city')
      returning jsonb_build_object(
        'id', branch.id,
        'name', branch.name,
        'city', branch.city,
        'created_at', branch.created_at
      ) into after_value;
      before_value := null;
      audit_action := 'branch.created';
      target_type := 'branch';

    when 'branch.update' then
      select jsonb_build_object(
        'id', branch.id,
        'name', branch.name,
        'city', branch.city,
        'created_at', branch.created_at
      )
      into before_value
      from public.branches branch
      where branch.id = p_target_id
      for update;
      if not found then
        raise exception 'branch not found' using errcode = 'P0002';
      end if;

      update public.branches branch
      set name = case when p_payload ? 'name' then p_payload ->> 'name' else branch.name end,
          city = case when p_payload ? 'city' then p_payload ->> 'city' else branch.city end
      where branch.id = p_target_id
      returning jsonb_build_object(
        'id', branch.id,
        'name', branch.name,
        'city', branch.city,
        'created_at', branch.created_at
      ) into after_value;
      audit_action := 'branch.updated';
      target_type := 'branch';

    when 'user.branch.assign' then
      target_user_id := p_target_id::uuid;
      select jsonb_build_object('branchId', profile.branch_id)
      into before_value
      from public.profiles profile
      where profile.id = target_user_id
      for update;
      if not found then
        raise exception 'user not found' using errcode = 'P0002';
      end if;

      update public.profiles profile
      set branch_id = p_payload ->> 'branchId',
          updated_at = now()
      where profile.id = target_user_id
      returning jsonb_build_object('branchId', profile.branch_id) into after_value;
      audit_action := 'user.branch_changed';
      target_type := 'user';

    when 'user.role.set' then
      target_user_id := p_target_id::uuid;
      requested_role := p_payload ->> 'role';
      requested_branch_id := p_payload ->> 'branchId';
      requested_enabled := (p_payload ->> 'enabled')::boolean;

      perform 1 from public.profiles profile where profile.id = target_user_id for update;
      if not found then
        raise exception 'user not found' using errcode = 'P0002';
      end if;

      select coalesce(jsonb_agg(
        jsonb_build_object('role', user_role.role, 'branchId', user_role.branch_id)
        order by user_role.role, user_role.branch_id
      ), '[]'::jsonb)
      into before_value
      from public.user_roles user_role
      where user_role.user_id = target_user_id;

      if not requested_enabled
         and requested_role = 'admin'
         and requested_branch_id is null
         and exists (
           select 1 from public.user_roles existing_role
           where existing_role.user_id = target_user_id
             and existing_role.role = 'admin'
             and existing_role.branch_id is null
         ) then
        perform pg_advisory_xact_lock(hashtextextended('global-admin-lock', 0));
        select count(*) into global_admin_count
        from public.user_roles admin_role
        where admin_role.role = 'admin'
          and admin_role.branch_id is null;
        if global_admin_count <= 1 then
          raise exception 'cannot revoke final global admin' using errcode = 'P0001';
        end if;
      end if;

      if requested_enabled then
        insert into public.user_roles (user_id, role, branch_id, granted_by)
        values (target_user_id, requested_role, requested_branch_id, p_actor_id)
        on conflict (user_id, role, branch_id) do nothing;
        audit_action := 'user.role_granted';
      else
        delete from public.user_roles user_role
        where user_role.user_id = target_user_id
          and user_role.role = requested_role
          and user_role.branch_id is not distinct from requested_branch_id;
        audit_action := 'user.role_revoked';
      end if;

      select coalesce(jsonb_agg(
        jsonb_build_object('role', user_role.role, 'branchId', user_role.branch_id)
        order by user_role.role, user_role.branch_id
      ), '[]'::jsonb)
      into after_value
      from public.user_roles user_role
      where user_role.user_id = target_user_id;
      target_type := 'user';

    else
      raise exception 'unknown admin mutation' using errcode = '22023';
  end case;

  insert into public.audit_log (actor_id, action, target_type, target_id, before, after)
  values (p_actor_id, audit_action, target_type, p_target_id, before_value, after_value);

  return after_value;
end;
$$;

create view public.analytics_branch_daily
with (security_invoker = true)
as
with days as (
  select profile.branch_id, (event.at at time zone 'UTC')::date as day
  from public.analytics_events event
  join public.profiles profile on profile.id = event.user_id
  where profile.branch_id is not null
    and (event.at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date
  from public.enrollments enrollment
  join public.profiles profile on profile.id = enrollment.user_id
  where profile.branch_id is not null
    and (enrollment.enrolled_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date
  from public.lesson_progress progress
  join public.profiles profile on profile.id = progress.user_id
  where profile.branch_id is not null
    and coalesce(progress.completed_at, progress.started_at) is not null
    and (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
  from public.quiz_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
  from public.exam_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (submission.submitted_at at time zone 'UTC')::date
  from public.assignment_submissions submission
  join public.profiles profile on profile.id = submission.user_id
  where profile.branch_id is not null
    and (submission.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select branch.id, current_date from public.branches branch
),
user_activity as (
  select distinct profile.branch_id, event.user_id, (event.at at time zone 'UTC')::date as day
  from public.analytics_events event
  join public.profiles profile on profile.id = event.user_id
  where profile.branch_id is not null
    and (event.at at time zone 'UTC')::date between current_date - 118 and current_date
),
daily_activity as (
  select branch_id, day, count(*)::bigint as active_learners
  from user_activity
  where day between current_date - 89 and current_date
  group by branch_id, day
),
active_windows as (
  select days.branch_id, days.day,
    count(distinct activity.user_id) filter (where activity.day >= days.day - 6)::bigint as active_learners_7d,
    count(distinct activity.user_id)::bigint as active_learners_30d
  from days
  left join user_activity activity
    on activity.branch_id = days.branch_id
   and activity.day between days.day - 29 and days.day
  group by days.branch_id, days.day
),
daily_enrollments as (
  select profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date as day,
    count(*)::bigint as enrollments
  from public.enrollments enrollment
  join public.profiles profile on profile.id = enrollment.user_id
  where profile.branch_id is not null
    and (enrollment.enrolled_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date
),
daily_lessons as (
  select profile.branch_id,
    (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date as day,
    count(*)::bigint as lesson_progress_total,
    count(*) filter (where progress.status = 'completed')::bigint as lesson_completions
  from public.lesson_progress progress
  join public.profiles profile on profile.id = progress.user_id
  where profile.branch_id is not null
    and coalesce(progress.completed_at, progress.started_at) is not null
    and (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date
),
daily_quizzes as (
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as quiz_attempts
  from public.quiz_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
),
daily_exams as (
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as exam_attempts
  from public.exam_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
)
select days.branch_id,
  days.day,
  coalesce(activity.active_learners, 0)::bigint as active_learners,
  coalesce(active.active_learners_7d, 0)::bigint as active_learners_7d,
  coalesce(active.active_learners_30d, 0)::bigint as active_learners_30d,
  coalesce(enrollment.enrollments, 0)::bigint as enrollments,
  coalesce(lesson.lesson_progress_total, 0)::bigint as lesson_progress_total,
  coalesce(lesson.lesson_completions, 0)::bigint as lesson_completions,
  case when coalesce(lesson.lesson_progress_total, 0) = 0 then 0
    else round(100.0 * lesson.lesson_completions / lesson.lesson_progress_total, 2)
  end as lesson_completion_rate,
  coalesce(quiz.quiz_attempts, 0)::bigint as quiz_attempts,
  coalesce(exam.exam_attempts, 0)::bigint as exam_attempts
from days
left join daily_activity activity using (branch_id, day)
left join active_windows active using (branch_id, day)
left join daily_enrollments enrollment using (branch_id, day)
left join daily_lessons lesson using (branch_id, day)
left join daily_quizzes quiz using (branch_id, day)
left join daily_exams exam using (branch_id, day);

create view public.analytics_branch_course_daily
with (security_invoker = true)
as
with quiz as (
  select profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as quiz_attempts,
    sum(attempt.percent) as score_sum,
    count(attempt.percent)::bigint as score_count
  from public.quiz_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date
),
exam as (
  select profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as exam_attempts,
    sum(attempt.percent) as score_sum,
    count(attempt.percent)::bigint as score_count
  from public.exam_attempts attempt
  join public.profiles profile on profile.id = attempt.user_id
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date
),
keys as (
  select branch_id, course_id, day from quiz
  union
  select branch_id, course_id, day from exam
)
select keys.branch_id,
  keys.course_id,
  keys.day,
  coalesce(quiz.quiz_attempts, 0)::bigint as quiz_attempts,
  coalesce(exam.exam_attempts, 0)::bigint as exam_attempts,
  coalesce(quiz.score_sum, 0) + coalesce(exam.score_sum, 0) as score_sum,
  (coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0))::bigint as score_count,
  case when coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0) = 0 then null
    else round(
      (coalesce(quiz.score_sum, 0) + coalesce(exam.score_sum, 0))
      / (coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0)),
      2
    )
  end as average_percent
from keys
left join quiz using (branch_id, course_id, day)
left join exam using (branch_id, course_id, day);

create or replace function public.analytics_pending_grading(p_branch_id text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    (
      select count(*)
      from public.assignment_submissions pending
      join public.profiles profile on profile.id = pending.user_id
      where profile.branch_id = p_branch_id
        and pending.status in ('submitted', 'in_review')
    ) + (
      select count(*)
      from public.exam_attempts pending_exam
      join public.profiles profile on profile.id = pending_exam.user_id
      where profile.branch_id = p_branch_id
        and pending_exam.status = 'pending_manual'
    )
  )::bigint as pending_grading_count
$$;

create or replace function public.top_failed_questions(
  p_branch_id text,
  p_from date,
  p_to date
)
returns table (
  course_id text,
  question_id text,
  failures bigint,
  attempts bigint,
  failure_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select version.course_id,
    answer.question_id,
    count(*) filter (where answer.result ->> 'status' = 'incorrect') as failures,
    count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')) as attempts,
    round(
      100.0 * count(*) filter (where answer.result ->> 'status' = 'incorrect')
      / nullif(count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')), 0),
      2
    ) as failure_rate
  from public.exam_answers answer
  join public.exam_attempts attempt on attempt.id = answer.attempt_id and attempt.user_id = answer.user_id
  join public.profiles profile on profile.id = attempt.user_id
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id = p_branch_id
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date
      between greatest(p_from, current_date - 89) and least(p_to, current_date)
  group by version.course_id, answer.question_id
  having count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')) >= 5
    and count(*) filter (where answer.result ->> 'status' = 'incorrect') > 0
  order by failures desc, failure_rate desc, answer.question_id
  limit 10
$$;

revoke all on function public.admin_consume_user_search_token(uuid) from public;
revoke all on function public.admin_consume_user_search_token(uuid) from anon, authenticated;
grant execute on function public.admin_consume_user_search_token(uuid) to service_role;

revoke all on function public.admin_find_user_by_email(text) from public;
revoke all on function public.admin_find_user_by_email(text) from anon, authenticated;
grant execute on function public.admin_find_user_by_email(text) to service_role;

revoke all on function public.admin_user_emails(uuid[]) from public;
revoke all on function public.admin_user_emails(uuid[]) from anon, authenticated;
grant execute on function public.admin_user_emails(uuid[]) to service_role;

revoke all on function public.admin_apply_mutation(text, uuid, text, jsonb) from public;
revoke all on function public.admin_apply_mutation(text, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.admin_apply_mutation(text, uuid, text, jsonb) to service_role;

revoke all on public.admin_user_search_buckets from public;
revoke all on public.admin_user_search_buckets from anon, authenticated;

revoke all on public.analytics_branch_daily from public;
revoke all on public.analytics_branch_daily from anon, authenticated;
grant select on public.analytics_branch_daily to service_role;

revoke all on public.analytics_branch_course_daily from public;
revoke all on public.analytics_branch_course_daily from anon, authenticated;
grant select on public.analytics_branch_course_daily to service_role;

revoke all on function public.analytics_pending_grading(text) from public;
revoke all on function public.analytics_pending_grading(text) from anon, authenticated;
grant execute on function public.analytics_pending_grading(text) to service_role;

revoke all on function public.top_failed_questions(text, date, date) from public;
revoke all on function public.top_failed_questions(text, date, date) from anon, authenticated;
grant execute on function public.top_failed_questions(text, date, date) to service_role;
