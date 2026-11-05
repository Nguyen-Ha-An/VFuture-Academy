-- School-specific teaching data is private and accessed through authorized server routes.
insert into public.permission_registry(permission, group_name, scope_kind) values
  ('teaching.announcement.manage', 'grading', 'any'),
  ('teaching.schedule.manage', 'grading', 'any');

-- Built-in definitions are normally immutable; this forward migration extends only
-- the teacher and central administrator capabilities, preserving existing grants.
alter table public.role_definitions disable trigger role_definitions_protect_built_in;
update public.role_definitions
set permissions = permissions || array['teaching.announcement.manage','teaching.schedule.manage']
where id in ('teacher', 'central_admin');
alter table public.role_definitions enable trigger role_definitions_protect_built_in;

create table public.teaching_announcements (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  course_id text not null references public.courses(id),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
create index teaching_announcements_school_course on public.teaching_announcements(branch_id, course_id, status, published_at desc);
alter table public.teaching_announcements enable row level security;
revoke all on public.teaching_announcements from anon, authenticated;
grant select, insert, update, delete on public.teaching_announcements to service_role;

create table public.assignment_schedules (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  course_version_id uuid not null,
  item_id text not null,
  block_id text,
  due_at timestamptz,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  foreign key (course_version_id, item_id) references public.course_version_items(version_id, item_id),
  unique nulls not distinct (branch_id, course_version_id, item_id, block_id)
);
create index assignment_schedules_due on public.assignment_schedules(branch_id, due_at) where due_at is not null;
alter table public.assignment_schedules enable row level security;
revoke all on public.assignment_schedules from anon, authenticated;
grant select, insert, update, delete on public.assignment_schedules to service_role;

alter table public.assignment_submissions add column due_at_snapshot timestamptz;
alter table public.assignment_submissions add column late boolean;

-- Existing branch-history trigger runs first by name. Unknown schools stay unknown;
-- old rows and duplicate RPC retries are never touched.
create function public.snapshot_assignment_deadline() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.branch_scope_known and new.branch_id is not null then
    select schedule.due_at into new.due_at_snapshot
    from public.assignment_schedules schedule
    where schedule.branch_id = new.branch_id
      and schedule.course_version_id = new.course_version_id
      and schedule.item_id = new.item_id
      and schedule.block_id is not distinct from new.block_id;
  end if;
  new.late := case when new.due_at_snapshot is null then null
    else new.submitted_at > new.due_at_snapshot end;
  return new;
end;
$$;
revoke all on function public.snapshot_assignment_deadline() from public, anon, authenticated;
create trigger zz_assignment_submissions_snapshot_deadline
  before insert on public.assignment_submissions
  for each row execute function public.snapshot_assignment_deadline();

create function public.protect_assignment_deadline_snapshot() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.due_at_snapshot is distinct from old.due_at_snapshot or new.late is distinct from old.late then
    raise exception 'Submission deadline snapshot is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_assignment_deadline_snapshot() from public, anon, authenticated;
create trigger assignment_submissions_protect_deadline
  before update on public.assignment_submissions
  for each row execute function public.protect_assignment_deadline_snapshot();

-- Audit metadata and state transitions in the same transaction as each write;
-- never copy announcement text into the audit log.
create function public.audit_teaching_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  target text;
  action_name text;
  before_value jsonb;
  after_value jsonb;
begin
  if tg_table_name = 'teaching_announcements' then
    target := 'teaching_announcement';
    action_name := case when tg_op = 'INSERT' then 'create'
      when old.status is distinct from new.status then new.status else 'edit' end;
    before_value := case when tg_op = 'INSERT' then null else jsonb_build_object('status',old.status) end;
    after_value := jsonb_build_object('branchId',new.branch_id,'courseId',new.course_id,'status',new.status);
  else
    target := 'assignment_schedule';
    action_name := 'update';
    before_value := case when tg_op = 'INSERT' then null else jsonb_build_object('dueAt',old.due_at) end;
    after_value := jsonb_build_object('branchId',new.branch_id,'courseVersionId',new.course_version_id,'itemId',new.item_id,'blockId',new.block_id,'dueAt',new.due_at);
  end if;
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
  values(new.updated_by,'teaching.' || case when target = 'teaching_announcement' then 'announcement' else 'schedule' end || '.' || action_name,target,new.id::text,before_value,after_value);
  return new;
end;
$$;
revoke all on function public.audit_teaching_change() from public, anon, authenticated;
create trigger teaching_announcements_audit after insert or update on public.teaching_announcements
  for each row execute function public.audit_teaching_change();
create trigger assignment_schedules_audit after insert or update on public.assignment_schedules
  for each row execute function public.audit_teaching_change();

create function public.delete_teaching_announcement(p_id uuid,p_actor_id uuid) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare deleted public.teaching_announcements%rowtype;
begin
  delete from public.teaching_announcements where id=p_id and status='draft' returning * into deleted;
  if not found then return false; end if;
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
  values(p_actor_id,'teaching.announcement.delete','teaching_announcement',p_id::text,
    jsonb_build_object('branchId',deleted.branch_id,'courseId',deleted.course_id,'status',deleted.status),null);
  return true;
end;
$$;
revoke all on function public.delete_teaching_announcement(uuid,uuid) from public, anon, authenticated;
grant execute on function public.delete_teaching_announcement(uuid,uuid) to service_role;
-- Invoker triggers and the delete RPC need only append access to the audit log.
grant insert on public.audit_log to service_role;
grant usage on sequence public.audit_log_id_seq to service_role;
