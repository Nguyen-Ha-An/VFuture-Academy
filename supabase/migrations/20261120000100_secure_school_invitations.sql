-- The management RPCs retain their existing scope, role, and target checks.
-- A grant beyond Teacher also needs current, non-compatibility delegation.
create function public.admin_has_nonlegacy_school_delegation(p_actor_id uuid, p_branch_id text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select public.authorization_has_permission(p_actor_id, 'role.assignment.global', 'central', null)
    or exists (
      select 1 from public.role_assignments assignment
      join public.role_definitions definition on definition.id = assignment.role_definition_id
      join public.branch_memberships membership
        on membership.user_id = assignment.user_id and membership.branch_id = assignment.branch_id
      join public.user_accounts account on account.user_id = assignment.user_id
      where assignment.user_id = p_actor_id and assignment.branch_id = p_branch_id
        and account.status = 'active' and membership.status = 'active'
        and definition.id not like 'legacy%' and 'role.assignment.branch' = any(definition.permissions)
    )
$$;
revoke all on function public.admin_has_nonlegacy_school_delegation(uuid,text) from public, anon, authenticated, service_role;

alter function public.admin_management_write(uuid,text,text,text,jsonb) rename to admin_management_write_before_school_invitations;
revoke all on function public.admin_management_write_before_school_invitations(uuid,text,text,text,jsonb) from public, anon, authenticated, service_role;

create function public.admin_management_write(p_actor_id uuid, p_scope_kind text, p_branch_id text, p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_school text := p_input->>'branchId';
begin
  if target_school is not null and p_input->>'roleId' <> 'teacher'
    and (p_operation = 'invitation.create' or (p_operation = 'user.role' and (p_input->>'enabled')::boolean)) then
    perform pg_advisory_xact_lock(hashtextextended('vfuture.authorization.mutations', 0));
    if not public.admin_has_nonlegacy_school_delegation(p_actor_id, target_school) then
      raise insufficient_privilege;
    end if;
  end if;
  return public.admin_management_write_before_school_invitations(p_actor_id, p_scope_kind, p_branch_id, p_operation, p_input);
end $$;

alter function public.admin_management_read(uuid,text,text,text,jsonb) rename to admin_management_read_before_school_invitations;
revoke all on function public.admin_management_read_before_school_invitations(uuid,text,text,text,jsonb) from public, anon, authenticated, service_role;

create function public.admin_management_read(p_actor_id uuid, p_scope_kind text, p_branch_id text, p_operation text, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  result := public.admin_management_read_before_school_invitations(p_actor_id, p_scope_kind, p_branch_id, p_operation, p_input);
  if p_operation = 'options' and p_scope_kind = 'branch'
    and not public.admin_has_nonlegacy_school_delegation(p_actor_id, p_branch_id) then
    result := jsonb_set(result, '{roles}', jsonb_path_query_array(result->'roles', '$[*] ? (@.id == "teacher")'));
  end if;
  return result;
end $$;

create or replace function public.admin_accept_invitation(p_user_id uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invite public.admin_invitations%rowtype;
  role_row public.role_definitions%rowtype;
  user_email text;
  primary_branch text;
  learner_invitation boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('vfuture.authorization.mutations', 0));
  select * into invite from public.admin_invitations where token_hash = p_token_hash for update;
  if not found or invite.accepted_at is not null or invite.revoked_at is not null or invite.expires_at <= now() then
    raise no_data_found;
  end if;
  select lower(u.email), p.branch_id into user_email, primary_branch
    from auth.users u join public.profiles p on p.id = u.id
    join public.user_accounts a on a.user_id = p.id and a.status = 'active'
    where u.id = p_user_id for update of p for share of a;
  if not found or user_email is distinct from invite.email then raise insufficient_privilege; end if;

  perform public.authorization_assert_actor(invite.created_by, 'membership.manage', 'branch', invite.branch_id);
  learner_invitation := invite.role_definition_id is null or invite.role_definition_id = 'member';
  if learner_invitation and primary_branch is not null and primary_branch <> invite.branch_id then raise invalid_parameter_value; end if;
  if invite.role_definition_id is not null then
    select * into role_row from public.role_definitions where id = invite.role_definition_id for share;
    if not found or role_row.scope_kind <> 'branch' or role_row.id like 'legacy%' or role_row.version is distinct from invite.role_version then
      raise insufficient_privilege;
    end if;
    perform public.authorization_assert_actor(invite.created_by, 'role.assignment.branch', 'branch', invite.branch_id);
    if public.authorization_has_permission(invite.created_by, 'role.assignment.global', 'central', null) then
      if exists (select 1 from unnest(role_row.permissions) permission
        where not public.authorization_has_permission(invite.created_by, permission, 'branch', invite.branch_id)) then
        raise insufficient_privilege;
      end if;
    elsif not role_row.school_grantable or role_row.id = 'school_admin' or (not learner_invitation and p_user_id = invite.created_by)
      or (role_row.id <> 'teacher' and not public.admin_has_nonlegacy_school_delegation(invite.created_by, invite.branch_id)) then
      raise insufficient_privilege;
    end if;
  end if;

  -- The conflict predicate examines the locked membership. Reinstatement belongs
  -- to the explicit membership-status operation, including when staff grants remain.
  insert into public.branch_memberships as membership (user_id, branch_id, status, created_by, updated_by)
    values (p_user_id, invite.branch_id, 'active', invite.created_by, invite.created_by)
    on conflict (user_id, branch_id) do update set updated_at = now(), updated_by = excluded.updated_by
    where membership.status = 'active';
  if not found then raise insufficient_privilege; end if;

  if learner_invitation then
    update public.profiles set branch_id = invite.branch_id, updated_at = now() where id = p_user_id;
  else
    insert into public.role_assignments(user_id, role_definition_id, branch_id, granted_by)
      values (p_user_id, invite.role_definition_id, invite.branch_id, invite.created_by)
      on conflict (user_id, role_definition_id, branch_id) do nothing;
  end if;
  update public.admin_invitations set accepted_at = now(), accepted_by = p_user_id where id = invite.id;
  insert into public.audit_log(actor_id, action, target_type, target_id, after, branch_id)
    values (p_user_id, 'invitation.accepted', 'user', p_user_id::text,
      jsonb_build_object('invitationId', invite.id, 'branchId', invite.branch_id, 'roleId', invite.role_definition_id), invite.branch_id);
  return jsonb_build_object('accepted', true, 'branchId', invite.branch_id);
end $$;

revoke all on function public.admin_management_read(uuid,text,text,text,jsonb), public.admin_management_write(uuid,text,text,text,jsonb), public.admin_accept_invitation(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_management_read(uuid,text,text,text,jsonb), public.admin_management_write(uuid,text,text,text,jsonb), public.admin_accept_invitation(uuid,text) to service_role;
