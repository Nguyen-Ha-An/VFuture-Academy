-- Central/school authorization and point-in-time branch history foundation.
-- This migration is additive. Legacy user_roles rows are migrated once, then
-- frozen so every subsequent authorization decision uses persisted definitions,
-- assignments, memberships, and account status.

create table public.permission_registry (
  permission text primary key check (permission ~ '^[a-z][a-z0-9_.]*$'),
  group_name text not null,
  scope_kind text not null check (scope_kind in ('any', 'central'))
);

insert into public.permission_registry(permission, group_name, scope_kind) values
  ('admin.access', 'admin', 'any'),
  ('member.read', 'members', 'any'),
  ('member.manage', 'members', 'any'),
  ('membership.manage', 'members', 'any'),
  ('role.definition.read', 'roles', 'any'),
  ('role.definition.manage', 'roles', 'central'),
  ('role.assignment.global', 'roles', 'central'),
  ('role.assignment.branch', 'roles', 'any'),
  ('branch.read', 'branches', 'any'),
  ('branch.manage', 'branches', 'central'),
  ('content.read', 'content', 'any'),
  ('content.create', 'content', 'any'),
  ('content.edit', 'content', 'any'),
  ('content.review.request', 'content', 'any'),
  ('content.review', 'content', 'central'),
  ('content.publish', 'content', 'central'),
  ('learning.read', 'grading', 'any'),
  ('grading.read', 'grading', 'any'),
  ('grading.manage', 'grading', 'any'),
  ('submission.grade', 'grading', 'any'),
  ('exam.release', 'grading', 'any'),
  ('report.branch.read', 'reporting', 'any'),
  ('report.global.read', 'reporting', 'central'),
  ('audit.read', 'audit', 'any'),
  ('course.read', 'legacy-content', 'any'),
  ('course.create', 'legacy-content', 'any'),
  ('course.edit', 'legacy-content', 'any'),
  ('course.publish', 'legacy-content', 'central'),
  ('course.delete', 'legacy-content', 'central'),
  ('bank.edit', 'legacy-content', 'any'),
  ('bank.publish', 'legacy-content', 'central'),
  ('media.upload', 'legacy-content', 'any'),
  ('resource.edit', 'legacy-content', 'any'),
  ('resource.publish', 'legacy-content', 'central'),
  ('opportunity.edit', 'legacy-content', 'any'),
  ('opportunity.publish', 'legacy-content', 'central'),
  ('project.edit', 'legacy-content', 'any'),
  ('user.manage.branch', 'legacy-admin', 'any'),
  ('user.manage.global', 'legacy-admin', 'central'),
  ('analytics.branch.read', 'legacy-reporting', 'any'),
  ('analytics.global.read', 'legacy-reporting', 'central');

create table public.user_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and suspended_at is null)
    or (status = 'suspended' and suspended_at is not null)
  )
);

create table public.branch_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id text not null references public.branches(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, branch_id)
);

create table public.role_definitions (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  scope_kind text not null check (scope_kind in ('central', 'branch')),
  permissions text[] not null default '{}',
  built_in boolean not null default false,
  school_grantable boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (cardinality(permissions) <= 64),
  check (not school_grantable or scope_kind = 'branch')
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_definition_id text not null references public.role_definitions(id),
  branch_id text references public.branches(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique nulls not distinct (user_id, role_definition_id, branch_id)
);

create table public.authorization_guard (
  id boolean primary key default true check (id),
  touched_at timestamptz not null default now()
);
insert into public.authorization_guard(id) values (true);

create or replace function public.validate_role_definition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from unnest(new.permissions) requested(permission)
    left join public.permission_registry registry using (permission)
    where registry.permission is null
  ) then
    raise exception using errcode = '22023', message = 'Role definition contains an unknown permission';
  end if;

  if (select count(*) from unnest(new.permissions))
      <> (select count(distinct permission) from unnest(new.permissions) requested(permission)) then
    raise exception using errcode = '22023', message = 'Role definition contains duplicate permissions';
  end if;

  if new.scope_kind = 'branch' and exists (
    select 1
    from unnest(new.permissions) requested(permission)
    join public.permission_registry registry using (permission)
    where registry.scope_kind = 'central'
  ) then
    raise exception using errcode = '22023', message = 'Branch roles cannot contain central-only permissions';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_role_definition() from public;
