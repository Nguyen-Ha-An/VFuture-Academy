-- Bounded Studio list lookups and atomic course scaffolding. These functions
-- remain service-role only; route and page callers enforce Studio permissions.

create or replace function public.studio_bank_question_usages_batch(
  p_question_ids text[]
)
returns table(question_id text, version_id uuid, item_id text, course_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested.question_id, item.version_id, item.item_id, course_version.course_id
  from unnest(p_question_ids) as requested(question_id)
  cross join public.course_version_items as item
  join public.course_versions as course_version on course_version.id = item.version_id
  where jsonb_path_exists(
    item.source,
    'lax $.**."$ref" ? (@ == $bank_ref)',
    jsonb_build_object('bank_ref', 'bank:' || requested.question_id)
  ) or jsonb_path_exists(
    item.source,
    'lax $.**."$pool".from[*] ? (@ == $bank_ref)',
    jsonb_build_object('bank_ref', 'bank:' || requested.question_id)
  )
  order by requested.question_id, course_version.course_id, item.version_id, item.item_id;
$$;

create or replace function public.studio_create_course(
  p_course_id text,
  p_actor_id uuid,
  p_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_course jsonb;
  created_draft jsonb;
begin
  if jsonb_typeof(p_manifest) <> 'object'
     or p_manifest ->> 'kind' is distinct from 'course'
     or p_manifest ->> 'id' is distinct from p_course_id then
    raise exception 'invalid initial course manifest' using errcode = '22023';
  end if;

  insert into public.courses as course (
    id, slug, owner_id, status
  ) values (
    p_course_id, p_course_id, p_actor_id, 'draft'
  )
  returning to_jsonb(course.*) into created_course;

  insert into public.course_drafts as draft (
    course_id, manifest, updated_by
  ) values (
    p_course_id, p_manifest, p_actor_id
  )
  returning to_jsonb(draft.*) into created_draft;

  return jsonb_build_object('course', created_course, 'draft', created_draft);
end;
$$;

revoke all on function public.studio_bank_question_usages_batch(text[]) from public, anon, authenticated;
revoke all on function public.studio_create_course(text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.studio_bank_question_usages_batch(text[]) to service_role;
grant execute on function public.studio_create_course(text, uuid, jsonb) to service_role;
