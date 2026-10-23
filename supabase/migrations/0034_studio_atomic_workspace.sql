-- Atomic workspace reads/writes for the simplified Studio editor. Browser roles
-- cannot call these privileged functions; API routes authorize the actor first.

create function public.studio_get_draft_snapshot(course_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', draft.id,
    'course_id', draft.course_id,
    'manifest', draft.manifest,
    'items', coalesce((
      select jsonb_object_agg(item.item_id, item.document order by item.item_id)
      from public.course_draft_items as item
      where item.draft_id = draft.id
    ), '{}'::jsonb),
    'base_version_id', draft.base_version_id,
    'checklist', draft.checklist,
    'updated_at', draft.updated_at
  )
  from public.course_drafts as draft
  where draft.course_id = $1
$$;

create function public.studio_save_draft_workspace(
  course_id text,
  manifest jsonb,
  items jsonb,
  actor_id uuid,
  expected_updated_at timestamptz,
  requested_base_version_id uuid,
  set_base_version boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_course_id alias for $1;
  requested_manifest alias for $2;
  requested_items alias for $3;
  requested_actor_id alias for $4;
  requested_updated_at alias for $5;
  requested_base_id alias for $6;
  should_set_base alias for $7;
  target_draft_id uuid;
  current_updated_at timestamptz;
  saved_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(requested_manifest) <> 'object' or jsonb_typeof(requested_items) <> 'object' then
    raise exception 'manifest and items must be JSON objects' using errcode = '22023';
  end if;

  if should_set_base and not exists (
    select 1 from public.course_versions as version_row
    where version_row.id = requested_base_id and version_row.course_id = requested_course_id
  ) then
    return jsonb_build_object('invalid_base_version', true);
  end if;

  select draft.id, draft.updated_at
  into target_draft_id, current_updated_at
  from public.course_drafts as draft
  where draft.course_id = requested_course_id
  for update;

  if target_draft_id is null or current_updated_at is distinct from requested_updated_at then
    return jsonb_build_object('conflict', true);
  end if;

  if exists (
    select 1
    from public.course_draft_items as existing_item
    join jsonb_each(requested_items) as requested_item
      on requested_item.key = existing_item.item_id
    where existing_item.draft_id = target_draft_id
      and existing_item.kind is distinct from requested_item.value ->> 'kind'
  ) then
    return jsonb_build_object('immutable_kind_conflict', true);
  end if;

  update public.course_drafts as draft
  set manifest = requested_manifest,
      base_version_id = case when should_set_base then requested_base_id else draft.base_version_id end,
      updated_by = requested_actor_id,
      updated_at = saved_at
  where draft.id = target_draft_id;

  delete from public.course_draft_items where draft_id = target_draft_id;
  insert into public.course_draft_items (draft_id, item_id, kind, document, updated_by, updated_at)
  select target_draft_id, entry.key, entry.value ->> 'kind', entry.value, requested_actor_id, saved_at
  from jsonb_each(requested_items) as entry;

  return jsonb_build_object(
    'conflict', false,
    'draft', public.studio_get_draft_snapshot(requested_course_id)
  );
end;
$$;

create function public.studio_import_course(
  course_id text,
  actor_id uuid,
  manifest jsonb,
  items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_course_id alias for $1;
  requested_actor_id alias for $2;
  requested_manifest alias for $3;
  requested_items alias for $4;
  target_draft_id uuid;
  saved_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(requested_manifest) <> 'object' or jsonb_typeof(requested_items) <> 'object' then
    raise exception 'manifest and items must be JSON objects' using errcode = '22023';
  end if;

  insert into public.courses (id, slug, owner_id, status, created_at, updated_at)
  values (
    requested_course_id,
    coalesce(nullif(requested_manifest ->> 'slug', ''), requested_course_id),
    requested_actor_id,
    'draft',
    saved_at,
    saved_at
  )
  on conflict do nothing;
  if not found then return jsonb_build_object('conflict', true); end if;

  insert into public.course_drafts (course_id, manifest, updated_by, updated_at)
  values (requested_course_id, requested_manifest, requested_actor_id, saved_at)
  returning id into target_draft_id;

  insert into public.course_draft_items (draft_id, item_id, kind, document, updated_by, updated_at)
  select target_draft_id, entry.key, entry.value ->> 'kind', entry.value, requested_actor_id, saved_at
  from jsonb_each(requested_items) as entry;

  return jsonb_build_object(
    'conflict', false,
    'draft', public.studio_get_draft_snapshot(requested_course_id)
  );
end;
$$;

create function public.studio_publish_version_guarded(
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
  published jsonb;
begin
  select draft.updated_at into current_updated_at
  from public.course_drafts as draft
  where draft.course_id = requested_course_id
  for update;

  if current_updated_at is null or current_updated_at is distinct from requested_updated_at then
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

revoke all on function public.studio_get_draft_snapshot(text) from public, anon, authenticated;
grant execute on function public.studio_get_draft_snapshot(text) to service_role;
revoke all on function public.studio_save_draft_workspace(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean) from public, anon, authenticated;
grant execute on function public.studio_save_draft_workspace(text, jsonb, jsonb, uuid, timestamptz, uuid, boolean) to service_role;
revoke all on function public.studio_import_course(text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.studio_import_course(text, uuid, jsonb, jsonb) to service_role;
revoke all on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text) to service_role;
