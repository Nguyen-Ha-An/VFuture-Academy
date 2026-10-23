-- Transaction boundaries for Studio draft replacement and immutable publishing.
-- These privileged functions are not callable by browser roles; route handlers
-- invoke them only through the service-role Supabase client after permission checks.

create or replace function public.studio_replace_draft(
  course_id text,
  manifest jsonb,
  items jsonb,
  base_version_id uuid default null
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
  requested_base_version_id alias for $4;
  target_draft_id uuid;
begin
  if jsonb_typeof(requested_manifest) <> 'object' then
    raise exception 'manifest must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_items) <> 'object' then
    raise exception 'items must be a JSON object' using errcode = '22023';
  end if;

  insert into public.course_drafts as draft (course_id, manifest, base_version_id, updated_at)
  values (requested_course_id, requested_manifest, requested_base_version_id, now())
  on conflict (course_id) do update
    set manifest = excluded.manifest,
        base_version_id = excluded.base_version_id,
        updated_at = now()
  returning draft.id into target_draft_id;

  delete from public.course_draft_items
  where draft_id = target_draft_id;

  insert into public.course_draft_items (draft_id, item_id, kind, document, updated_at)
  select
    target_draft_id,
    entry.key,
    entry.value ->> 'kind',
    entry.value,
    now()
  from jsonb_each(requested_items) as entry;

  return jsonb_build_object('draft_id', target_draft_id);
end;
$$;

create or replace function public.studio_publish_version(
  course_id text,
  manifest jsonb,
  compiled jsonb,
  checklist jsonb,
  report jsonb,
  actor_id uuid,
  notes text,
  audit_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_course_id alias for $1;
  requested_manifest alias for $2;
  requested_compiled alias for $3;
  requested_checklist alias for $4;
  requested_report alias for $5;
  requested_actor_id alias for $6;
  requested_notes alias for $7;
  requested_audit_row alias for $8;
  next_version integer;
  new_version_id uuid;
  item_entry record;
  render_entry record;
begin
  if requested_compiled ->> 'courseId' is distinct from requested_course_id then
    raise exception 'compiled course id does not match route course id' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_audit_row) <> 'object'
     or requested_audit_row ->> 'actor_id' is distinct from requested_actor_id::text
     or requested_audit_row ->> 'action' is distinct from 'course.publish'
     or requested_audit_row ->> 'target_type' is distinct from 'course'
     or requested_audit_row ->> 'target_id' is distinct from requested_course_id then
    raise exception 'invalid publish audit row' using errcode = '22023';
  end if;

  -- Serialize publishers of one course so max(version) + 1 remains race-free.
  perform pg_advisory_xact_lock(hashtextextended(requested_course_id, 0));

  select coalesce(max(cv.version), 0) + 1
  into next_version
  from public.course_versions as cv
  where cv.course_id = requested_course_id;

  insert into public.course_versions (
    course_id, version, manifest, checksum, summary, published_by, notes
  ) values (
    requested_course_id,
    next_version,
    requested_manifest,
    requested_compiled ->> 'checksum',
    requested_report -> 'summary',
    requested_actor_id,
    requested_notes
  )
  returning id into new_version_id;

  for item_entry in
    select entry.key, entry.value
    from jsonb_each(requested_compiled -> 'items') as entry
  loop
    insert into public.course_version_items (
      version_id, item_id, kind, source, grading, checksum
    ) values (
      new_version_id,
      item_entry.key,
      item_entry.value ->> 'kind',
      item_entry.value -> 'source',
      item_entry.value -> 'grading',
      item_entry.value ->> 'checksum'
    );

    for render_entry in
      select entry.key, entry.value
      from jsonb_each(item_entry.value -> 'renders') as entry
    loop
      insert into public.course_version_item_renders (
        version_id, item_id, locale, payload
      ) values (
        new_version_id,
        item_entry.key,
        render_entry.key,
        render_entry.value
      );
    end loop;
  end loop;

  insert into public.course_version_outline (
    version_id, course_id, outline, meta, access, completion, skills, languages, default_language
  ) values (
    new_version_id,
    requested_course_id,
    requested_compiled -> 'outline',
    requested_compiled -> 'meta',
    requested_compiled -> 'access',
    requested_compiled -> 'completion',
    requested_compiled -> 'skills',
    array(select jsonb_array_elements_text(requested_compiled -> 'languages')),
    requested_compiled ->> 'defaultLanguage'
  );

  update public.courses
  set current_version_id = new_version_id,
      status = 'published',
      updated_at = now()
  where id = requested_course_id;

  insert into public.publish_events (
    course_id, version_id, actor_id, checklist, report
  ) values (
    requested_course_id, new_version_id, requested_actor_id, requested_checklist, requested_report
  );

  insert into public.audit_log (
    actor_id, action, target_type, target_id, before, after
  ) values (
    (requested_audit_row ->> 'actor_id')::uuid,
    requested_audit_row ->> 'action',
    requested_audit_row ->> 'target_type',
    requested_audit_row ->> 'target_id',
    requested_audit_row -> 'before',
    coalesce(requested_audit_row -> 'after', '{}'::jsonb) || jsonb_build_object(
      'version', next_version,
      'checksum', requested_compiled ->> 'checksum'
    )
  );

  return jsonb_build_object(
    'id', new_version_id,
    'version', next_version,
    'checksum', requested_compiled ->> 'checksum'
  );
end;
$$;

revoke all on function public.studio_replace_draft(text, jsonb, jsonb, uuid) from public;
revoke all on function public.studio_replace_draft(text, jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.studio_replace_draft(text, jsonb, jsonb, uuid) to service_role;

revoke all on function public.studio_publish_version(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb) from public;
revoke all on function public.studio_publish_version(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.studio_publish_version(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb) to service_role;
