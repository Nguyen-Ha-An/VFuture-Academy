-- Repair the draft replacement RPC without rewriting the applied migration.
-- The original conflict target used the same name as the course_id function
-- parameter, which PL/pgSQL rejects as an ambiguous column reference.

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
  on conflict on constraint course_drafts_course_id_key do update
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

revoke all on function public.studio_replace_draft(text, jsonb, jsonb, uuid) from public;
revoke all on function public.studio_replace_draft(text, jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.studio_replace_draft(text, jsonb, jsonb, uuid) to service_role;