create trigger role_definitions_validate
  before insert or update on public.role_definitions
  for each row execute function public.validate_role_definition();

insert into public.role_definitions(
  id, name, description, scope_kind, permissions, built_in, school_grantable
) values
  (
    'central_admin', 'Central Admin', 'Full global administration.', 'central',
    (select array_agg(permission order by permission) from public.permission_registry), true, false
  ),
  (
    'central_reviewer', 'Central Reviewer', 'Read, review, and publish CMS content.', 'central',
    array['admin.access','content.read','content.review','content.publish','course.read','course.publish','bank.publish','resource.publish','opportunity.publish'],
    true, false
  ),
  (
    'central_editor', 'Central Editor', 'Create and edit CMS content and request review.', 'central',
    array['admin.access','content.read','content.create','content.edit','content.review.request','course.read','course.create','course.edit','bank.edit','media.upload','resource.edit','opportunity.edit','project.edit'],
    true, false
  ),
  (
    'school_admin', 'School Admin', 'Manage school members, approved roles, progress summaries, reports, and audit.', 'branch',
    array['admin.access','member.read','member.manage','membership.manage','role.definition.read','role.assignment.branch','branch.read','learning.read','report.branch.read','audit.read','user.manage.branch','analytics.branch.read'],
    true, true
  ),
  (
    'school_editor', 'School Editor', 'Create and edit school content and request review.', 'branch',
    array['admin.access','branch.read','content.read','content.create','content.edit','content.review.request','course.read','course.create','course.edit','bank.edit','media.upload','resource.edit','opportunity.edit','project.edit'],
    true, true
  ),
  (
    'teacher', 'Teacher', 'Read learning data, grade, manage exams, and view school reports.', 'branch',
    array['admin.access','branch.read','learning.read','grading.read','grading.manage','submission.grade','exam.release','report.branch.read','analytics.branch.read'],
    true, true
  ),
  ('member', 'Member', 'No administration access.', 'branch', '{}', true, true),

  -- These non-grantable definitions preserve the exact effective capabilities
  -- of pre-foundation tuples. Branch legacy roles intentionally retain no
  -- central publish permission.
  ('legacy_contributor_central', 'Legacy contributor (central)', '', 'central', array['admin.access','resource.edit'], true, false),
  ('legacy_editor_central', 'Legacy editor (central)', '', 'central', array['admin.access','content.read','content.create','content.edit','content.review.request','course.read','course.create','course.edit','bank.edit','bank.publish','media.upload','resource.edit','resource.publish','opportunity.edit','opportunity.publish','project.edit'], true, false),
  ('legacy_instructor_central', 'Legacy instructor (central)', '', 'central', array['admin.access','learning.read','grading.read','grading.manage','report.branch.read','course.read','submission.grade','exam.release','analytics.branch.read'], true, false),
  ('legacy_branch_lead_central', 'Legacy branch lead (central)', '', 'central', array['admin.access','member.read','membership.manage','role.definition.read','role.assignment.branch','learning.read','grading.read','grading.manage','report.branch.read','audit.read','course.read','submission.grade','exam.release','analytics.branch.read','user.manage.branch','opportunity.edit'], true, false),
  ('legacy_contributor_branch', 'Legacy contributor (branch)', '', 'branch', '{}', true, false),
  ('legacy_editor_branch', 'Legacy editor (branch)', '', 'branch', '{}', true, false),
  ('legacy_instructor_branch', 'Legacy instructor (branch)', '', 'branch', array['admin.access','learning.read','grading.read','grading.manage','report.branch.read','submission.grade','exam.release','analytics.branch.read'], true, false),
  ('legacy_branch_lead_branch', 'Legacy branch lead (branch)', '', 'branch', array['admin.access','member.read','membership.manage','role.definition.read','role.assignment.branch','learning.read','grading.read','grading.manage','report.branch.read','audit.read','submission.grade','exam.release','analytics.branch.read','user.manage.branch'], true, false),
  ('legacy_admin_branch', 'Legacy admin (branch)', '', 'branch', array['admin.access','member.read','membership.manage','role.definition.read','role.assignment.branch','learning.read','grading.read','grading.manage','report.branch.read','audit.read','submission.grade','exam.release','user.manage.branch','analytics.branch.read'], true, false);

