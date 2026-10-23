-- Forward-only content schema migration. Published snapshots must not be edited or deleted;
-- corrections are represented by a new course/question version. This migration is irreversible
-- without data loss once content or publish history exists, so no down migration is provided.

create table public.courses (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  slug text unique,
  owner_id uuid not null references public.profiles(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_drafts (
  id uuid primary key default gen_random_uuid(),
  course_id text not null unique references public.courses(id) on delete cascade,
  manifest jsonb not null,
  base_version_id uuid,
  checklist jsonb not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.course_draft_items (
  draft_id uuid not null references public.course_drafts(id) on delete cascade,
  item_id text not null,
  kind text not null check (kind in ('lesson', 'exam', 'assignment')),
  document jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (draft_id, item_id)
);

create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  version int not null,
  manifest jsonb not null,
  checksum text not null,
  summary jsonb not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  notes text,
  unique (course_id, version)
);

alter table public.courses
  add constraint courses_current_version_fk foreign key (current_version_id) references public.course_versions(id);

-- Published item source and server-only grading are separate from learner-safe render payloads.
-- Answer keys never belong in course_version_item_renders.payload.
create table public.course_version_items (
  version_id uuid not null references public.course_versions(id) on delete cascade,
  item_id text not null,
  kind text not null,
  source jsonb not null,
  grading jsonb not null,
  checksum text not null,
  primary key (version_id, item_id)
);

create table public.course_version_item_renders (
  version_id uuid not null,
  item_id text not null,
  locale text not null check (locale in ('vi', 'en')),
  payload jsonb not null,
  primary key (version_id, item_id, locale),
  foreign key (version_id, item_id) references public.course_version_items(version_id, item_id) on delete cascade
);

create table public.course_version_outline (
  version_id uuid primary key references public.course_versions(id) on delete cascade,
  course_id text not null,
  outline jsonb not null,
  meta jsonb not null,
  access jsonb not null,
  completion jsonb not null,
  skills jsonb not null,
  languages text[] not null,
  default_language text not null
);

create table public.publish_events (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  version_id uuid not null,
  actor_id uuid not null,
  checklist jsonb not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table public.media_assets (
  id text primary key,
  owner_id uuid not null,
  bucket text not null,
  path text not null,
  mime text not null,
  size_bytes bigint not null,
  width int,
  height int,
  alt jsonb,
  created_at timestamptz not null default now()
);

create table public.bank_questions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  owner_id uuid not null,
  type text not null,
  tags text[] not null default '{}',
  difficulty text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version_id uuid,
  languages text[] not null default '{vi}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bank_question_versions (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references public.bank_questions(id) on delete cascade,
  version int not null,
  payload jsonb not null,
  renders jsonb not null,
  grading jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (question_id, version)
);

create index bank_questions_tags on public.bank_questions using gin (tags);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- All content data remains server-only. Plan 3 introduces narrowly scoped read policies for
-- published outlines and learner-safe renders via can_access_course; no permissive policy exists here.
alter table public.courses enable row level security;
alter table public.course_drafts enable row level security;
alter table public.course_draft_items enable row level security;
alter table public.course_versions enable row level security;
alter table public.course_version_items enable row level security;
alter table public.course_version_item_renders enable row level security;
alter table public.course_version_outline enable row level security;
alter table public.publish_events enable row level security;
alter table public.media_assets enable row level security;
alter table public.bank_questions enable row level security;
alter table public.bank_question_versions enable row level security;
alter table public.audit_log enable row level security;

-- Storage operator contract (do not apply manually to a hosted project):
-- media is private; editors upload to it. submissions is private; learners upload only to userId/… prefixes.
-- certificates is public-read. Provision the three buckets and their policies with the corresponding deployment plan.
