-- Forward-only ecosystem and completion-effects schema migration. All writes use
-- service-role route handlers; authenticated clients receive only the explicit reads below.
-- owner_id deliberately uses the default NO ACTION behavior: owned resources and
-- projects must be reassigned before a profile can be deleted.

create table public.resources (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  document jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  owner_id uuid not null references public.profiles(id),
  published_at timestamptz,
  branch_scope jsonb not null default '{"scope":"global"}'::jsonb
    check (branch_scope->>'scope' in ('global', 'branches')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The simple config does not normalize Vietnamese diacritics; unaccent remains
  -- a Plan 4 hardening follow-up.
  search tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(document #>> '{title,vi}', '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(document #>> '{title,en}', '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(document #>> '{summary,vi}', '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(document #>> '{summary,en}', '')), 'B')
  ) stored
);

create table public.opportunities (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title jsonb not null,
  organization text not null,
  type text not null check (type in ('course', 'workshop', 'event', 'research_cohort', 'competition', 'hackathon', 'project', 'team_opening', 'mentorship', 'leadership_role', 'external_program')),
  description jsonb not null,
  eligibility jsonb not null default '{}',
  recommended_skills text[] not null default '{}',
  recommended_courses text[] not null default '{}',
  required_courses text[] not null default '{}',
  application_url text,
  internal_application boolean not null default false,
  open_at timestamptz,
  close_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  online boolean not null default false,
  branch_scope jsonb not null default '{"scope":"global"}'::jsonb
    check (branch_scope->>'scope' in ('global', 'branches')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (close_at >= open_at),
  check (end_at >= start_at)
);

create table public.opportunity_interest (
  opportunity_id text not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (opportunity_id, user_id)
);

create table public.projects (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title jsonb not null,
  summary jsonb not null,
  status text not null default 'idea' check (status in ('idea', 'forming', 'active', 'completed', 'showcased', 'published')),
  output_links jsonb not null default '[]',
  skills text[] not null default '{}',
  course_ids text[] not null default '{}',
  owner_id uuid not null references public.profiles(id),
  cover_asset_id text references public.media_assets(id),
  branch_scope jsonb not null default '{"scope":"global"}'::jsonb
    check (branch_scope->>'scope' in ('global', 'branches')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'member', 'mentor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.project_interest (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.skills (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name jsonb not null,
  category text not null check (category in ('ai', 'technology', 'research', 'entrepreneurship', 'fintech', 'core-skills', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skill_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  level text not null check (level in ('exposed', 'applied', 'demonstrated')),
  evidence_type text not null check (evidence_type in ('course_completion', 'exam_passed', 'assignment_approved', 'project_contribution', 'mentor_review', 'competition_result')),
  ref_type text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, skill_id, evidence_type, ref_id)
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null references public.courses(id),
  course_version_id uuid not null,
  serial text not null unique,
  issued_at timestamptz not null default now(),
  pdf_asset_id text references public.media_assets(id) on delete set null,
  verification_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, course_version_id),
  foreign key (course_version_id, course_id)
    references public.course_versions(id, course_id)
);

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  points numeric(9,2) not null check (points >= 0 and points <= 9999999.99),
  ref_type text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, ref_type, ref_id)
);

create table public.streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak int not null default 0 check (current_streak >= 0),
  longest_streak int not null default 0 check (longest_streak >= 0),
  last_active_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_streak <= longest_streak)
);

create table public.analytics_events (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  props jsonb not null default '{}',
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resources_owner_id on public.resources (owner_id);
create index resources_search on public.resources using gin (search);
create index resources_published_at on public.resources (published_at desc) where status = 'published';
create index resources_branch_scope on public.resources using gin (branch_scope jsonb_path_ops);
create index resources_document on public.resources using gin (document jsonb_path_ops);
create index opportunities_published_at on public.opportunities (published_at desc) where status = 'published';
create index opportunities_branch_scope on public.opportunities using gin (branch_scope jsonb_path_ops);
create index opportunities_recommended_courses on public.opportunities using gin (recommended_courses);
create index opportunity_interest_user_id on public.opportunity_interest (user_id);
create index projects_owner_id on public.projects (owner_id);
create index projects_cover_asset_id on public.projects (cover_asset_id);
create index projects_published_at on public.projects (published_at desc) where status = 'published';
create index projects_branch_scope on public.projects using gin (branch_scope jsonb_path_ops);
create index projects_skills on public.projects using gin (skills);
create index projects_course_ids on public.projects using gin (course_ids);
create index project_members_user_id on public.project_members (user_id);
create index project_interest_user_id on public.project_interest (user_id);
create index skill_evidence_skill_id on public.skill_evidence (skill_id);
create index certificates_course_id on public.certificates (course_id);
create index certificates_course_version_id on public.certificates (course_version_id);
create index certificates_pdf_asset_id on public.certificates (pdf_asset_id);
create index xp_events_user_created_at on public.xp_events (user_id, created_at desc);
create index analytics_events_user_id on public.analytics_events (user_id);
create index analytics_events_name_at on public.analytics_events (name, at);

create or replace function public.current_branch_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.branch_id
  from public.profiles p
  where p.id = (select auth.uid())
$$;

revoke all on function public.current_branch_id() from public;
grant execute on function public.current_branch_id() to authenticated;

alter table public.resources enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_interest enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_interest enable row level security;
alter table public.skills enable row level security;
alter table public.skill_evidence enable row level security;
alter table public.certificates enable row level security;
alter table public.xp_events enable row level security;
alter table public.streaks enable row level security;
alter table public.analytics_events enable row level security;

create policy "published resources readable when scoped" on public.resources
  for select to authenticated using (status = 'published' and (branch_scope->>'scope' = 'global' or branch_scope->'branchIds' ? (select public.current_branch_id())));
create policy "published opportunities readable when scoped" on public.opportunities
  for select to authenticated using (status = 'published' and (branch_scope->>'scope' = 'global' or branch_scope->'branchIds' ? (select public.current_branch_id())));
create policy "own opportunity interest" on public.opportunity_interest
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "published projects readable when scoped" on public.projects
  for select to authenticated using (status = 'published' and (branch_scope->>'scope' = 'global' or branch_scope->'branchIds' ? (select public.current_branch_id())));
create policy "own project memberships" on public.project_members
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own project interest" on public.project_interest
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "skills readable" on public.skills
  for select to authenticated using (true);
create policy "own skill evidence" on public.skill_evidence
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own certificates" on public.certificates
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own xp events" on public.xp_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own streak" on public.streaks
  for select to authenticated using ((select auth.uid()) = user_id);
