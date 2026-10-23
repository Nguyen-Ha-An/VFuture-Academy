-- Atomic learner progress transitions used by the service-role API. Course completion,
-- enrollment state, and a durable completion-effect receipt commit together.

create table public.course_completion_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  course_id text not null,
  course_version_id uuid not null,
  completed_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0 check (attempts >= 0 and attempts <= 5),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, course_id),
  foreign key (user_id, course_id)
    references public.course_completions(user_id, course_id) on delete cascade,
  foreign key (course_version_id, course_id)
    references public.course_versions(id, course_id)
);

create index course_completion_effects_pending
  on public.course_completion_effects (locked_until, created_at)
  where status = 'pending';

alter table public.course_completion_effects enable row level security;

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
    on conflict (user_id, course_id) do nothing;

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

create or replace function public.learner_claim_completion_effect(
  p_user_id uuid,
  p_course_id text,
  p_locked_until timestamptz
)
returns table (
  id uuid,
  user_id uuid,
  course_id text,
  course_version_id uuid,
  completed_at timestamptz,
  status text,
  attempts int
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with dead_lettered as (
    update public.course_completion_effects as expired
    set status = 'failed',
        locked_until = null,
        last_error = coalesce(expired.last_error, 'Completion effect lease expired after final attempt'),
        updated_at = now()
    where expired.user_id = p_user_id
      and expired.course_id = p_course_id
      and expired.status = 'pending'
      and expired.attempts >= 5
      and (expired.locked_until is null or expired.locked_until <= now())
    returning expired.id
  ), candidate as (
    select queued.id
    from public.course_completion_effects as queued
    where queued.user_id = p_user_id
      and queued.course_id = p_course_id
      and queued.status = 'pending'
      and queued.attempts < 5
      and (queued.locked_until is null or queued.locked_until <= now())
    order by queued.created_at
    for update skip locked
    limit 1
  )
  update public.course_completion_effects as effect
  set attempts = effect.attempts + 1,
      locked_until = p_locked_until,
      updated_at = now()
  from candidate
  where effect.id = candidate.id
  returning
    effect.id,
    effect.user_id,
    effect.course_id,
    effect.course_version_id,
    effect.completed_at,
    effect.status,
    effect.attempts
$$;

revoke all on function public.learner_claim_completion_effect(uuid, text, timestamptz) from public;
grant execute on function public.learner_claim_completion_effect(uuid, text, timestamptz) to service_role;

create or replace function public.learner_mark_viewed(
  p_user_id uuid,
  p_course_version_id uuid,
  p_item_id text,
  p_started_at timestamptz
)
returns table (
  item_id text,
  status text,
  started_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.enrollments e
    where e.user_id = p_user_id
      and e.course_version_id = p_course_version_id
      and e.status in ('active', 'completed')
  ) then
    raise exception 'ACTIVE_ENROLLMENT_REQUIRED' using errcode = '42501';
  end if;

  return query
  insert into public.lesson_progress (
    user_id,
    course_version_id,
    item_id,
    status,
    started_at
  ) values (
    p_user_id,
    p_course_version_id,
    p_item_id,
    'in_progress',
    p_started_at
  )
  on conflict on constraint lesson_progress_pkey do update
  set status = case
        when lesson_progress.status = 'completed' then lesson_progress.status
        else 'in_progress'
      end,
      started_at = coalesce(lesson_progress.started_at, excluded.started_at)
  returning
    lesson_progress.item_id,
    lesson_progress.status,
    lesson_progress.started_at,
    lesson_progress.completed_at;
end
$$;

revoke all on function public.learner_mark_viewed(uuid, uuid, text, timestamptz) from public;
grant execute on function public.learner_mark_viewed(uuid, uuid, text, timestamptz) to service_role;
