-- Forward-only learning schema migration. Learner writes remain server-only through
-- service-role route handlers; authenticated clients receive only the explicit reads below.

alter table public.course_versions
  add constraint course_versions_id_course_unique unique (id, course_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null references public.courses(id) on delete cascade,
  course_version_id uuid not null,
  status text not null default 'active' check (status in ('active', 'completed', 'dropped')),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, course_id),
  foreign key (course_version_id, course_id)
    references public.course_versions(id, course_id)
);

create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  primary key (user_id, course_version_id, item_id),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.activity_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  block_id text not null check (block_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  state jsonb not null default '{}',
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_version_id, item_id, block_id),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  quiz_id text not null check (quiz_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  attempt_no int not null check (attempt_no > 0),
  answers jsonb not null default '{}',
  results jsonb not null default '{}',
  points numeric(9,2) not null default 0 check (points >= 0 and points <= 1000000),
  max_points numeric(9,2) not null default 0 check (max_points >= 0 and max_points <= 1000000),
  percent numeric not null default 0 check (percent >= 0 and percent <= 100),
  passed boolean not null default false,
  submitted_at timestamptz not null default now(),
  check (points <= max_points),
  unique (user_id, course_version_id, item_id, quiz_id, attempt_no),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

-- Server-only exam and grade tables:
-- exam_attempts, exam_answers, exam_attempt_events, exam_grades, and grades carry answer keys,
-- ungated scores, or unreleased results. RLS is enabled on them with no policies.
-- Service-role route handlers enforce attempt-state and review/release rules.
create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  attempt_no int not null check (attempt_no > 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'submitted_late', 'graded', 'pending_manual', 'expired')),
  late boolean not null default false,
  question_set jsonb not null,
  grading_snapshot jsonb not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  points numeric(9,2) check (points >= 0 and points <= 1000000),
  max_points numeric(9,2) check (max_points >= 0 and max_points <= 1000000),
  percent numeric check (percent >= 0 and percent <= 100),
  released_at timestamptz,
  check (points is null or max_points is null or points <= max_points),
  unique (id, user_id),
  unique (user_id, course_version_id, item_id, attempt_no),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.exam_answers (
  attempt_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null check (
    char_length(question_id) <= 194
    and question_id ~ '^[a-z0-9][a-z0-9-]{0,63}(/[a-z0-9][a-z0-9-]{0,63}){0,2}$'
  ),
  answer jsonb,
  result jsonb,
  manual_points numeric(9,2) check (manual_points >= 0 and manual_points <= 1000000),
  manual_feedback jsonb,
  graded_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (attempt_id, user_id)
    references public.exam_attempts(id, user_id) on delete cascade
);

create table public.exam_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('focus_lost', 'focus_gained', 'visibility_hidden', 'paste', 'fullscreen_exit')),
  at timestamptz not null default now(),
  meta jsonb not null default '{}',
  foreign key (attempt_id, user_id)
    references public.exam_attempts(id, user_id) on delete cascade
);

create table public.exam_grades (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  percent numeric not null check (percent >= 0 and percent <= 100),
  passed boolean not null,
  policy text not null check (policy in ('best', 'latest', 'first', 'average')),
  computed_at timestamptz not null default now(),
  primary key (user_id, course_version_id, item_id),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_version_id uuid not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  block_id text check (block_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  attempt_no int not null check (attempt_no > 0),
  payload jsonb not null,
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'approved', 'changes_requested')),
  submitted_at timestamptz not null default now(),
  unique (id, user_id),
  unique nulls not distinct (user_id, course_version_id, item_id, block_id, attempt_no),
  foreign key (course_version_id, item_id)
    references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.submission_files (
  submission_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_id text not null references public.media_assets(id),
  name text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  mime text not null,
  primary key (submission_id, asset_id),
  foreign key (submission_id, user_id)
    references public.assignment_submissions(id, user_id) on delete cascade
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  grader_id uuid references public.profiles(id) on delete set null,
  rubric_scores jsonb not null default '{}',
  total_points numeric(9,2) not null check (total_points >= 0 and total_points <= 1000000),
  max_points numeric(9,2) not null check (max_points >= 0 and max_points <= 1000000),
  feedback jsonb not null default '{}',
  decision text not null check (decision in ('approved', 'changes_requested')),
  graded_at timestamptz not null default now(),
  released boolean not null default false,
  check (total_points <= max_points),
  foreign key (submission_id, user_id)
    references public.assignment_submissions(id, user_id) on delete cascade
);

