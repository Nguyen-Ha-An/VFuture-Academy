-- Resource ownership is fixed at insertion; equal-document retries cannot transfer drafts.
create or replace function public.cms_assign_ownership(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_ownership_kind text,
  p_owner_branch_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_snapshot jsonb; fine_permission text; resource_row public.resources%rowtype;
begin
  if p_content_type = 'media_asset' and not exists (select 1 from public.media_assets where id=p_content_id and bucket='media' and purpose='content') then
    raise exception using errcode='42501', message='CMS_OWNERSHIP_ASSIGNMENT_DENIED';
  end if;
  if p_ownership_kind is null or (p_ownership_kind = 'central' and p_owner_branch_id is not null)
    or (p_ownership_kind = 'branch' and p_owner_branch_id is null)
    or p_ownership_kind not in ('central', 'branch') then
    raise exception using errcode = '22023', message = 'CMS_OWNERSHIP_INVALID';
  end if;
  fine_permission := case p_content_type when 'course' then 'course.create' when 'bank_question' then 'bank.edit'
    when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
    when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id,'content.create',p_ownership_kind,p_owner_branch_id)
    and not public.authorization_has_permission(p_actor_user_id,fine_permission,p_ownership_kind,p_owner_branch_id) then
    raise exception using errcode='42501',message='Permission denied';
  end if;
  -- Resource creation persists creator and workspace atomically. Assignment is
  -- only an idempotent acknowledgment; it must never transfer an existing row.
  -- Lock before inspecting ownership and review/publication history so competing
  -- assignment and authoring calls serialize on the content row.
  if p_content_type = 'resource' then
    select * into resource_row from public.resources where id=p_content_id for update;
    if not found or resource_row.status <> 'draft'
      or resource_row.owner_id is distinct from p_actor_user_id
      or resource_row.ownership_kind is distinct from p_ownership_kind
      or resource_row.owner_branch_id is distinct from p_owner_branch_id then
      raise exception using errcode='42501', message='CMS_OWNERSHIP_ASSIGNMENT_DENIED';
    end if;
  end if;
  if exists (select 1 from public.cms_review_requests where content_type=p_content_type and content_id=p_content_id)
    or exists (select 1 from public.cms_publications where content_type=p_content_type and content_id=p_content_id) then
    raise exception using errcode = '55000', message = 'CMS_OWNERSHIP_LOCKED';
  end if;
  case p_content_type
    when 'course' then update public.courses set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'bank_question' then update public.bank_questions set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'resource' then update public.resources set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id
      where id=p_content_id and status='draft' and owner_id=p_actor_user_id
        and ownership_kind=p_ownership_kind and owner_branch_id is not distinct from p_owner_branch_id;
    when 'opportunity' then update public.opportunities set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft' and created_by=p_actor_user_id;
    when 'project' then update public.projects set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and approved=false;
    when 'media_asset' then update public.media_assets set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and owner_id=p_actor_user_id;
    else raise exception using errcode='22023',message='CMS_CONTENT_TYPE_INVALID';
  end case;
  if not found then raise exception using errcode='42501',message='CMS_OWNERSHIP_ASSIGNMENT_DENIED'; end if;
  current_snapshot := public.cms_current_snapshot(p_content_type,p_content_id);
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after,branch_id)
  values(p_actor_user_id,'content.ownership.assign',p_content_type,p_content_id,null,
    jsonb_build_object('ownershipKind',p_ownership_kind,'ownerBranchId',p_owner_branch_id),p_owner_branch_id);
  return jsonb_build_object('content_type',p_content_type,'content_id',p_content_id,'ownership_kind',p_ownership_kind,'owner_branch_id',p_owner_branch_id);
end;
$$;
revoke all on function public.cms_assign_ownership(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.cms_assign_ownership(uuid,text,text,text,text) to service_role;
