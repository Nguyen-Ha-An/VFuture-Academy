-- Explicit bank question references resolve to the question's published pointer.
-- A newer saved draft can coexist with that immutable version.
create function public.cms_published_bank_version(p_question_id text)
returns table(ownership_kind text, owner_branch_id text, revision_key text)
language sql stable
set search_path = public, pg_temp
as $$
  select question.ownership_kind, question.owner_branch_id, version.id::text
  from public.bank_questions question
  join public.bank_question_versions version
    on version.id = question.current_version_id and version.question_id = question.id
  where question.id = p_question_id and question.status = 'published';
$$;
revoke all on function public.cms_published_bank_version(text) from public, anon, authenticated, service_role;

create function public.cms_bank_pins_current(p_dependencies jsonb)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from jsonb_array_elements(p_dependencies) dependency
    where dependency->>'kind' = 'bank_version' and not exists (
      select 1 from public.cms_published_bank_version(dependency->>'id') published
      where published.revision_key = dependency->>'revision_key'
    )
  );
$$;
revoke all on function public.cms_bank_pins_current(jsonb) from public, anon, authenticated, service_role;

create or replace function public.cms_snapshot_dependencies_pre_workflow(
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
  for dependency in select distinct value from jsonb_path_query(p_source, 'strict $.**.assetId') value order by value
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
    where value #>> '{}' like 'bank:%' order by value
  loop
    dependency_id := substring(dependency #>> '{}' from 6);
    select * into dependency_row from public.cms_published_bank_version(dependency_id);
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
revoke all on function public.cms_snapshot_dependencies_pre_workflow(jsonb, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_dependencies(p_dependencies jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  dependency jsonb;
  current_revision text;
begin
  if not public.cms_bank_pins_current(p_dependencies) then
    raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
  end if;
  for dependency in select value from jsonb_array_elements(p_dependencies)
  loop
    if dependency ->> 'kind' = 'asset' then
      select encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex')
      into current_revision from public.media_assets asset where asset.id = dependency ->> 'id';
    elsif dependency ->> 'kind' = 'bank_version' then
      continue;
    elsif dependency ->> 'kind' = 'notebook' then
      if exists (
        select 1 from jsonb_array_elements(coalesce(dependency->'assets', '[]'::jsonb)) pinned
        where not exists (select 1 from public.media_assets asset where asset.id = pinned->>'id')
      ) then
        raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
      end if;
      continue;
    else
      raise exception using errcode = '22023', message = 'CMS_DEPENDENCY_KIND_INVALID';
    end if;
    if current_revision is null or current_revision is distinct from dependency ->> 'revision_key' then
      raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
    end if;
  end loop;
end;
$$;
revoke all on function public.cms_assert_dependencies(jsonb) from public, anon, authenticated, service_role;

-- An unchanged course can be reviewed again after a dependency changes. Keep
-- each immutable snapshot addressable and deduplicate only identical inputs.
create unique index cms_snapshot_source_dependencies_idx on public.cms_content_snapshots
  (content_type, content_id, revision_key, checksum, sha256(jsonb_send(dependencies)));
alter table public.cms_content_snapshots
  drop constraint cms_content_snapshots_content_type_content_id_revision_key__key;

-- Preserve published history, decisions, and snapshot contents. Only open reviews
-- that could publish a different bank version require another review.
update public.cms_review_requests review
set status = 'stale', decided_at = coalesce(review.decided_at, now())
from public.cms_content_snapshots snapshot
where snapshot.id = review.snapshot_id and review.status in ('pending', 'approved')
  and not public.cms_bank_pins_current(snapshot.dependencies);

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
  current_snapshot jsonb;
  owner_scope text;
  owner_branch text;
  frozen_dependencies jsonb;
  source_checksum text;
  frozen_snapshot_id uuid;
  review_row public.cms_review_requests;
  notebook_locations jsonb;
begin
  perform public.cms_lock_content_source(p_content_type, p_content_id);
  current_snapshot := public.cms_review_candidate(p_actor_user_id, p_content_type, p_content_id, p_expected_revision);
  owner_scope := current_snapshot->>'ownership_kind';
  owner_branch := current_snapshot->>'owner_branch_id';
  source_checksum := encode(digest((current_snapshot->'source')::text, 'sha256'), 'hex');

  select request.* into review_row
  from public.cms_review_requests request
  join public.cms_content_snapshots snapshot on snapshot.id = request.snapshot_id
  where request.content_type = p_content_type and request.content_id = p_content_id
    and request.status in ('pending', 'approved')
    and snapshot.revision_key = current_snapshot->>'revision_key' and snapshot.checksum = source_checksum
    and public.cms_bank_pins_current(snapshot.dependencies);
  if found then return to_jsonb(review_row); end if;

  if owner_scope = 'branch' and p_content_type in ('course','resource','opportunity','project') and (
    current_snapshot->'audience'->>'scope' is distinct from 'branches'
    or not (current_snapshot->'audience'->'branchIds' ? owner_branch)
    or exists (select 1 from jsonb_array_elements_text(coalesce(current_snapshot->'audience'->'branchIds','[]'::jsonb)) audience_branch
      where audience_branch is distinct from owner_branch)
  ) then
    raise exception using errcode='42501',message='CMS_AUDIENCE_SCOPE_INVALID';
  end if;

  frozen_dependencies := public.cms_snapshot_dependencies(
    current_snapshot -> 'source', owner_scope, owner_branch
  );
  if p_notebook_dependencies is not null and jsonb_typeof(p_notebook_dependencies) <> 'array' then
    raise exception using errcode = '22023', message = 'CMS_NOTEBOOK_DEPENDENCIES_INVALID';
  end if;
  notebook_locations := public.cms_notebook_locations(current_snapshot->'source');
  if jsonb_array_length(notebook_locations)>0 and (
    p_notebook_dependencies is null or jsonb_array_length(p_notebook_dependencies)=0
  ) then
    raise exception using errcode='55000',message='CMS_NOTEBOOK_ADAPTER_REQUIRED';
  end if;
  if p_notebook_dependencies is not null and (
    jsonb_array_length(p_notebook_dependencies) is distinct from jsonb_array_length(notebook_locations)
    or exists (
      select 1 from jsonb_array_elements(notebook_locations) location
      where not exists (
        select 1 from jsonb_array_elements(p_notebook_dependencies) dependency
        where dependency->>'itemId'=location->>'itemId'
          and dependency->>'blockId' is not distinct from location->>'blockId'
      )
    )
    or exists (
      select 1 from jsonb_array_elements(p_notebook_dependencies) dependency
      where nullif(dependency->>'itemId','') is null
        or nullif(dependency->>'runtimeMode','') is null
        or nullif(dependency->>'runtimeProfileId','') is null
        or nullif(dependency->>'runtimeProfileVersion','') is null
        or jsonb_typeof(coalesce(dependency->'assets','null'::jsonb))<>'array'
        or not exists (
          select 1 from jsonb_array_elements(notebook_locations) location
          where dependency->>'itemId'=location->>'itemId'
            and dependency->>'blockId' is not distinct from location->>'blockId'
        )
    )
  ) then
    raise exception using errcode='22023',message='CMS_NOTEBOOK_DEPENDENCIES_INVALID';
  end if;
  if p_notebook_dependencies is not null then
    frozen_dependencies := frozen_dependencies || coalesce((select jsonb_agg(
      dependency || jsonb_build_object('kind', 'notebook')
      order by dependency->>'itemId', dependency->>'blockId'
    ) from jsonb_array_elements(p_notebook_dependencies) dependency), '[]'::jsonb);
  end if;
  update public.cms_review_requests set status = 'stale', decided_at = coalesce(decided_at, now())
  where content_type = p_content_type and content_id = p_content_id and status in ('pending', 'approved');

  insert into public.cms_content_snapshots (
    content_type, content_id, revision_key, checksum, ownership_kind,
    owner_branch_id, audience, source, dependencies, created_by
  ) values (
    p_content_type, p_content_id, current_snapshot ->> 'revision_key',
    source_checksum,
    owner_scope, owner_branch, current_snapshot -> 'audience',
    current_snapshot -> 'source', frozen_dependencies, p_actor_user_id
  ) on conflict (content_type, content_id, revision_key, checksum, sha256(jsonb_send(dependencies))) do nothing
  returning id into frozen_snapshot_id;

  if frozen_snapshot_id is null then
    select existing.id into strict frozen_snapshot_id from public.cms_content_snapshots existing
    where existing.content_type = p_content_type and existing.content_id = p_content_id
      and existing.revision_key = current_snapshot ->> 'revision_key'
      and existing.checksum = source_checksum and existing.dependencies = frozen_dependencies;
  end if;

  insert into public.cms_review_requests (
    content_type, content_id, snapshot_id, submitted_by
  ) values (p_content_type, p_content_id, frozen_snapshot_id, p_actor_user_id)
  returning * into review_row;

  insert into public.audit_log (actor_id, action, target_type, target_id, before, after, branch_id)
  values (p_actor_user_id, 'content.review.request', p_content_type, p_content_id, null,
    jsonb_build_object('reviewId', review_row.id, 'revision', current_snapshot->>'revision_key'), owner_branch);
  return to_jsonb(review_row);
end;
$$;
revoke all on function public.cms_request_review(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cms_request_review(uuid, text, text, text, jsonb) to service_role;
drop function public.cms_request_review_pre_workflow(uuid, text, text, text, jsonb);

-- Both the standalone publisher and atomic approve-and-publish call this
-- private writer while holding the course and bank dependency locks.
create or replace function public.studio_publish_version_guarded_pre_cms_review(
  course_id text,
  manifest jsonb,
  compiled jsonb,
  checklist jsonb,
  report jsonb,
  actor_id uuid,
  notes text,
  audit_row jsonb,
  expected_updated_at timestamptz,
  skill_declarations jsonb,
  skill_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_course_id alias for $1;
  requested_updated_at alias for $9;
  requested_skill_declarations alias for $10;
  requested_skill_category alias for $11;
  current_updated_at timestamptz;
  frozen_dependencies jsonb;
  published jsonb;
begin
  select draft.updated_at into current_updated_at
  from public.course_drafts as draft
  where draft.course_id = requested_course_id
  for update;

  if current_updated_at is null or current_updated_at is distinct from requested_updated_at then
    return jsonb_build_object('conflict', true);
  end if;

  select snapshot.dependencies into frozen_dependencies
  from public.cms_review_requests review
  join public.cms_content_snapshots snapshot on snapshot.id = review.snapshot_id
  where review.content_type = 'course' and review.content_id = requested_course_id
    and review.status = 'approved'
    and public.cms_revision_matches('course', snapshot.revision_key, requested_updated_at::text);
  if not found then
    raise exception using errcode = '42501', message = 'CMS_APPROVED_REVIEW_REQUIRED';
  end if;

  -- The compiler embeds a bank version in grading.questions[scope/question].sourceRef.
  -- Inline questions and runtime pool draws have no compiled bank version.
  if array(
    select distinct jsonb_build_array(dependency->>'id', dependency->>'revision_key') as pin
    from jsonb_array_elements(frozen_dependencies) dependency
    where dependency->>'kind' = 'bank_version'
    order by pin
  ) is distinct from array(
    select distinct jsonb_build_array(split_part(question.key, '/', -1), question.value->>'sourceRef') as pin
    from jsonb_each(compiled->'items') item
    cross join lateral jsonb_each(item.value->'grading'->'questions') question
    where question.value ? 'sourceRef'
    order by pin
  ) then
    return jsonb_build_object('conflict', true);
  end if;

  if jsonb_typeof(requested_skill_declarations) <> 'array' then
    raise exception 'skill declarations must be a JSON array' using errcode = '22023';
  end if;

  insert into public.skills (id, name, category, updated_at)
  select
    declaration.value ->> 'id',
    declaration.value -> 'name',
    requested_skill_category,
    clock_timestamp()
  from jsonb_array_elements(requested_skill_declarations) as declaration
  on conflict (id) do nothing;

  published := public.studio_publish_version($1, $2, $3, $4, $5, $6, $7, $8);
  return published || jsonb_build_object('conflict', false);
end;
$$;
revoke all on function public.studio_publish_version_guarded_pre_cms_review(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  from public, anon, authenticated, service_role;

-- An authored insert must explicitly supply its workspace. Without a column
-- default the existing NOT NULL constraint also rejects an older Studio build
-- that inserts a draft before attempting to assign the school in another call.
alter table public.opportunities alter column ownership_kind drop default;

create function public.cms_default_imported_opportunity_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.ownership_kind := 'central';
  return new;
end;
$$;
revoke all on function public.cms_default_imported_opportunity_ownership() from public, anon, authenticated, service_role;
create trigger opportunities_default_import_ownership before insert on public.opportunities
for each row when (new.created_by is null and new.ownership_kind is null and new.owner_branch_id is null)
execute function public.cms_default_imported_opportunity_ownership();

-- Creation stores the actor and selected school on the row in one insert. Keep
-- legacy assignment calls from transferring it, including calls by its creator.
create function public.cms_guard_opportunity_ownership()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is not null then
      insert into public.audit_log(actor_id, action, target_type, target_id, before, after, branch_id)
      values (new.created_by, 'content.ownership.assign', 'opportunity', new.id, null,
        jsonb_build_object('ownershipKind', new.ownership_kind, 'ownerBranchId', new.owner_branch_id),
        new.owner_branch_id);
    end if;
  elsif (new.created_by, new.ownership_kind, new.owner_branch_id)
    is distinct from (old.created_by, old.ownership_kind, old.owner_branch_id) then
    raise exception using errcode = '42501', message = 'CMS_OWNERSHIP_ASSIGNMENT_DENIED';
  end if;
  return null;
end;
$$;
revoke all on function public.cms_guard_opportunity_ownership() from public, anon, authenticated, service_role;
create trigger opportunities_ownership_guard
after insert or update of created_by, ownership_kind, owner_branch_id on public.opportunities
for each row execute function public.cms_guard_opportunity_ownership();
