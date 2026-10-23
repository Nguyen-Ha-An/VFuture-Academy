-- Keep the original CMS inventory implementation available while applying the
-- purpose boundary after media_assets gained its server-assigned purpose.
alter function public.cms_list_content(uuid, text, text)
  rename to cms_list_content_unfiltered;

create or replace function public.cms_list_content(
  p_actor_user_id uuid, p_scope_kind text, p_branch_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  raw jsonb;
begin
  raw := public.cms_list_content_unfiltered(p_actor_user_id, p_scope_kind, p_branch_id);
  return coalesce((
    select jsonb_agg(
      case when entry ->> 'content_type' = 'media_asset'
        then jsonb_set(entry, '{studio_href}', to_jsonb('/studio/media'::text))
        when entry ->> 'content_type' = 'bank_question'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/bank/' || (entry ->> 'content_id'))::text))
        when entry ->> 'content_type' = 'resource'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/library?type=resource&id=' || (entry ->> 'content_id'))::text))
        when entry ->> 'content_type' = 'opportunity'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/library?type=opportunity&id=' || (entry ->> 'content_id'))::text))
        when entry ->> 'content_type' = 'project'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/library?type=project&id=' || (entry ->> 'content_id'))::text))
        else entry
      end
      order by ordinal
    )
    from jsonb_array_elements(raw) with ordinality as items(entry, ordinal)
    where entry ->> 'content_type' <> 'media_asset'
      or exists (
        select 1 from public.media_assets asset
        where asset.id = entry ->> 'content_id'
          and asset.purpose = 'content'
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.cms_list_content(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_list_content(uuid, text, text) to service_role;
-- The legacy implementation is callable only by this SECURITY DEFINER wrapper;
-- clients cannot bypass the purpose filter through its renamed entry point.
revoke all on function public.cms_list_content_unfiltered(uuid, text, text) from public, anon, authenticated, service_role;

-- Non-content assets cannot enter new CMS ownership or dependency graphs.
create or replace function public.cms_snapshot_dependencies(
  p_source jsonb,
  p_ownership_kind text,
  p_owner_branch_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  dependency jsonb;
  dependency_id text;
  dependency_row record;
  dependencies jsonb := '[]'::jsonb;
begin
  for dependency in select distinct value from jsonb_path_query(p_source, 'strict $.**.assetId') value
  loop
    dependency_id := dependency #>> '{}';
    select asset.id, asset.ownership_kind, asset.owner_branch_id,
      encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex') revision_key
    into dependency_row
    from public.media_assets asset where asset.id = dependency_id and asset.purpose = 'content';
    if not found then
      raise exception using errcode = '23503', message = 'CMS_ASSET_NOT_FOUND';
    end if;
    if dependency_row.ownership_kind = 'branch'
      and (p_ownership_kind <> 'branch' or dependency_row.owner_branch_id is distinct from p_owner_branch_id) then
      raise exception using errcode = '42501', message = 'CMS_FOREIGN_ASSET';
    end if;
    dependencies := dependencies || jsonb_build_array(jsonb_build_object(
      'kind', 'asset', 'id', dependency_id, 'revision_key', dependency_row.revision_key
    ));
  end loop;

  for dependency in select distinct value
    from jsonb_path_query(p_source, 'strict $.**."$ref"') value
    where value #>> '{}' like 'bank:%'
  loop
    dependency_id := substring(dependency #>> '{}' from 6);
    select question.ownership_kind, question.owner_branch_id, version.id::text revision_key
    into dependency_row
    from public.bank_questions question
    join lateral (
      select candidate.id from public.bank_question_versions candidate
      where candidate.question_id = question.id order by candidate.version desc limit 1
    ) version on true
    where question.id = dependency_id;
    if not found then
      raise exception using errcode = '23503', message = 'CMS_BANK_VERSION_NOT_FOUND';
    end if;
    if dependency_row.ownership_kind = 'branch'
      and (p_ownership_kind <> 'branch' or dependency_row.owner_branch_id is distinct from p_owner_branch_id) then
      raise exception using errcode = '42501', message = 'CMS_FOREIGN_BANK_QUESTION';
    end if;
    dependencies := dependencies || jsonb_build_array(jsonb_build_object(
      'kind', 'bank_version', 'id', dependency_id, 'revision_key', dependency_row.revision_key
    ));
  end loop;
  return dependencies;
end;
$$;
revoke all on function public.cms_snapshot_dependencies(jsonb, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_content_access(p_actor_user_id uuid, p_content_type text, p_content_id text, p_permission text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare current_snapshot jsonb; fine_permission text;
begin
  if p_permission not in ('content.read','content.edit','content.review.request') then raise exception using errcode='22023',message='CMS_PERMISSION_INVALID'; end if;
  if p_content_type = 'media_asset' and not exists (select 1 from public.media_assets where id=p_content_id and bucket='media' and purpose='content') then raise exception using errcode='42501',message='Permission denied'; end if;
  current_snapshot := public.cms_current_snapshot(p_content_type,p_content_id);
  fine_permission := case p_content_type when 'course' then case when p_permission='content.read' then 'course.read' else 'course.edit' end when 'bank_question' then 'bank.edit' when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit' when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id,p_permission,current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id') and not public.authorization_has_permission(p_actor_user_id,fine_permission,current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id') then raise exception using errcode='42501',message='Permission denied'; end if;
end; $$;
revoke all on function public.cms_assert_content_access(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cms_assert_content_access(uuid,text,text,text) to service_role;

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
declare current_snapshot jsonb; fine_permission text;
begin
  if p_content_type = 'media_asset' and not exists (select 1 from public.media_assets where id=p_content_id and bucket='media' and purpose='content') then
    raise exception using errcode='42501', message='CMS_OWNERSHIP_ASSIGNMENT_DENIED';
  end if;
  if (p_ownership_kind = 'central' and p_owner_branch_id is not null)
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
  if exists (select 1 from public.cms_review_requests where content_type=p_content_type and content_id=p_content_id)
    or exists (select 1 from public.cms_publications where content_type=p_content_type and content_id=p_content_id) then
    raise exception using errcode = '55000', message = 'CMS_OWNERSHIP_LOCKED';
  end if;
  case p_content_type
    when 'course' then update public.courses set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'bank_question' then update public.bank_questions set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'resource' then update public.resources set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
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
