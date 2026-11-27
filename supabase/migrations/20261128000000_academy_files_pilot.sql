create table public.resource_files_pilot (
  resource_id text primary key references public.resources(id) on delete restrict,
  operation_id uuid not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  file_name text not null check (length(file_name) between 1 and 120),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  title text not null check (length(title) between 1 and 180),
  file_id uuid unique,
  release_id uuid unique,
  release_url text,
  withdrawn boolean not null default false,
  check (release_id is null or file_id is not null),
  check (not withdrawn or (release_id is not null and release_url is null)),
  check (release_url is null or
    (release_id is not null and release_url = 'https://files.vfuturelabs.org/r/academy-' || resource_id || '/v1'))
);

alter table public.resource_files_pilot enable row level security;
revoke all on table public.resource_files_pilot from public, anon, authenticated;
grant select, insert, update on table public.resource_files_pilot to service_role;
