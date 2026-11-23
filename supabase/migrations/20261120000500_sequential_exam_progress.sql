-- The page is mutable attempt state. Question order and grading stay pinned.
alter table public.exam_attempts add column sequential_step integer not null default 0
  check (sequential_step >= 0);

create function public.exam_sequential_questions(p_grading jsonb, p_set jsonb)
returns table (question_id text, step integer, deadline_offset_ms bigint, question_index integer)
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select q.id,
    (case when p_grading #>> '{exam,layout}' = 'section_per_page' then s.position
          else row_number() over (order by s.position, q.position) end - 1)::integer,
    (s.section ->> 'deadlineOffsetMs')::bigint,
    (row_number() over (order by s.position, q.position) - 1)::integer
  from jsonb_array_elements(p_set -> 'sections') with ordinality as s(section, position)
  cross join lateral jsonb_array_elements_text(s.section -> 'questionIds') with ordinality as q(id, position)
  where p_grading #>> '{exam,navigation}' = 'sequential'
    and p_grading #>> '{exam,layout}' is distinct from 'single_page'
$$;
revoke all on function public.exam_sequential_questions(jsonb, jsonb) from public, anon, authenticated, service_role;

-- Older clients stored no page transitions. Retain every saved response and resume
-- the furthest page with a saved answer; an attempt without one starts at page one.
-- The table lock lasts through both trigger changes and the backfill. Suspended
-- learners keep their progress even if they later regain access.
do $$
begin
  alter table public.exam_attempts disable trigger exam_attempts_require_active_account;
  with progress as (
    select a.id, max(q.step) as step
    from public.exam_attempts a
    cross join lateral public.exam_sequential_questions(a.grading_snapshot, a.question_set) q
    join public.exam_answers ans on ans.attempt_id = a.id and ans.question_id = q.question_id
    where a.status = 'in_progress'
    group by a.id
  )
  update public.exam_attempts a set sequential_step = progress.step
  from progress where a.id = progress.id and progress.step > 0;
  alter table public.exam_attempts enable trigger exam_attempts_require_active_account;
end $$;

