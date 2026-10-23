-- Count one actionable assignment per learner and exact assignment locator.
-- Older attempts remain immutable history and must not inflate staff workload.
create or replace function public.analytics_pending_grading(p_branch_id text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with latest_assignment as (
    select distinct on (
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id
    )
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id,
      submission.status,
      grade.released
    from public.assignment_submissions submission
    join public.profiles profile on profile.id = submission.user_id
    left join public.grades grade on grade.submission_id = submission.id
    where profile.branch_id = p_branch_id
    order by
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id,
      submission.attempt_no desc,
      submission.id desc
  )
  select (
    (
      select count(*)
      from latest_assignment
      where (
        status in ('submitted', 'in_review')
        or (status in ('approved', 'changes_requested') and released is not true)
      ) and not exists (
        select 1
        from public.assignment_submissions approved_submission
        join public.grades approved_grade on approved_grade.submission_id = approved_submission.id
        where approved_submission.user_id = latest_assignment.user_id
          and approved_submission.course_version_id = latest_assignment.course_version_id
          and approved_submission.item_id = latest_assignment.item_id
          and approved_submission.block_id is not distinct from latest_assignment.block_id
          and approved_grade.released = true
          and approved_grade.decision = 'approved'
      )
    ) + (
      select count(*)
      from public.exam_attempts pending_exam
      join public.profiles profile on profile.id = pending_exam.user_id
      where profile.branch_id = p_branch_id
        and pending_exam.status = 'pending_manual'
    )
  )::bigint
$$;

revoke all on function public.analytics_pending_grading(text) from public;
revoke all on function public.analytics_pending_grading(text) from anon, authenticated;
grant execute on function public.analytics_pending_grading(text) to service_role;
