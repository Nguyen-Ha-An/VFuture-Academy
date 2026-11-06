-- Staff mutations resolve the course and school from the locked historical attempt.
-- The service identity is explicit, and the live teaching assignment and base
-- operation permission are checked again within the mutating database request.
create function public.exam_assert_teaching_scope(p_actor_id uuid,p_permission text,p_attempt_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  attempt public.exam_attempts;
  course_id text;
begin
  select a.* into attempt from public.exam_attempts a where a.id=p_attempt_id for update;
  if not found then raise exception 'exam teaching scope denied' using errcode='42501'; end if;
  select v.course_id into course_id from public.course_versions v where v.id=attempt.course_version_id;
  if p_actor_id is null or course_id is null or public.teaching_has_course_permission(
    p_actor_id,p_permission,course_id,
    case when attempt.branch_scope_known then attempt.branch_id else null end
  ) is distinct from true then raise exception 'exam teaching scope denied' using errcode='42501'; end if;
end $$;
revoke all on function public.exam_assert_teaching_scope(uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.exam_save_manual_draft(p_attempt_id uuid,p_answer jsonb,p_actor_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.exam_assert_teaching_scope(p_actor_id,'submission.grade',p_attempt_id);
  if p_answer->>'gradedBy' is distinct from p_actor_id::text then
    raise exception 'exam grader identity denied' using errcode='42501';
  end if;
  return public.exam_save_manual_draft(p_attempt_id,p_answer);
end $$;

create function public.exam_complete_manual_grading(
  p_attempt_id uuid,p_points numeric,p_max_points numeric,p_percent numeric,
  p_result_available_at timestamptz,p_expected_answers jsonb,p_answers jsonb,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.exam_assert_teaching_scope(p_actor_id,'submission.grade',p_attempt_id);
  return public.exam_complete_manual_grading(p_attempt_id,p_points,p_max_points,p_percent,p_result_available_at,p_expected_answers,p_answers);
end $$;

create function public.exam_release_attempt(p_attempt_id uuid,p_released_at timestamptz,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.exam_assert_teaching_scope(p_actor_id,'exam.release',p_attempt_id);
  return public.exam_release_attempt(p_attempt_id,p_released_at);
end $$;

-- Internal legacy implementations remain callable only by their definer wrappers.
revoke all on function public.exam_save_manual_draft(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.exam_release_attempt(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.exam_save_manual_draft(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.exam_release_attempt(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.exam_save_manual_draft(uuid,jsonb,uuid) to service_role;
grant execute on function public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb,uuid) to service_role;
grant execute on function public.exam_release_attempt(uuid,timestamptz,uuid) to service_role;
