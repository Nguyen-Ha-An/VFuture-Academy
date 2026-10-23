-- Studio workflow state, pending-review mutation locks, and atomic approval/publication.

alter table public.cms_review_requests
  drop constraint if exists cms_review_requests_status_check;
alter table public.cms_review_requests
  add constraint cms_review_requests_status_check check (status in (
    'pending', 'changes_requested', 'approved', 'stale', 'withdrawn', 'published'
  ));

alter table public.cms_content_drafts
  drop constraint if exists cms_content_drafts_content_type_check;
alter table public.cms_content_drafts
  add constraint cms_content_drafts_content_type_check
  check (content_type in ('resource', 'opportunity', 'project', 'media_asset'));

create or replace function public.cms_lock_content(p_content_type text, p_content_id text)
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended(p_content_type || chr(31) || p_content_id, 918273));
$$;
revoke all on function public.cms_lock_content(text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_revision_matches(p_content_type text, p_left text, p_right text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_left is null or p_right is null then return p_left is not distinct from p_right; end if;
  if p_content_type in ('course', 'resource', 'opportunity', 'project') then
    return p_left::timestamptz = p_right::timestamptz;
  end if;
  return p_left = p_right;
exception when invalid_datetime_format then
  return false;
end;
$$;
revoke all on function public.cms_revision_matches(text, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_lock_content_source(p_content_type text, p_content_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare locked_draft_id uuid;
begin
  perform public.cms_lock_content(p_content_type, p_content_id);
  case p_content_type
    when 'course' then
      perform 1 from public.courses where id = p_content_id for update;
      select id into locked_draft_id from public.course_drafts where course_id = p_content_id for update;
      perform 1 from public.course_draft_items where draft_id = locked_draft_id order by item_id for update;
    when 'bank_question' then
      perform 1 from public.bank_questions where id = p_content_id for update;
      perform 1 from public.bank_question_versions where question_id = p_content_id order by version for update;
    when 'resource' then perform 1 from public.resources where id = p_content_id for update;
    when 'opportunity' then perform 1 from public.opportunities where id = p_content_id for update;
    when 'project' then
      perform 1 from public.projects where id = p_content_id for update;
      perform 1 from public.project_members where project_id = p_content_id order by user_id for update;
    when 'media_asset' then perform 1 from public.media_assets where id = p_content_id for update;
    else raise exception using errcode = '22023', message = 'CMS_CONTENT_TYPE_INVALID';
  end case;
  perform 1 from public.cms_content_drafts
    where content_type = p_content_type and content_id = p_content_id for update;
end;
$$;
revoke all on function public.cms_lock_content_source(text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_not_pending(p_content_type text, p_content_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.cms_lock_content(p_content_type, p_content_id);
  if exists (
    select 1 from public.cms_review_requests
    where content_type = p_content_type and content_id = p_content_id and status = 'pending'
  ) then
    raise exception using errcode = '55000', message = 'CMS_REVIEW_PENDING';
  end if;
end;
$$;
revoke all on function public.cms_assert_not_pending(text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_guard_pending_content_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  content_type text;
  content_id text;
  draft_id uuid;
begin
  case tg_table_name
    when 'courses' then content_type := 'course'; content_id := row_data->>'id';
    when 'course_drafts' then content_type := 'course'; content_id := row_data->>'course_id';
    when 'course_draft_items' then
      content_type := 'course';
      draft_id := (row_data->>'draft_id')::uuid;
      select course_id into content_id from public.course_drafts where id = draft_id;
    when 'bank_questions' then content_type := 'bank_question'; content_id := row_data->>'id';
    when 'bank_question_versions' then content_type := 'bank_question'; content_id := row_data->>'question_id';
    when 'resources' then content_type := 'resource'; content_id := row_data->>'id';
    when 'opportunities' then content_type := 'opportunity'; content_id := row_data->>'id';
    when 'projects' then content_type := 'project'; content_id := row_data->>'id';
    when 'project_members' then content_type := 'project'; content_id := row_data->>'project_id';
    when 'media_assets' then content_type := 'media_asset'; content_id := row_data->>'id';
    when 'cms_content_drafts' then content_type := row_data->>'content_type'; content_id := row_data->>'content_id';
    else raise exception using errcode = '22023', message = 'CMS_CONTENT_TYPE_INVALID';
  end case;
  if nullif(content_id, '') is not null then
    perform public.cms_assert_not_pending(content_type, content_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.cms_guard_pending_content_mutation() from public, anon, authenticated, service_role;

create trigger courses_cms_pending_guard before update or delete on public.courses
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger course_drafts_cms_pending_guard before insert or update or delete on public.course_drafts
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger course_draft_items_cms_pending_guard before insert or update or delete on public.course_draft_items
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger bank_questions_cms_pending_guard before update or delete on public.bank_questions
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger bank_question_versions_cms_pending_guard before insert or update or delete on public.bank_question_versions
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger resources_cms_pending_guard before update or delete on public.resources
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger opportunities_cms_pending_guard before update or delete on public.opportunities
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger projects_cms_pending_guard before update or delete on public.projects
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger project_members_cms_pending_guard before insert or update or delete on public.project_members
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger media_assets_cms_pending_guard before update or delete on public.media_assets
  for each row execute function public.cms_guard_pending_content_mutation();
create trigger cms_content_drafts_pending_guard before insert or update or delete on public.cms_content_drafts
  for each row execute function public.cms_guard_pending_content_mutation();

alter function public.cms_current_snapshot(text, text)
  rename to cms_current_snapshot_pre_workflow;
revoke all on function public.cms_current_snapshot_pre_workflow(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.cms_current_snapshot(p_content_type text, p_content_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if p_content_type <> 'media_asset' then
    return public.cms_current_snapshot_pre_workflow(p_content_type, p_content_id);
  end if;
  select jsonb_build_object(
    'revision_key', coalesce(draft.revision_key,
      encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex')),
    'has_draft', draft.content_id is not null,
    'ownership_kind', asset.ownership_kind,
    'owner_branch_id', asset.owner_branch_id,
    'audience', '{}',
    'source', coalesce(draft.source, jsonb_build_object('asset', to_jsonb(asset)))
  ) into result
  from public.media_assets asset
  left join public.cms_content_drafts draft
    on draft.content_type = 'media_asset' and draft.content_id = asset.id
  where asset.id = p_content_id;
  if result is null then raise exception using errcode = 'P0002', message = 'CMS_CONTENT_NOT_FOUND'; end if;
  return result;
end;
$$;
revoke all on function public.cms_current_snapshot(text, text) from public, anon, authenticated, service_role;

alter function public.cms_snapshot_dependencies(jsonb, text, text)
  rename to cms_snapshot_dependencies_pre_workflow;
revoke all on function public.cms_snapshot_dependencies_pre_workflow(jsonb, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.cms_snapshot_dependencies(
  p_source jsonb, p_ownership_kind text, p_owner_branch_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare dependencies jsonb; cover_id text; dependency_row record; dependency jsonb; dependency_index integer;
begin
  dependencies := public.cms_snapshot_dependencies_pre_workflow(
    p_source, p_ownership_kind, p_owner_branch_id
  );
  if jsonb_array_length(dependencies) > 0 then
    for dependency_index in 0..jsonb_array_length(dependencies)-1 loop
      dependency := dependencies->dependency_index;
      if dependency->>'kind' = 'asset' then
        select asset.ownership_kind, asset.owner_branch_id into dependency_row
        from public.media_assets asset where asset.id = dependency->>'id';
      elsif dependency->>'kind' = 'bank_version' then
        select question.ownership_kind, question.owner_branch_id into dependency_row
        from public.bank_questions question where question.id = dependency->>'id';
      else
        continue;
      end if;
      dependencies := jsonb_set(dependencies, array[dependency_index::text], dependency || jsonb_build_object(
        'ownership_kind', dependency_row.ownership_kind, 'owner_branch_id', dependency_row.owner_branch_id
      ));
    end loop;
  end if;
  cover_id := nullif(p_source->'record'->>'cover_asset_id', '');
  if cover_id is null or exists (
    select 1 from jsonb_array_elements(dependencies) dep_entry
    where dep_entry->>'kind' = 'asset' and dep_entry->>'id' = cover_id
  ) then return dependencies; end if;
  select asset.ownership_kind, asset.owner_branch_id,
    encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex') revision_key
  into dependency_row from public.media_assets asset where asset.id = cover_id;
  if not found then raise exception using errcode = '23503', message = 'CMS_ASSET_NOT_FOUND'; end if;
  if dependency_row.ownership_kind = 'branch'
    and (p_ownership_kind <> 'branch' or dependency_row.owner_branch_id is distinct from p_owner_branch_id) then
    raise exception using errcode = '42501', message = 'CMS_FOREIGN_ASSET';
  end if;
  return dependencies || jsonb_build_array(jsonb_build_object(
    'kind', 'asset', 'id', cover_id, 'revision_key', dependency_row.revision_key,
    'ownership_kind', dependency_row.ownership_kind, 'owner_branch_id', dependency_row.owner_branch_id
  ));
end;
$$;
revoke all on function public.cms_snapshot_dependencies(jsonb, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_dependency_ownership(
  p_dependencies jsonb, p_ownership_kind text, p_owner_branch_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare dependency jsonb; pinned jsonb; current_kind text; current_branch text;
begin
  for dependency in select value from jsonb_array_elements(coalesce(p_dependencies, '[]'::jsonb)) loop
    if dependency->>'kind' = 'asset' then
      select ownership_kind, owner_branch_id into current_kind, current_branch
      from public.media_assets where id = dependency->>'id';
    elsif dependency->>'kind' = 'bank_version' then
      select ownership_kind, owner_branch_id into current_kind, current_branch
      from public.bank_questions where id = dependency->>'id';
    elsif dependency->>'kind' = 'notebook' then
      for pinned in select value from jsonb_array_elements(coalesce(dependency->'assets', '[]'::jsonb)) loop
        select ownership_kind, owner_branch_id into current_kind, current_branch
        from public.media_assets where id = pinned->>'id';
        if current_kind is null
          or (current_kind = 'branch' and (p_ownership_kind <> 'branch' or current_branch is distinct from p_owner_branch_id)) then
          raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
        end if;
      end loop;
      continue;
    else
      continue;
    end if;
    if current_kind is null
      or (dependency ? 'ownership_kind' and dependency->>'ownership_kind' is distinct from current_kind)
      or (dependency ? 'owner_branch_id' and dependency->>'owner_branch_id' is distinct from current_branch)
      or (current_kind = 'branch' and (p_ownership_kind <> 'branch' or current_branch is distinct from p_owner_branch_id)) then
      raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
    end if;
  end loop;
end;
$$;
revoke all on function public.cms_assert_dependency_ownership(jsonb, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_review_candidate(
  p_actor_user_id uuid, p_content_type text, p_content_id text, p_expected_revision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb;
begin
  candidate := public.cms_current_snapshot(p_content_type, p_content_id);
  perform public.authorization_assert_actor(
    p_actor_user_id, 'content.review.request', candidate->>'ownership_kind', candidate->>'owner_branch_id'
  );
  if p_expected_revision is not null
    and not public.cms_revision_matches(p_content_type, candidate->>'revision_key', p_expected_revision) then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  return candidate;
end;
$$;
revoke all on function public.cms_review_candidate(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cms_review_candidate(uuid, text, text, text) to service_role;

alter function public.cms_save_content_draft(uuid, text, text, text, jsonb, jsonb)
  rename to cms_save_content_draft_pre_workflow;
revoke all on function public.cms_save_content_draft_pre_workflow(uuid, text, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.cms_save_content_draft(
  p_actor_user_id uuid, p_content_type text, p_content_id text,
  p_expected_revision text, p_source jsonb, p_audience jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_snapshot jsonb; next_revision text; fine_permission text;
begin
  if p_content_type not in ('resource', 'opportunity', 'project', 'media_asset')
    or jsonb_typeof(p_source) <> 'object' then
    raise exception using errcode = '22023', message = 'CMS_DRAFT_INVALID';
  end if;
  perform public.cms_lock_content_source(p_content_type, p_content_id);
  perform public.cms_assert_not_pending(p_content_type, p_content_id);
  current_snapshot := public.cms_current_snapshot(p_content_type, p_content_id);
  fine_permission := case p_content_type when 'resource' then 'resource.edit'
    when 'opportunity' then 'opportunity.edit' when 'project' then 'project.edit'
    when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id, 'content.edit', current_snapshot->>'ownership_kind', current_snapshot->>'owner_branch_id')
    and not public.authorization_has_permission(p_actor_user_id, fine_permission, current_snapshot->>'ownership_kind', current_snapshot->>'owner_branch_id') then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;
  if p_content_type = 'media_asset'
    and (jsonb_typeof(p_source->'asset') <> 'object' or p_source->'asset'->>'id' is distinct from p_content_id) then
    raise exception using errcode = '22023', message = 'CMS_DRAFT_INVALID';
  end if;
  if p_expected_revision is not null
    and not public.cms_revision_matches(p_content_type, current_snapshot->>'revision_key', p_expected_revision) then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  next_revision := clock_timestamp()::text;
  insert into public.cms_content_drafts(content_type, content_id, revision_key, source, audience, updated_by, updated_at)
  values (p_content_type, p_content_id, next_revision, p_source, coalesce(p_audience, '{}'), p_actor_user_id, now())
  on conflict (content_type, content_id) do update set revision_key = excluded.revision_key,
    source = excluded.source, audience = excluded.audience,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.cms_invalidate_reviews(p_content_type, p_content_id, next_revision);
  return jsonb_build_object('id', p_content_id, 'status', 'draft', 'revision_key', next_revision, 'live_status', 'published');
end;
$$;
revoke all on function public.cms_save_content_draft(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cms_save_content_draft(uuid, text, text, text, jsonb, jsonb) to service_role;

alter function public.cms_request_review(uuid, text, text, text, jsonb)
  rename to cms_request_review_pre_workflow;
revoke all on function public.cms_request_review_pre_workflow(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.cms_request_review(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_expected_revision text,
  p_notebook_dependencies jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate jsonb;
  source_checksum text;
  review_row public.cms_review_requests;
begin
  perform public.cms_lock_content_source(p_content_type, p_content_id);
  candidate := public.cms_review_candidate(p_actor_user_id, p_content_type, p_content_id, p_expected_revision);
  source_checksum := encode(digest((candidate->'source')::text, 'sha256'), 'hex');
  select request.* into review_row
  from public.cms_review_requests request
  join public.cms_content_snapshots snapshot on snapshot.id = request.snapshot_id
  where request.content_type = p_content_type
    and request.content_id = p_content_id
    and request.status in ('pending', 'approved')
    and snapshot.revision_key = p_expected_revision
    and snapshot.checksum = source_checksum
  order by request.submitted_at desc
  limit 1;
  if found then return to_jsonb(review_row); end if;
  return public.cms_request_review_pre_workflow(
    p_actor_user_id, p_content_type, p_content_id, candidate->>'revision_key', p_notebook_dependencies
  );
end;
$$;
revoke all on function public.cms_request_review(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cms_request_review(uuid, text, text, text, jsonb) to service_role;

create or replace function public.cms_get_workflow(
  p_actor_user_id uuid, p_content_type text, p_content_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  candidate jsonb;
  review public.cms_review_requests;
  review_snapshot public.cms_content_snapshots;
  publication public.cms_publications;
  publication_snapshot public.cms_content_snapshots;
  fine_permission text;
  can_read boolean;
  can_edit boolean;
  can_request boolean;
  can_publish boolean;
  content_status text;
begin
  candidate := public.cms_current_snapshot(p_content_type, p_content_id);
  fine_permission := case p_content_type
    when 'course' then 'course.edit' when 'bank_question' then 'bank.edit'
    when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
    when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  can_read := public.authorization_has_permission(p_actor_user_id, 'content.read', candidate->>'ownership_kind', candidate->>'owner_branch_id')
    or public.authorization_has_permission(p_actor_user_id, fine_permission, candidate->>'ownership_kind', candidate->>'owner_branch_id')
    or public.authorization_has_permission(p_actor_user_id, 'content.review', 'central', null)
    or public.authorization_has_permission(p_actor_user_id, 'content.publish', 'central', null);
  if not can_read then raise exception using errcode = '42501', message = 'Permission denied'; end if;
  can_edit := public.authorization_has_permission(p_actor_user_id, 'content.edit', candidate->>'ownership_kind', candidate->>'owner_branch_id')
    or public.authorization_has_permission(p_actor_user_id, fine_permission, candidate->>'ownership_kind', candidate->>'owner_branch_id');
  can_request := public.authorization_has_permission(p_actor_user_id, 'content.review.request', candidate->>'ownership_kind', candidate->>'owner_branch_id');
  can_publish := public.authorization_has_permission(p_actor_user_id, 'content.review', 'central', null)
    and public.authorization_has_permission(p_actor_user_id, 'content.publish', 'central', null)
    and case p_content_type
      when 'course' then public.authorization_has_permission(p_actor_user_id, 'course.publish', 'central', null)
      when 'bank_question' then public.authorization_has_permission(p_actor_user_id, 'bank.publish', 'central', null)
      when 'resource' then public.authorization_has_permission(p_actor_user_id, 'resource.publish', 'central', null)
      when 'opportunity' then public.authorization_has_permission(p_actor_user_id, 'opportunity.publish', 'central', null)
      else true end;
  select request.* into review
  from public.cms_review_requests request
  join public.cms_content_snapshots snapshot on snapshot.id = request.snapshot_id
  where request.content_type = p_content_type and request.content_id = p_content_id
  order by (snapshot.revision_key = candidate->>'revision_key') desc, request.submitted_at desc
  limit 1;
  if review.id is not null then
    select * into review_snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  end if;
  select published.* into publication
  from public.cms_publications published
  where published.content_type = p_content_type and published.content_id = p_content_id;
  if publication.snapshot_id is not null then
    select * into publication_snapshot from public.cms_content_snapshots where id = publication.snapshot_id;
  end if;
  content_status := case
    when p_content_type in ('resource', 'opportunity', 'project', 'media_asset')
      and publication.snapshot_id is not null
      and not coalesce((candidate->>'has_draft')::boolean, false) then 'published'
    when review.id is not null and review_snapshot.revision_key = candidate->>'revision_key' then review.status
    when publication.snapshot_id is not null and publication_snapshot.revision_key = candidate->>'revision_key' then 'published'
    else 'draft' end;
  return jsonb_build_object(
    'content', jsonb_build_object(
      'contentType', p_content_type, 'contentId', p_content_id,
      'revisionKey', candidate->>'revision_key', 'status', content_status,
      'publishedRevisionKey', case when publication.snapshot_id is null then null else publication_snapshot.revision_key end
    ),
    'activeReview', case when review.id is null then null else jsonb_build_object(
      'id', review.id, 'status', review.status, 'revisionKey', review_snapshot.revision_key, 'note', review.decision_note
    ) end,
    'publication', case when publication.snapshot_id is null then null else jsonb_build_object(
      'revisionKey', publication_snapshot.revision_key, 'publishedAt', publication.published_at
    ) end,
    'actions', jsonb_build_object(
      'requestReview', can_request
        and not (content_status = 'published' and not coalesce((candidate->>'has_draft')::boolean, false))
        and not (review.id is not null and review_snapshot.revision_key = candidate->>'revision_key' and review.status in ('pending','approved')),
      'withdrawReview', review.id is not null and review.status = 'pending' and can_edit,
      'approveAndPublish', can_publish and review.id is not null and review_snapshot.revision_key = candidate->>'revision_key' and review.status in ('pending','approved'),
      'mutate', can_edit and not (review.id is not null and review.status = 'pending')
    )
  );
end;
$$;
revoke all on function public.cms_get_workflow(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_get_workflow(uuid, text, text) to service_role;

create or replace function public.cms_withdraw_review(p_actor_user_id uuid, p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  review public.cms_review_requests;
  snapshot public.cms_content_snapshots;
  fine_permission text;
begin
  select * into review from public.cms_review_requests where id = p_review_id;
  if not found then raise exception using errcode = 'P0002', message = 'CMS_REVIEW_NOT_FOUND'; end if;
  perform public.cms_lock_content(review.content_type, review.content_id);
  select * into review from public.cms_review_requests where id = p_review_id for update;
  if review.status <> 'pending' then raise exception using errcode = '55000', message = 'CMS_REVIEW_NOT_PENDING'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  fine_permission := case review.content_type
    when 'course' then 'course.edit' when 'bank_question' then 'bank.edit'
    when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
    when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id, 'content.edit', snapshot.ownership_kind, snapshot.owner_branch_id)
    and not public.authorization_has_permission(p_actor_user_id, fine_permission, snapshot.ownership_kind, snapshot.owner_branch_id) then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;
  update public.cms_review_requests set status = 'withdrawn', decided_at = now()
    where id = p_review_id returning * into review;
  insert into public.audit_log(actor_id, action, target_type, target_id, before, after, branch_id)
  values (p_actor_user_id, 'content.review.withdraw', review.content_type, review.content_id,
    jsonb_build_object('reviewId', review.id, 'status', 'pending'),
    jsonb_build_object('reviewId', review.id, 'status', 'withdrawn'), snapshot.owner_branch_id);
  return to_jsonb(review);
end;
$$;
revoke all on function public.cms_withdraw_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cms_withdraw_review(uuid, uuid) to service_role;

create or replace function public.cms_get_approval_candidate(p_actor_user_id uuid, p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare review public.cms_review_requests; snapshot public.cms_content_snapshots; specific_permission text;
begin
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review', 'central', null);
  perform public.authorization_assert_actor(p_actor_user_id, 'content.publish', 'central', null);
  select request.* into review
  from public.cms_review_requests request
  where request.id = p_review_id;
  if not found then raise exception using errcode = 'P0002', message = 'CMS_REVIEW_NOT_FOUND'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  specific_permission := case review.content_type when 'course' then 'course.publish'
    when 'bank_question' then 'bank.publish' when 'resource' then 'resource.publish'
    when 'opportunity' then 'opportunity.publish' else null end;
  if specific_permission is not null then
    perform public.authorization_assert_actor(p_actor_user_id, specific_permission, 'central', null);
  end if;
  return jsonb_build_object('id', review.id, 'status', review.status, 'contentType', review.content_type,
    'contentId', review.content_id, 'revisionKey', snapshot.revision_key);
end;
$$;
revoke all on function public.cms_get_approval_candidate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cms_get_approval_candidate(uuid, uuid) to service_role;

create or replace function public.cms_lock_publication_graph(
  p_content_type text, p_content_id text, p_dependencies jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare locked record;
begin
  for locked in
    select distinct target.content_type, target.content_id
    from (
      select p_content_type content_type, p_content_id content_id
      union all
      select case dependency->>'kind'
          when 'asset' then 'media_asset'
          when 'bank_version' then 'bank_question'
        end,
        dependency->>'id'
      from jsonb_array_elements(coalesce(p_dependencies, '[]'::jsonb)) dependency
      where dependency->>'kind' in ('asset', 'bank_version')
      union all
      select 'media_asset', pinned->>'id'
      from jsonb_array_elements(coalesce(p_dependencies, '[]'::jsonb)) dependency
      cross join lateral jsonb_array_elements(coalesce(dependency->'assets', '[]'::jsonb)) pinned
      where dependency->>'kind' = 'notebook'
    ) target
    where nullif(target.content_type, '') is not null and nullif(target.content_id, '') is not null
    order by target.content_type, target.content_id
  loop
    perform public.cms_lock_content_source(locked.content_type, locked.content_id);
  end loop;
end;
$$;
revoke all on function public.cms_lock_publication_graph(text, text, jsonb) from public, anon, authenticated, service_role;

alter function public.cms_publish_content(uuid, text, text, text)
  rename to cms_publish_content_pre_workflow;
revoke all on function public.cms_publish_content_pre_workflow(uuid, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.cms_publish_content(
  p_actor_user_id uuid, p_content_type text, p_content_id text, p_revision_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review_id uuid; snapshot public.cms_content_snapshots; frozen_dependencies jsonb := '[]'::jsonb;
  frozen_ownership_kind text; frozen_owner_branch_id text; frozen_review_id uuid; frozen_revision text;
begin
  select candidate.dependencies, candidate.ownership_kind, candidate.owner_branch_id, review.id, candidate.revision_key
    into frozen_dependencies, frozen_ownership_kind, frozen_owner_branch_id, frozen_review_id, frozen_revision
  from public.cms_review_requests review
  join public.cms_content_snapshots candidate on candidate.id = review.snapshot_id
  where review.content_type = p_content_type and review.content_id = p_content_id
    and review.status = 'approved'
    and public.cms_revision_matches(p_content_type, candidate.revision_key, p_revision_key)
  order by review.decided_at desc limit 1;
  perform public.cms_lock_publication_graph(
    p_content_type, p_content_id, coalesce(frozen_dependencies, '[]'::jsonb)
  );
  begin
    perform public.cms_assert_dependency_ownership(
      coalesce(frozen_dependencies, '[]'::jsonb), frozen_ownership_kind, frozen_owner_branch_id
    );
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
      where id = frozen_review_id;
    return jsonb_build_object('status', 'stale', 'content_type', p_content_type, 'content_id', p_content_id);
  end;
  if p_content_type <> 'media_asset' then
    return public.cms_publish_content_pre_workflow(
      p_actor_user_id, p_content_type, p_content_id, coalesce(frozen_revision, p_revision_key)
    );
  end if;
  review_id := public.cms_assert_publishable(
    p_actor_user_id, p_content_type, p_content_id, coalesce(frozen_revision, p_revision_key)
  );
  if review_id is null then return jsonb_build_object('status', 'stale', 'content_type', p_content_type, 'content_id', p_content_id); end if;
  select candidate.* into snapshot from public.cms_content_snapshots candidate
  join public.cms_review_requests review on review.snapshot_id = candidate.id where review.id = review_id;
  perform set_config('vfuture.cms_publishing', 'on', true);
  update public.media_assets
    set alt = snapshot.source->'asset'->'alt'
    where id = p_content_id;
  delete from public.cms_content_drafts where content_type = p_content_type and content_id = p_content_id;
  return public.cms_finalize_publication(p_actor_user_id, review_id);
end;
$$;
revoke all on function public.cms_publish_content(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cms_publish_content(uuid, text, text, text) to service_role;

create or replace function public.studio_bank_create_version_guarded(
  p_question_id text, p_actor_id uuid, p_payload jsonb, p_renders jsonb, p_grading jsonb,
  p_type text, p_tags text[], p_difficulty text, p_expected_version_id uuid
)
returns table(id uuid, version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb; current_version_id uuid;
begin
  perform public.cms_lock_content_source('bank_question', p_question_id);
  perform public.cms_assert_not_pending('bank_question', p_question_id);
  candidate := public.cms_current_snapshot('bank_question', p_question_id);
  perform public.authorization_assert_actor(
    p_actor_id, 'bank.edit', candidate->>'ownership_kind', candidate->>'owner_branch_id'
  );
  select latest.id into current_version_id
  from public.bank_question_versions latest
  where latest.question_id = p_question_id order by latest.version desc limit 1;
  if current_version_id is distinct from p_expected_version_id then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  return query select created.id, created.version
  from public.studio_bank_create_version(
    p_question_id, p_actor_id, p_payload, p_renders, p_grading, p_type, p_tags, p_difficulty
  ) created;
end;
$$;
revoke all on function public.studio_bank_create_version_guarded(text, uuid, jsonb, jsonb, jsonb, text, text[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.studio_bank_create_version_guarded(text, uuid, jsonb, jsonb, jsonb, text, text[], text, uuid)
  to service_role;

create or replace function public.studio_project_save_guarded(
  p_actor_user_id uuid, p_project jsonb, p_members jsonb, p_create boolean, p_expected_revision text default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb;
begin
  if p_create then return public.studio_project_save(p_project, p_members, true); end if;
  perform public.cms_lock_content_source('project', p_project->>'id');
  perform public.cms_assert_not_pending('project', p_project->>'id');
  candidate := public.cms_current_snapshot('project', p_project->>'id');
  perform public.authorization_assert_actor(
    p_actor_user_id, 'project.edit', candidate->>'ownership_kind', candidate->>'owner_branch_id'
  );
  if not public.cms_revision_matches('project', candidate->>'revision_key', p_expected_revision) then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  return public.studio_project_save(p_project, p_members, false);
end;
$$;
revoke all on function public.studio_project_save_guarded(uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.studio_project_save_guarded(uuid, jsonb, jsonb, boolean, text) to service_role;

create or replace function public.studio_project_delete_guarded(
  p_actor_user_id uuid, p_project_id text, p_expected_revision text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb;
begin
  perform public.cms_lock_content_source('project', p_project_id);
  perform public.cms_assert_not_pending('project', p_project_id);
  candidate := public.cms_current_snapshot('project', p_project_id);
  perform public.authorization_assert_actor(
    p_actor_user_id, 'project.edit', candidate->>'ownership_kind', candidate->>'owner_branch_id'
  );
  if not public.cms_revision_matches('project', candidate->>'revision_key', p_expected_revision) then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  if exists (select 1 from public.projects where id = p_project_id and approved)
    or exists (select 1 from public.cms_publications where content_type = 'project' and content_id = p_project_id) then
    raise exception using errcode = '55000', message = 'PROJECT_PUBLISHED_DELETE_FORBIDDEN';
  end if;
  delete from public.cms_content_drafts where content_type = 'project' and content_id = p_project_id;
  delete from public.project_members where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
  return found;
end;
$$;
revoke all on function public.studio_project_delete_guarded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.studio_project_delete_guarded(uuid, text, text) to service_role;

alter function public.studio_save_draft_workspace(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean)
  rename to studio_save_draft_workspace_pre_workflow;
revoke all on function public.studio_save_draft_workspace_pre_workflow(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;
create or replace function public.studio_save_draft_workspace(
  course_id text, manifest jsonb, items jsonb, actor_id uuid, expected_updated_at timestamptz,
  requested_base_version_id uuid, set_base_version boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.cms_lock_content_source('course', course_id);
  perform public.cms_assert_not_pending('course', course_id);
  return public.studio_save_draft_workspace_pre_workflow(
    course_id, manifest, items, actor_id, expected_updated_at, requested_base_version_id, set_base_version
  );
end;
$$;
revoke all on function public.studio_save_draft_workspace(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean) from public, anon, authenticated;
grant execute on function public.studio_save_draft_workspace(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean) to service_role;

alter function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz)
  rename to studio_replace_draft_if_current_pre_workflow;
revoke all on function public.studio_replace_draft_if_current_pre_workflow(text, jsonb, jsonb, uuid, timestamptz)
  from public, anon, authenticated, service_role;
create or replace function public.studio_replace_draft_if_current(
  course_id text, manifest jsonb, items jsonb, base_version_id uuid, expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.cms_lock_content_source('course', course_id);
  perform public.cms_assert_not_pending('course', course_id);
  return public.studio_replace_draft_if_current_pre_workflow(
    course_id, manifest, items, base_version_id, expected_updated_at
  );
end;
$$;
revoke all on function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz) to service_role;

alter function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  rename to studio_publish_version_guarded_pre_workflow_lock;
revoke all on function public.studio_publish_version_guarded_pre_workflow_lock(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  from public, anon, authenticated, service_role;
create or replace function public.studio_publish_version_guarded(
  course_id text, manifest jsonb, compiled jsonb, checklist jsonb, report jsonb,
  actor_id uuid, notes text, audit_row jsonb, expected_updated_at timestamptz,
  skill_declarations jsonb, skill_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare frozen_dependencies jsonb := '[]'::jsonb; frozen_ownership_kind text; frozen_owner_branch_id text; frozen_review_id uuid;
begin
  select snapshot.dependencies, snapshot.ownership_kind, snapshot.owner_branch_id, review.id
    into frozen_dependencies, frozen_ownership_kind, frozen_owner_branch_id, frozen_review_id
  from public.cms_review_requests review
  join public.cms_content_snapshots snapshot on snapshot.id = review.snapshot_id
  where review.content_type = 'course' and review.content_id = course_id
    and review.status = 'approved'
    and public.cms_revision_matches('course', snapshot.revision_key, expected_updated_at::text)
  order by review.decided_at desc limit 1;
  perform public.cms_lock_publication_graph('course', course_id, coalesce(frozen_dependencies, '[]'::jsonb));
  begin
    perform public.cms_assert_dependency_ownership(
      coalesce(frozen_dependencies, '[]'::jsonb), frozen_ownership_kind, frozen_owner_branch_id
    );
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
      where id = frozen_review_id;
    return jsonb_build_object('conflict', true, 'cms_stale', true);
  end;
  return public.studio_publish_version_guarded_pre_workflow_lock(
    course_id, manifest, compiled, checklist, report, actor_id, notes, audit_row,
    expected_updated_at, skill_declarations, skill_category
  );
end;
$$;
revoke all on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  to service_role;

alter function public.studio_bank_publish(text, uuid, uuid)
  rename to studio_bank_publish_pre_workflow_lock;
revoke all on function public.studio_bank_publish_pre_workflow_lock(text, uuid, uuid)
  from public, anon, authenticated, service_role;
create or replace function public.studio_bank_publish(p_question_id text, p_version_id uuid, p_actor_id uuid)
returns table(id text, status text, current_version_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare frozen_dependencies jsonb := '[]'::jsonb; frozen_ownership_kind text; frozen_owner_branch_id text; frozen_review_id uuid;
begin
  select snapshot.dependencies, snapshot.ownership_kind, snapshot.owner_branch_id, review.id
    into frozen_dependencies, frozen_ownership_kind, frozen_owner_branch_id, frozen_review_id
  from public.cms_review_requests review
  join public.cms_content_snapshots snapshot on snapshot.id = review.snapshot_id
  where review.content_type = 'bank_question' and review.content_id = p_question_id
    and review.status = 'approved' and snapshot.revision_key = p_version_id::text
  order by review.decided_at desc limit 1;
  perform public.cms_lock_publication_graph('bank_question', p_question_id, coalesce(frozen_dependencies, '[]'::jsonb));
  begin
    perform public.cms_assert_dependency_ownership(
      coalesce(frozen_dependencies, '[]'::jsonb), frozen_ownership_kind, frozen_owner_branch_id
    );
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
      where id = frozen_review_id;
    return;
  end;
  return query select published.id, published.status, published.current_version_id
  from public.studio_bank_publish_pre_workflow_lock(p_question_id, p_version_id, p_actor_id) published;
end;
$$;
revoke all on function public.studio_bank_publish(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.studio_bank_publish(text, uuid, uuid) to service_role;

create or replace function public.cms_approve_and_publish(
  p_actor_user_id uuid,
  p_review_id uuid,
  p_expected_revision text,
  p_note text,
  p_course_publication jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  review public.cms_review_requests;
  snapshot public.cms_content_snapshots;
  current_snapshot jsonb;
  published jsonb;
  specific_permission text;
begin
  if nullif(btrim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'CMS_REVIEW_DECISION_INVALID';
  end if;
  select * into review from public.cms_review_requests where id = p_review_id;
  if not found then raise exception using errcode = 'P0002', message = 'CMS_REVIEW_NOT_FOUND'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  perform public.cms_lock_publication_graph(review.content_type, review.content_id, snapshot.dependencies);
  select * into review from public.cms_review_requests where id = p_review_id for update;
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review', 'central', null);
  perform public.authorization_assert_actor(p_actor_user_id, 'content.publish', 'central', null);
  specific_permission := case review.content_type when 'course' then 'course.publish'
    when 'bank_question' then 'bank.publish' when 'resource' then 'resource.publish'
    when 'opportunity' then 'opportunity.publish' else null end;
  if specific_permission is not null then
    perform public.authorization_assert_actor(p_actor_user_id, specific_permission, 'central', null);
  end if;
  if review.status = 'published' then return to_jsonb(review); end if;
  if review.status not in ('pending', 'approved') then
    raise exception using errcode = '55000', message = 'CMS_REVIEW_NOT_PUBLISHABLE';
  end if;
  current_snapshot := public.cms_current_snapshot(review.content_type, review.content_id);
  if not public.cms_revision_matches(review.content_type, snapshot.revision_key, p_expected_revision)
    or not public.cms_revision_matches(review.content_type, snapshot.revision_key, current_snapshot->>'revision_key')
    or snapshot.checksum is distinct from encode(digest((current_snapshot->'source')::text, 'sha256'), 'hex') then
    update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
      where id = review.id returning * into review;
    return to_jsonb(review);
  end if;
  begin
    perform public.cms_assert_dependency_ownership(
      snapshot.dependencies, snapshot.ownership_kind, snapshot.owner_branch_id
    );
    perform public.cms_assert_dependencies(snapshot.dependencies);
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
      where id = review.id returning * into review;
    return to_jsonb(review);
  end;
  if review.content_type = 'course' then
    if p_course_publication is null
      or not public.cms_revision_matches('course', p_course_publication->>'expectedUpdatedAt', snapshot.revision_key)
      or p_course_publication->'source' is distinct from snapshot.source
      or not coalesce((p_course_publication->'checklist'->>'outcomesReviewed')::boolean, false)
      or not coalesce((p_course_publication->'checklist'->>'answerKeysVerified')::boolean, false)
      or not coalesce((p_course_publication->'checklist'->>'accessibilityReviewed')::boolean, false)
      or not coalesce((p_course_publication->'checklist'->>'ageAppropriate')::boolean, false)
      or not coalesce((p_course_publication->'checklist'->>'linksValid')::boolean, false)
      or not coalesce((p_course_publication->'checklist'->>'warningsAcknowledged')::boolean, false) then
      raise exception using errcode = '22023', message = 'CMS_COURSE_PUBLICATION_INVALID';
    end if;
  elsif p_course_publication is not null then
    raise exception using errcode = '22023', message = 'CMS_COURSE_PUBLICATION_UNEXPECTED';
  end if;
  if review.status = 'pending' then
    update public.cms_review_requests set status = 'approved', reviewer_id = p_actor_user_id,
      decision_note = btrim(p_note), decided_at = now(), self_review = submitted_by = p_actor_user_id
      where id = review.id returning * into review;
    insert into public.audit_log(actor_id, action, target_type, target_id, before, after, branch_id)
    values (p_actor_user_id, 'content.review.approve', review.content_type, review.content_id,
      jsonb_build_object('reviewId', review.id, 'status', 'pending'),
      jsonb_build_object('reviewId', review.id, 'status', 'approved', 'selfReview', review.self_review), snapshot.owner_branch_id);
  end if;
  if review.content_type = 'course' then
    published := public.studio_publish_version_guarded_pre_cms_review(
      review.content_id,
      p_course_publication->'manifest',
      p_course_publication->'compiled',
      p_course_publication->'checklist',
      p_course_publication->'report',
      p_actor_user_id,
      nullif(p_course_publication->>'notes', ''),
      jsonb_build_object('actor_id', p_actor_user_id, 'action', 'course.publish', 'target_type', 'course',
        'target_id', review.content_id, 'before', null, 'after', jsonb_build_object('checksum', p_course_publication->>'checksum')),
      (p_course_publication->>'expectedUpdatedAt')::timestamptz,
      coalesce(p_course_publication->'skillDeclarations', '[]'::jsonb),
      p_course_publication->>'skillCategory'
    );
    if coalesce((published->>'conflict')::boolean, false) then
      raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
    end if;
    perform public.cms_finalize_publication(p_actor_user_id, review.id);
    return published || jsonb_build_object('reviewId', review.id, 'status', 'published');
  end if;
  return public.cms_publish_content(p_actor_user_id, review.content_type, review.content_id, snapshot.revision_key);
end;
$$;
revoke all on function public.cms_approve_and_publish(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cms_approve_and_publish(uuid, uuid, text, text, jsonb) to service_role;