create or replace function public.protect_built_in_role_definition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.built_in then
    raise exception using errcode = '42501', message = 'Cannot modify a built-in role definition';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_built_in_role_definition() from public;
create trigger role_definitions_protect_built_in
  before update or delete on public.role_definitions
  for each row execute function public.protect_built_in_role_definition();

insert into public.user_accounts(user_id)
select profile.id from public.profiles profile
on conflict (user_id) do nothing;

insert into public.branch_memberships(user_id, branch_id)
select profile.id, profile.branch_id
from public.profiles profile
where profile.branch_id is not null
union
select role_row.user_id, role_row.branch_id
from public.user_roles role_row
where role_row.branch_id is not null
on conflict (user_id, branch_id) do nothing;

create or replace function public.initialize_user_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_accounts(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_user_account() from public;
create trigger profiles_initialize_user_account
  after insert on public.profiles
  for each row execute function public.initialize_user_account();

create or replace function public.validate_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  definition_scope text;
begin
  select definition.scope_kind into strict definition_scope
  from public.role_definitions definition
  where definition.id = new.role_definition_id;

  if definition_scope = 'central' and new.branch_id is not null then
    raise exception using errcode = '22023', message = 'Central role assignments cannot carry a branch';
  end if;
  if definition_scope = 'branch' and new.branch_id is null then
    raise exception using errcode = '22023', message = 'Branch role assignments require a branch';
  end if;
  if definition_scope = 'branch' and not exists (
    select 1 from public.branch_memberships membership
    where membership.user_id = new.user_id
      and membership.branch_id = new.branch_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Branch role assignment requires active membership';
  end if;
  if not exists (
    select 1 from public.user_accounts account
    where account.user_id = new.user_id and account.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Cannot assign a role to a suspended account';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_role_assignment() from public;
create trigger role_assignments_validate
  before insert or update on public.role_assignments
  for each row execute function public.validate_role_assignment();

insert into public.role_assignments(user_id, role_definition_id, branch_id, granted_by, granted_at)
select
  legacy.user_id,
  case
    when legacy.role = 'admin' and legacy.branch_id is null then 'central_admin'
    when legacy.branch_id is null then 'legacy_' || legacy.role || '_central'
    when legacy.role = 'admin' then 'legacy_admin_branch'
    else 'legacy_' || legacy.role || '_branch'
  end,
  legacy.branch_id,
  legacy.granted_by,
  legacy.granted_at
from public.user_roles legacy
on conflict (user_id, role_definition_id, branch_id) do nothing;

create or replace function public.lock_and_assert_central_admin_remains(p_excluded_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  remaining_admins integer;
begin
  perform guard.id
  from public.authorization_guard guard
  where guard.id = true
  for update;

  select count(distinct assignment.user_id)::integer into remaining_admins
  from public.role_assignments assignment
  join public.user_accounts account on account.user_id = assignment.user_id
  where assignment.role_definition_id = 'central_admin'
    and assignment.branch_id is null
    and account.status = 'active'
    and assignment.user_id <> p_excluded_user_id;

  if remaining_admins = 0 then
    raise exception using errcode = '23514', message = 'Cannot revoke or suspend the final global admin';
  end if;
end;
$$;

revoke all on function public.lock_and_assert_central_admin_remains(uuid) from public;

create or replace function public.protect_final_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role_definition_id = 'central_admin'
    and old.branch_id is null
    and (
      tg_op = 'DELETE'
      or new.role_definition_id <> old.role_definition_id
      or new.branch_id is distinct from old.branch_id
      or new.user_id <> old.user_id
    ) then
    perform public.lock_and_assert_central_admin_remains(old.user_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_final_admin_assignment() from public;
create trigger role_assignments_protect_final_admin
  before update or delete on public.role_assignments
  for each row execute function public.protect_final_admin_assignment();

create or replace function public.protect_final_admin_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'active'
    and (tg_op = 'DELETE' or new.status = 'suspended')
    and exists (
      select 1 from public.role_assignments assignment
      where assignment.user_id = old.user_id
        and assignment.role_definition_id = 'central_admin'
        and assignment.branch_id is null
    ) then
    perform public.lock_and_assert_central_admin_remains(old.user_id);
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'suspended' and old.status <> 'suspended' then
      new.suspended_at := coalesce(new.suspended_at, now());
    elsif new.status = 'active' then
      new.suspended_at := null;
      new.suspended_by := null;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_final_admin_account() from public;
create trigger user_accounts_protect_final_admin
  before update or delete on public.user_accounts
  for each row execute function public.protect_final_admin_account();

create or replace function public.prevent_legacy_user_role_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '55000', message = 'Legacy user_roles is read-only; use role_assignments';
end;
$$;

revoke all on function public.prevent_legacy_user_role_write() from public;
create trigger user_roles_read_only
  before insert or update or delete on public.user_roles
  for each row execute function public.prevent_legacy_user_role_write();

create or replace function public.authorization_actor(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  account_status text;
  memberships jsonb;
  assignments jsonb;
begin
  select account.status into account_status
  from public.user_accounts account
  where account.user_id = p_user_id;
  if account_status is null then
    raise exception using errcode = '23503', message = 'Authorization account is missing';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('branchId', membership.branch_id, 'status', membership.status)
    order by membership.branch_id
  ), '[]'::jsonb) into memberships
  from public.branch_memberships membership
  where membership.user_id = p_user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'roleDefinitionId', assignment.role_definition_id,
      'scope', case
        when assignment.branch_id is null then jsonb_build_object('kind', 'central')
        else jsonb_build_object('kind', 'branch', 'branchId', assignment.branch_id)
      end,
      'permissions', to_jsonb(definition.permissions)
    ) order by assignment.role_definition_id, assignment.branch_id nulls first
  ), '[]'::jsonb) into assignments
  from public.role_assignments assignment
  join public.role_definitions definition on definition.id = assignment.role_definition_id
  where assignment.user_id = p_user_id;

  return jsonb_build_object(
    'accountStatus', account_status,
    'memberships', memberships,
    'assignments', assignments
  );
end;
$$;

create or replace function public.authorization_has_permission(
  p_user_id uuid,
  p_permission text,
  p_scope_kind text,
  p_branch_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_scope_kind in ('central', 'branch')
    and ((p_scope_kind = 'central' and p_branch_id is null)
      or (p_scope_kind = 'branch' and p_branch_id is not null))
    and exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment on assignment.user_id = account.user_id
      join public.role_definitions definition on definition.id = assignment.role_definition_id
      join public.permission_registry registry on registry.permission = p_permission
      where account.user_id = p_user_id
        and account.status = 'active'
        and p_permission = any(definition.permissions)
        and not (p_scope_kind = 'central' and definition.id = 'legacy_branch_lead_central'
          and p_permission = any(array['member.read','membership.manage','role.definition.read','role.assignment.branch','audit.read']))
        and (
          (definition.scope_kind = 'central' and assignment.branch_id is null)
          or (
            p_scope_kind = 'branch'
            and definition.scope_kind = 'branch'
            and assignment.branch_id = p_branch_id
            and registry.scope_kind = 'any'
            and exists (
              select 1 from public.branch_memberships membership
              where membership.user_id = account.user_id
                and membership.branch_id = assignment.branch_id
                and membership.status = 'active'
            )
          )
        )
    )
$$;

create or replace function public.authorization_assert_actor(
  p_actor_user_id uuid,
  p_permission text,
  p_scope_kind text,
  p_branch_id text default null
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.authorization_has_permission(
    p_actor_user_id, p_permission, p_scope_kind, p_branch_id
  ) then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;
end;
$$;

revoke all on function public.authorization_actor(uuid) from public;
revoke all on function public.authorization_actor(uuid) from anon, authenticated;
grant execute on function public.authorization_actor(uuid) to service_role;
revoke all on function public.authorization_has_permission(uuid, text, text, text) from public;
revoke all on function public.authorization_has_permission(uuid, text, text, text) from anon, authenticated;
grant execute on function public.authorization_has_permission(uuid, text, text, text) to service_role;
revoke all on function public.authorization_assert_actor(uuid, text, text, text) from public;
revoke all on function public.authorization_assert_actor(uuid, text, text, text) from anon, authenticated;
grant execute on function public.authorization_assert_actor(uuid, text, text, text) to service_role;

alter table public.enrollments
  add column branch_id text references public.branches(id),
  add column branch_scope_known boolean not null default false,
  add column branch_scope_source text not null default 'unknown'
    check (branch_scope_source in ('unknown', 'profile_at_enrollment'));

alter table public.assignment_submissions
  add column branch_id text references public.branches(id),
  add column branch_scope_known boolean not null default false,
  add column branch_scope_source text not null default 'unknown'
    check (branch_scope_source in ('unknown', 'enrollment_snapshot'));

alter table public.exam_attempts
  add column branch_id text references public.branches(id),
  add column branch_scope_known boolean not null default false,
  add column branch_scope_source text not null default 'unknown'
    check (branch_scope_source in ('unknown', 'enrollment_snapshot'));

alter table public.analytics_events
  add column branch_id text references public.branches(id),
  add column branch_scope_known boolean not null default false,
  add column branch_scope_source text not null default 'unknown'
    check (branch_scope_source in ('unknown', 'profile_at_event'));

create or replace function public.stamp_enrollment_branch_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.branch_id is distinct from old.branch_id
      or new.branch_scope_known is distinct from old.branch_scope_known
      or new.branch_scope_source is distinct from old.branch_scope_source then
      raise exception using errcode = '55000', message = 'Historical branch scope is immutable';
    end if;
    return new;
  end if;

  select profile.branch_id into new.branch_id
  from public.profiles profile where profile.id = new.user_id;
  new.branch_scope_known := new.branch_id is not null;
  new.branch_scope_source := case when new.branch_scope_known
    then 'profile_at_enrollment' else 'unknown' end;
  return new;
end;
$$;

revoke all on function public.stamp_enrollment_branch_history() from public;
create trigger enrollments_stamp_branch_history
  before insert or update on public.enrollments
  for each row execute function public.stamp_enrollment_branch_history();

create or replace function public.stamp_enrollment_derived_branch_history()
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
  new.branch_scope_known := coalesce(enrollment_known, false);
  new.branch_scope_source := case when new.branch_scope_known
    then 'enrollment_snapshot' else 'unknown' end;
  return new;
end;
$$;

revoke all on function public.stamp_enrollment_derived_branch_history() from public;
create trigger assignment_submissions_stamp_branch_history
  before insert or update on public.assignment_submissions
  for each row execute function public.stamp_enrollment_derived_branch_history();
create trigger exam_attempts_stamp_branch_history
  before insert or update on public.exam_attempts
  for each row execute function public.stamp_enrollment_derived_branch_history();

create or replace function public.stamp_analytics_branch_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.branch_id is distinct from old.branch_id
      or new.branch_scope_known is distinct from old.branch_scope_known
      or new.branch_scope_source is distinct from old.branch_scope_source then
      raise exception using errcode = '55000', message = 'Historical branch scope is immutable';
    end if;
    return new;
  end if;

  select profile.branch_id into new.branch_id
  from public.profiles profile where profile.id = new.user_id;
  new.branch_scope_known := new.branch_id is not null;
  new.branch_scope_source := case when new.branch_scope_known
    then 'profile_at_event' else 'unknown' end;
  return new;
end;
$$;

revoke all on function public.stamp_analytics_branch_history() from public;
create trigger analytics_events_stamp_branch_history
  before insert or update on public.analytics_events
  for each row execute function public.stamp_analytics_branch_history();

create or replace function public.enforce_active_account_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.user_accounts account
    where account.user_id = new.user_id and account.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Account is suspended';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_active_account_write() from public;
create trigger enrollments_require_active_account before insert or update on public.enrollments
  for each row execute function public.enforce_active_account_write();
create trigger lesson_progress_require_active_account before insert or update on public.lesson_progress
  for each row execute function public.enforce_active_account_write();
create trigger activity_state_require_active_account before insert or update on public.activity_state
  for each row execute function public.enforce_active_account_write();
create trigger quiz_attempts_require_active_account before insert or update on public.quiz_attempts
  for each row execute function public.enforce_active_account_write();
create trigger exam_attempts_require_active_account before insert or update on public.exam_attempts
  for each row execute function public.enforce_active_account_write();
create trigger exam_answers_require_active_account before insert or update on public.exam_answers
  for each row execute function public.enforce_active_account_write();
create trigger exam_attempt_events_require_active_account before insert or update on public.exam_attempt_events
  for each row execute function public.enforce_active_account_write();
create trigger assignment_submissions_require_active_account before insert or update on public.assignment_submissions
  for each row execute function public.enforce_active_account_write();
create trigger submission_files_require_active_account before insert or update on public.submission_files
  for each row execute function public.enforce_active_account_write();
create trigger analytics_events_require_active_account before insert or update on public.analytics_events
  for each row execute function public.enforce_active_account_write();

create index branch_memberships_branch_status_user
  on public.branch_memberships(branch_id, status, user_id);
create index role_assignments_user_id on public.role_assignments(user_id);
create index role_assignments_definition_branch on public.role_assignments(role_definition_id, branch_id);
create index enrollments_branch_history on public.enrollments(branch_id, course_version_id)
  where branch_scope_known;
create index assignment_submissions_branch_history
  on public.assignment_submissions(branch_id, course_version_id, item_id)
  where branch_scope_known;
create index exam_attempts_branch_history
  on public.exam_attempts(branch_id, course_version_id, item_id)
  where branch_scope_known;
create index analytics_events_branch_history on public.analytics_events(branch_id, at)
  where branch_scope_known;

alter table public.permission_registry enable row level security;
alter table public.user_accounts enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.authorization_guard enable row level security;

revoke all on table public.permission_registry from anon, authenticated;
revoke all on table public.user_accounts from anon, authenticated;
revoke all on table public.branch_memberships from anon, authenticated;
revoke all on table public.role_definitions from anon, authenticated;
revoke all on table public.role_assignments from anon, authenticated;
revoke all on table public.authorization_guard from anon, authenticated;
revoke insert, update, delete on table public.user_roles from anon, authenticated;

grant select on table public.permission_registry to service_role;
grant select, insert, update, delete on table public.user_accounts to service_role;
grant select, insert, update, delete on table public.branch_memberships to service_role;
grant select, insert, update, delete on table public.role_definitions to service_role;
grant select, insert, update, delete on table public.role_assignments to service_role;
