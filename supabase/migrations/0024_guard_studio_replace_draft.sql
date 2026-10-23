-- Add an optimistic-concurrency variant for imports without changing the
-- legacy studio_replace_draft signature used by seed and restore workflows.

create function public.studio_replace_draft_if_current(
  course_id text,
  manifest jsonb,
  items jsonb,
  base_version_id uuid,
  expected_updated_at timestamptz
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
  requested_updated_at alias for $5;
  target_draft_id uuid;
begin
  if jsonb_typeof(requested_manifest) <> 'object' then
    raise exception 'manifest must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_items) <> 'object' then
    raise exception 'items must be a JSON object' using errcode = '22023';
  end if;

  update public.course_drafts as draft
  set manifest = requested_manifest,
      base_version_id = requested_base_version_id,
      updated_at = now()
  where draft.course_id = requested_course_id
    and draft.updated_at = requested_updated_at
  returning draft.id into target_draft_id;

  if target_draft_id is null then
    return jsonb_build_object('conflict', true);
  end if;

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

  return jsonb_build_object('draft_id', target_draft_id, 'conflict', false);
end;
$$;

revoke all on function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz) from public;
revoke all on function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz) from anon, authenticated;
grant execute on function public.studio_replace_draft_if_current(text, jsonb, jsonb, uuid, timestamptz) to service_role;
