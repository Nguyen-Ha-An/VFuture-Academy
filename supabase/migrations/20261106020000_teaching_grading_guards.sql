-- Enforce course and immutable historical school at the transaction boundary.
-- The original function remains callable only by its owner through this wrapper.
alter function public.grade_assignment_submission_guarded(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb)
  rename to grade_assignment_submission_before_teaching_scope;
revoke all on function public.grade_assignment_submission_before_teaching_scope(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb) from public, anon, authenticated, service_role;

create function public.grade_assignment_submission_guarded(
  p_submission_id uuid, p_user_id uuid, p_course_id text, p_grader_id uuid,
  p_rubric_scores jsonb, p_total_points numeric, p_max_points numeric, p_feedback jsonb,
  p_decision text, p_passed boolean, p_graded_at timestamptz, p_released boolean,
  p_audit_before jsonb, p_audit_after jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actual_course text; historical_branch text;
begin
  select v.course_id, case when s.branch_scope_known then s.branch_id else null end
    into actual_course, historical_branch
    from public.assignment_submissions s join public.course_versions v on v.id = s.course_version_id
    where s.id = p_submission_id;
  if actual_course is null or actual_course is distinct from p_course_id
    or not public.teaching_has_course_permission(p_grader_id, 'submission.grade', actual_course, historical_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.grade_assignment_submission_before_teaching_scope(
    p_submission_id,p_user_id,p_course_id,p_grader_id,p_rubric_scores,p_total_points,p_max_points,
    p_feedback,p_decision,p_passed,p_graded_at,p_released,p_audit_before,p_audit_after);
end $$;
revoke all on function public.grade_assignment_submission_guarded(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.grade_assignment_submission_guarded(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb) to service_role;

-- Teaching writes use the actor stamped by the service. Unknown versions fail closed.
create function public.guard_teaching_course_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare target_course text; permission text;
begin
  if tg_table_name = 'teaching_announcements' then
    target_course := new.course_id; permission := 'teaching.announcement.manage';
  else
    select course_id into target_course from public.course_versions where id = new.course_version_id;
    permission := 'teaching.schedule.manage';
  end if;
  if target_course is null or not public.teaching_has_course_permission(new.updated_by, permission, target_course, new.branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_teaching_course_write() from public, anon, authenticated;
create trigger teaching_announcement_course_guard before insert or update on public.teaching_announcements
for each row execute function public.guard_teaching_course_write();
create trigger assignment_schedule_course_guard before insert or update on public.assignment_schedules
for each row execute function public.guard_teaching_course_write();

create or replace function public.delete_teaching_announcement(p_id uuid,p_actor_id uuid,p_expected_revision integer) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare deleted public.teaching_announcements%rowtype;
begin
  select * into deleted from public.teaching_announcements where id=p_id for update;
  if not found then return false; end if;
  if not public.teaching_has_course_permission(p_actor_id,'teaching.announcement.manage',deleted.course_id,deleted.branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.teaching_announcements where id=p_id and status='draft' and revision=p_expected_revision returning * into deleted;
  if not found then return false; end if;
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
  values(p_actor_id,'teaching.announcement.delete','teaching_announcement',p_id::text,
    jsonb_build_object('branchId',deleted.branch_id,'courseId',deleted.course_id,'status',deleted.status,'revision',deleted.revision),null);
  return true;
end $$;
