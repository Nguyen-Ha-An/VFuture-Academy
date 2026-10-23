-- Immutable branch attribution for quiz history. Existing attempts are only
-- backfilled when the current enrollment still points at the exact version;
-- every other historical row remains explicitly unknown for Central reports.

alter table public.quiz_attempts
  add column branch_id text references public.branches(id),
  add column branch_scope_known boolean not null default false,
  add column branch_scope_source text not null default 'unknown'
    check (branch_scope_source in ('unknown', 'enrollment_snapshot'));

update public.quiz_attempts attempt
set branch_id = enrollment.branch_id,
    branch_scope_known = true,
    branch_scope_source = 'enrollment_snapshot'
from public.enrollments enrollment
where enrollment.user_id = attempt.user_id
  and enrollment.course_version_id = attempt.course_version_id
  and enrollment.branch_scope_known
  and enrollment.branch_id is not null;

create or replace function public.stamp_quiz_attempt_branch_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  enrollment_branch text;
  enrollment_known boolean;
begin
  if tg_op = 'UPDATE' then
    if new.branch_id is distinct from old.branch_id
      or new.branch_scope_known is distinct from old.branch_scope_known
      or new.branch_scope_source is distinct from old.branch_scope_source then
      raise exception using errcode = '55000', message = 'Historical branch scope is immutable';
    end if;
    return new;
  end if;

  select enrollment.branch_id, enrollment.branch_scope_known
    into enrollment_branch, enrollment_known
  from public.enrollments enrollment
  where enrollment.user_id = new.user_id
    and enrollment.course_version_id = new.course_version_id
  order by enrollment.id
  limit 1;

  new.branch_id := enrollment_branch;
  new.branch_scope_known := coalesce(enrollment_known, false) and enrollment_branch is not null;
  new.branch_scope_source := case when new.branch_scope_known
    then 'enrollment_snapshot' else 'unknown' end;
  return new;
end;
$$;

revoke all on function public.stamp_quiz_attempt_branch_history() from public, anon, authenticated;
create trigger quiz_attempts_stamp_branch_history
  before insert or update on public.quiz_attempts
  for each row execute function public.stamp_quiz_attempt_branch_history();

create index quiz_attempts_branch_history
  on public.quiz_attempts (branch_id, course_version_id, item_id, submitted_at)
  where branch_scope_known;
