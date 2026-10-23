create extension if not exists pgcrypto;

create table public.branches (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null,
  city text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  display_name text not null default '',
  avatar_url text,
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  branch_id text references public.branches(id),
  profile_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('contributor', 'editor', 'instructor', 'branch_lead', 'admin')),
  branch_id text references public.branches(id),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  unique nulls not distinct (user_id, role, branch_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.branches enable row level security;
create policy "branches readable" on public.branches
  for select to authenticated using (true);

alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);
-- Public profile projection arrives in Plan 4 through a security_invoker view exposing only (id, handle, display_name, avatar_url).
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and branch_id is not distinct from (
      select branch_id from public.profiles p where p.id = auth.uid()
    )
  );

create or replace function public.prevent_self_branch_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id and new.branch_id is distinct from old.branch_id then
    raise exception 'A learner cannot change their own branch assignment';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_self_branch_change() from public;
create trigger profiles_prevent_self_branch_change
  before update on public.profiles
  for each row execute function public.prevent_self_branch_change();

alter table public.user_roles enable row level security;
create policy "own roles" on public.user_roles
  for select using (auth.uid() = user_id);

insert into public.branches (id, name, city) values
  ('vinsmc', 'VinSMC', 'Hà Nội'),
  ('ans', 'ANS', 'Hà Nội'),
  ('dewey', 'Dewey Schools', 'Hà Nội');
