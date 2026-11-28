-- Provider journal for the server-mediated standalone assignment pilot.
create table public.academy_assignment_files (
  operation_id uuid primary key,
  asset_id text not null unique check (asset_id ~ '^asset_[A-Za-z0-9]+$'),
  owner_id uuid not null,
  course_id text not null,
  course_version_id uuid not null,
  item_id text not null,
  branch_id text,
  filename text not null check (filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  source_ref text not null check (source_ref ~ '^assignment/[a-f0-9]{64}$'),
  file_id uuid unique,
  cancelled_at timestamptz,
  expires_at timestamptz not null default now() + interval '15 minutes',
  foreign key (course_version_id, item_id) references public.course_version_items(version_id, item_id)
);
alter table public.academy_assignment_files enable row level security;
revoke all on public.academy_assignment_files from public, anon, authenticated;
grant select, insert, update on public.academy_assignment_files to service_role;

create function public.academy_assignment_file_complete(p_owner uuid, p_operation uuid, p_file uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare entry public.academy_assignment_files%rowtype;
begin
  select * into entry from public.academy_assignment_files
    where operation_id = p_operation and owner_id = p_owner for update;
  if not found or p_file is null then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if entry.file_id is not null then
    if entry.file_id <> p_file then raise exception 'UPLOAD_CONFLICT'; end if;
    return to_jsonb(entry);
  end if;
  if entry.cancelled_at is not null or entry.expires_at <= now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if not exists (
    select 1 from public.enrollments
      where user_id = p_owner and course_id = entry.course_id and course_version_id = entry.course_version_id
        and status in ('active', 'completed') and branch_scope_known is true
        and branch_id is not distinct from entry.branch_id
  ) then raise exception 'UPLOAD_NOT_FOUND'; end if;
  insert into public.media_assets(id, owner_id, bucket, path, purpose, item_id, mime, size_bytes)
    values(entry.asset_id, p_owner, 'submissions', p_owner || '/vfuture-files/' || p_operation,
      'submission', entry.item_id, 'application/pdf', entry.size_bytes);
  update public.academy_assignment_files set file_id = p_file where operation_id = p_operation returning * into entry;
  return to_jsonb(entry);
end;
$$;
revoke execute on function public.academy_assignment_file_complete(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.academy_assignment_file_complete(uuid, uuid, uuid) to service_role;

-- Validate the relationship inside the existing assignment submission transaction.
create function public.academy_assignment_file_check_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.media_assets a
      where a.id = new.asset_id and split_part(a.path, '/', 2) = 'vfuture-files'
  ) then return new; end if;
  if not exists (
    select 1 from public.academy_assignment_files f
    join public.assignment_submissions s on s.id = new.submission_id and s.user_id = f.owner_id
      and s.course_version_id = f.course_version_id and s.item_id = f.item_id
      and s.block_id is null and s.branch_scope_known is true and s.branch_id is not distinct from f.branch_id
    where f.asset_id = new.asset_id and f.owner_id = new.user_id and f.file_id is not null
  ) then raise exception 'INVALID_SUBMISSION_FILE'; end if;
  return new;
end;
$$;
revoke execute on function public.academy_assignment_file_check_scope() from public, anon, authenticated;
grant execute on function public.academy_assignment_file_check_scope() to service_role;
create trigger academy_assignment_file_scope before insert or update on public.submission_files
  for each row execute function public.academy_assignment_file_check_scope();