-- Match the player's answer indicator, including false/zero, whole selected
-- arrays and recursively answered groups. The string set matches String.trim().
create function public.exam_answer_filled(p_value jsonb)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case jsonb_typeof(p_value)
    when 'string' then btrim(p_value #>> '{}', U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
    when 'array' then jsonb_array_length(p_value) > 0
    when 'object' then exists (select 1 from jsonb_each(p_value) e where public.exam_answer_filled(e.value))
    when 'null' then false
    else p_value is not null end
$$;
revoke all on function public.exam_answer_filled(jsonb) from public, anon, authenticated, service_role;

create function public.exam_sequential_answered_before(p_attempt_id uuid, p_user_id uuid, p_step integer)
returns integer[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(q.question_index order by q.question_index), '{}'::integer[])
  from public.exam_attempts a
  cross join lateral public.exam_sequential_questions(a.grading_snapshot, a.question_set) q
  join public.exam_answers ans on ans.attempt_id = a.id and ans.question_id = q.question_id
  where a.id = p_attempt_id and a.user_id = p_user_id
    and q.step < least(p_step, a.sequential_step) and public.exam_answer_filled(ans.answer)
$$;
revoke all on function public.exam_sequential_answered_before(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.exam_sequential_answered_before(uuid, uuid, integer) to service_role;

create or replace function public.exam_save_active_answers(p_attempt_id uuid, p_user_id uuid, p_answers jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.exam_attempts%rowtype;
  boundary bigint;
  page_ids text[];
begin
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 250 then
    raise exception 'invalid exam answer batch' using errcode = '22023';
  end if;
  select * into a from public.exam_attempts where id = p_attempt_id for update;
  if not found or a.user_id is distinct from p_user_id or a.status <> 'in_progress' then return false; end if;
  if a.grading_snapshot #>> '{exam,navigation}' = 'sequential'
    and a.grading_snapshot #>> '{exam,layout}' is distinct from 'single_page' then
    if a.deadline_at is not null and clock_timestamp() > a.deadline_at + interval '30 seconds' then
      raise exception 'exam deadline passed' using errcode = 'P3006';
    end if;
    select array_agg(q.question_id), max(q.deadline_offset_ms) into page_ids, boundary
    from public.exam_sequential_questions(a.grading_snapshot, a.question_set) q where q.step = a.sequential_step;
    if page_ids is null or exists (
      select 1 from jsonb_array_elements(p_answers) e
      where ((e ->> 'questionId') = any(page_ids)) is distinct from true
    ) then raise exception 'exam page changed' using errcode = 'P3004'; end if;
    if jsonb_array_length(p_answers) > 0 and boundary is not null
      and clock_timestamp() > a.started_at + boundary * interval '1 millisecond' + interval '30 seconds' then
      raise exception 'section deadline passed' using errcode = 'P3007';
    end if;
  end if;
  insert into public.exam_answers (attempt_id, user_id, question_id, answer, updated_at)
  select a.id, a.user_id, item ->> 'questionId', item -> 'answer', (item ->> 'updatedAt')::timestamptz
  from jsonb_array_elements(p_answers) item
  on conflict on constraint exam_answers_pkey do update set answer = excluded.answer, updated_at = excluded.updated_at;
  return true;
end $$;

create function public.exam_advance_sequential_page(p_attempt_id uuid, p_user_id uuid, p_from_step integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.exam_attempts%rowtype;
  last_step integer;
begin
  select * into a from public.exam_attempts where id = p_attempt_id for update;
  if not found or a.user_id is distinct from p_user_id or a.status <> 'in_progress' then
    raise exception 'exam is not active' using errcode = 'P3005';
  end if;
  if a.deadline_at is not null and clock_timestamp() > a.deadline_at + interval '30 seconds' then
    raise exception 'exam deadline passed' using errcode = 'P3006';
  end if;
  select max(q.step) into last_step from public.exam_sequential_questions(a.grading_snapshot, a.question_set) q;
  if last_step is null or p_from_step is null or p_from_step < 0 or p_from_step > a.sequential_step or p_from_step >= last_step then
    raise exception 'exam page transition unavailable' using errcode = 'P3004';
  end if;
  -- Concurrent clicks and a retry after a lost acknowledgement return current progress.
  if p_from_step = a.sequential_step then
    update public.exam_attempts set sequential_step = sequential_step + 1 where id = a.id returning sequential_step into a.sequential_step;
  end if;
  return a.sequential_step;
end $$;

revoke all on function public.exam_save_active_answers(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.exam_advance_sequential_page(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.exam_save_active_answers(uuid, uuid, jsonb) to service_role;
grant execute on function public.exam_advance_sequential_page(uuid, uuid, integer) to service_role;

-- New attachment completion already locks the attempt before inserting a binding.
-- Recheck its page under the same lock; any failed binding rolls back that completion.
create function public.exam_attachment_sequential_page_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.exam_attempts%rowtype;
begin
  select * into strict a from public.exam_attempts where id = new.attempt_id for update;
  if a.grading_snapshot #>> '{exam,navigation}' = 'sequential'
    and a.grading_snapshot #>> '{exam,layout}' is distinct from 'single_page'
    and not exists (select 1 from public.exam_sequential_questions(a.grading_snapshot, a.question_set) q
      where q.step = a.sequential_step and q.question_id = new.root_question_id) then
    raise exception 'UPLOAD_CONFLICT';
  end if;
  return new;
end $$;
revoke all on function public.exam_attachment_sequential_page_guard() from public, anon, authenticated, service_role;
create trigger exam_attachment_sequential_page_guard before insert on public.exam_attachment_bindings
  for each row execute function public.exam_attachment_sequential_page_guard();