create table public.course_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null references public.courses(id) on delete cascade,
  course_version_id uuid not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, course_id),
  foreign key (course_version_id, course_id)
    references public.course_versions(id, course_id)
);

create index enrollments_user_id on public.enrollments (user_id);
create index enrollments_course_id on public.enrollments (course_id);
create index enrollments_course_version_id on public.enrollments (course_version_id);
create index enrollments_user_version_active on public.enrollments (user_id, course_version_id)
  where status in ('active', 'completed');
create index lesson_progress_user_version on public.lesson_progress (user_id, course_version_id);
create index lesson_progress_version_item on public.lesson_progress (course_version_id, item_id);
create index activity_state_version_item on public.activity_state (course_version_id, item_id);
create index quiz_attempts_version_item on public.quiz_attempts (course_version_id, item_id);
create index exam_attempts_user_version_item_status
  on public.exam_attempts (user_id, course_version_id, item_id, status);
create index exam_attempts_version_item on public.exam_attempts (course_version_id, item_id);
create index exam_grades_version_item on public.exam_grades (course_version_id, item_id);
create index exam_attempt_events_attempt_id on public.exam_attempt_events (attempt_id);
create index exam_attempt_events_user_id on public.exam_attempt_events (user_id);
create index exam_answers_user_id on public.exam_answers (user_id);
create index exam_answers_graded_by on public.exam_answers (graded_by);
create index assignment_submissions_version_item
  on public.assignment_submissions (course_version_id, item_id);
create index assignment_submissions_status_submitted_at
  on public.assignment_submissions (status, submitted_at);
create index submission_files_user_id on public.submission_files (user_id);
create index submission_files_asset_id on public.submission_files (asset_id);
create index grades_user_id on public.grades (user_id);
create index grades_grader_id on public.grades (grader_id);
create index course_completions_course_id on public.course_completions (course_id);
create index course_completions_course_version_id on public.course_completions (course_version_id);
create index exam_attempts_in_progress_deadline on public.exam_attempts (deadline_at)
  where status = 'in_progress';
create unique index exam_attempts_one_active
  on public.exam_attempts (user_id, course_version_id, item_id)
  where status = 'in_progress';

create or replace function public.exam_start_attempt(
  p_id uuid,
  p_user_id uuid,
  p_course_version_id uuid,
  p_item_id text,
  p_question_set jsonb,
  p_grading_snapshot jsonb,
  p_started_at timestamptz,
  p_deadline_at timestamptz,
  p_attempts_allowed integer
)
returns public.exam_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admitted public.exam_attempts;
  attempts_used integer;
begin
  if p_attempts_allowed < 1 then
    raise exception using errcode = 'P3001', message = 'NO_ATTEMPTS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || ':' || p_course_version_id::text || ':' || p_item_id,
    0
  ));

  select attempt.* into admitted
  from public.exam_attempts as attempt
  where attempt.user_id = p_user_id
    and attempt.course_version_id = p_course_version_id
    and attempt.item_id = p_item_id
    and attempt.status = 'in_progress'
  order by attempt.attempt_no
  limit 1;
  if found then return admitted; end if;

  select count(*)::integer into attempts_used
  from public.exam_attempts as attempt
  where attempt.user_id = p_user_id
    and attempt.course_version_id = p_course_version_id
    and attempt.item_id = p_item_id;
  if attempts_used >= p_attempts_allowed then
    raise exception using errcode = 'P3001', message = 'NO_ATTEMPTS';
  end if;

  insert into public.exam_attempts (
    id, user_id, course_version_id, item_id, attempt_no, status, late,
    question_set, grading_snapshot, started_at, deadline_at
  ) values (
    p_id, p_user_id, p_course_version_id, p_item_id, attempts_used + 1,
    'in_progress', false, p_question_set, p_grading_snapshot, p_started_at, p_deadline_at
  ) returning * into admitted;
  return admitted;
