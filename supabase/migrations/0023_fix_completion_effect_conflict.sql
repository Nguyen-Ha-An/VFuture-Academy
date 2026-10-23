-- Forward-only repair for the completion-effect insert in learner_complete_course.
-- The function's RETURNS TABLE columns make an unqualified (user_id, course_id)
-- conflict target ambiguous in PL/pgSQL. Bind the existing unique constraint by name.

create or replace function public.learner_complete_course(
  p_user_id uuid,
  p_course_id text,
  p_course_version_id uuid,
  p_completed_at timestamptz
)
returns table (
  user_id uuid,
  course_id text,
  course_version_id uuid,
  completed_at timestamptz,
  transitioned boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  did_transition boolean := false;
begin
  if not exists (
    select 1
    from public.enrollments e
    where e.user_id = p_user_id
      and e.course_id = p_course_id
      and e.course_version_id = p_course_version_id
      and e.status in ('active', 'completed')
  ) then
    raise exception 'ACTIVE_ENROLLMENT_REQUIRED' using errcode = '42501';
  end if;

  insert into public.course_completions (
    user_id,
    course_id,
    course_version_id,
    completed_at
  ) values (
    p_user_id,
    p_course_id,
    p_course_version_id,
    p_completed_at
  )
  on conflict on constraint course_completions_pkey do nothing
  returning true into did_transition;

  if coalesce(did_transition, false) then
    insert into public.course_completion_effects (
      user_id,
      course_id,
      course_version_id,
      completed_at
    ) values (
      p_user_id,
      p_course_id,
      p_course_version_id,
      p_completed_at
    )
    on conflict on constraint course_completion_effects_user_id_course_id_key do nothing;

    update public.enrollments e
    set status = 'completed',
        completed_at = p_completed_at
    where e.user_id = p_user_id
      and e.course_id = p_course_id
      and e.course_version_id = p_course_version_id;
  end if;

  return query
  select
    cc.user_id,
    cc.course_id,
    cc.course_version_id,
    cc.completed_at,
    coalesce(did_transition, false)
  from public.course_completions cc
  where cc.user_id = p_user_id
    and cc.course_id = p_course_id;
end
$$;

revoke all on function public.learner_complete_course(uuid, text, uuid, timestamptz) from public;
grant execute on function public.learner_complete_course(uuid, text, uuid, timestamptz) to service_role;