end;
$$;

revoke all on function public.exam_start_attempt(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz, timestamptz, integer) from public;
revoke all on function public.exam_start_attempt(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz, timestamptz, integer) from anon, authenticated;
grant execute on function public.exam_start_attempt(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz, timestamptz, integer) to service_role;

create or replace function public.exam_append_attempt_events(
  p_attempt_id uuid,
  p_events jsonb,
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt_user_id uuid;
  existing_count integer;
  accepted_count integer;
begin
  if jsonb_typeof(p_events) <> 'array' or p_limit < 0 then
    raise exception 'invalid exam event batch';
  end if;

  select attempt.user_id into attempt_user_id
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then raise exception 'exam attempt not found'; end if;

  select count(*)::integer into existing_count
  from public.exam_attempt_events as event
  where event.attempt_id = p_attempt_id;
  accepted_count := greatest(0, least(jsonb_array_length(p_events), least(p_limit, 500) - existing_count));

  insert into public.exam_attempt_events (id, attempt_id, user_id, type, at, meta)
  select
    (entry.value ->> 'id')::uuid,
    p_attempt_id,
    attempt_user_id,
    entry.value ->> 'type',
    coalesce((entry.value ->> 'at')::timestamptz, now()),
    coalesce(entry.value -> 'meta', '{}'::jsonb)
  from jsonb_array_elements(p_events) with ordinality as entry(value, position)
  where entry.position <= accepted_count;

  return accepted_count;
end;
$$;

revoke all on function public.exam_append_attempt_events(uuid, jsonb, integer) from public;
revoke all on function public.exam_append_attempt_events(uuid, jsonb, integer) from anon, authenticated;
grant execute on function public.exam_append_attempt_events(uuid, jsonb, integer) to service_role;

create or replace function public.can_access_course(p_course_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.courses c join public.course_version_outline o on o.version_id = c.current_version_id
    where c.id = p_course_id and c.status = 'published'
      and (o.access->>'scope' = 'global' or exists (select 1 from public.profiles p where p.id = auth.uid() and p.branch_id is not null and o.access->'branchIds' ? p.branch_id))
  )
$$;

revoke all on function public.can_access_course(text) from public;
grant execute on function public.can_access_course(text) to authenticated;

alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.activity_state enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
alter table public.exam_attempt_events enable row level security;
alter table public.exam_grades enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.grades enable row level security;
alter table public.course_completions enable row level security;

create policy "outline readable when accessible" on public.course_version_outline
  for select to authenticated using (public.can_access_course(course_id));

create policy "renders readable when enrolled" on public.course_version_item_renders
  for select to authenticated using (exists (
    select 1
    from public.enrollments e
    join public.course_version_items cvi
      on cvi.version_id = course_version_item_renders.version_id
      and cvi.item_id = course_version_item_renders.item_id
    where e.user_id = (select auth.uid())
      and e.course_version_id = course_version_item_renders.version_id
      and e.status in ('active', 'completed')
      and cvi.kind <> 'exam'
  ));

create policy "own enrollments" on public.enrollments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own lesson progress" on public.lesson_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own activity state" on public.activity_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own quiz attempts" on public.quiz_attempts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own assignment submissions" on public.assignment_submissions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own submission files" on public.submission_files
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own course completions" on public.course_completions
  for select to authenticated using ((select auth.uid()) = user_id);
