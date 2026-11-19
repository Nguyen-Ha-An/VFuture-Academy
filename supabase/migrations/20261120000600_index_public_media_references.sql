-- Index potential media only at positions rendered by public rich content. Callouts
-- are its recursive container. The application validates matching source documents.
create function private.public_rich_media_ids(p_content jsonb)
returns jsonb
language sql immutable strict parallel safe security invoker
set search_path = pg_catalog
as $$
  with recursive roots(content) as (
    select p_content where jsonb_typeof(p_content -> 'blocks') = 'array'
    union all
    select localized.content from (values (p_content -> 'vi'), (p_content -> 'en')) as localized(content)
    where jsonb_typeof(p_content -> 'blocks') is distinct from 'array'
  ), blocks(block) as (
    select element.value from roots
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(roots.content -> 'blocks') = 'array' then roots.content -> 'blocks' else '[]'::jsonb end
    ) as element
    union all
    select child.value from blocks
    cross join lateral jsonb_array_elements(
      case when block ->> 'type' = 'callout' and jsonb_typeof(block -> 'blocks') = 'array'
        then block -> 'blocks' else '[]'::jsonb end
    ) as child
  )
  select coalesce(jsonb_agg(distinct ref -> 'assetId'), '[]'::jsonb) from blocks
  cross join lateral (values
    (case when block ->> 'type' in ('image', 'audio', 'pdf')
      or (block ->> 'type' = 'video' and not block ? 'provider') then block -> 'src' end),
    (case when block ->> 'type' = 'video' and not block ? 'provider' then block -> 'poster' end)
  ) as media(ref)
  where jsonb_typeof(ref -> 'assetId') = 'string' and ref = jsonb_build_object('assetId', ref -> 'assetId');
$$;

create function private.public_resource_media_ids(p_document jsonb)
returns jsonb
language sql immutable strict parallel safe security invoker
set search_path = pg_catalog
as $$
  select coalesce(private.public_rich_media_ids(p_document -> 'body'), '[]'::jsonb)
    || coalesce(jsonb_path_query_array(p_document -> 'attachments',
      'strict $ ? (@.type() == "array")[*] ? (@.src.assetId.type() == "string").src.assetId'), '[]'::jsonb);
$$;

revoke all on function private.public_rich_media_ids(jsonb), private.public_resource_media_ids(jsonb) from public, anon, authenticated;
grant execute on function private.public_rich_media_ids(jsonb), private.public_resource_media_ids(jsonb) to service_role;

create index resources_public_media_ids_idx
  on public.resources using gin (private.public_resource_media_ids(document))
  where status = 'published' and branch_scope ->> 'scope' = 'global';

create index opportunities_public_media_ids_idx
  on public.opportunities using gin (private.public_rich_media_ids(description))
  where status = 'published' and branch_scope ->> 'scope' = 'global';

create index course_version_outline_public_cover_idx
  on public.course_version_outline ((meta #>> '{cover,assetId}'))
  where access ->> 'scope' = 'global' and jsonb_typeof(meta #> '{cover,assetId}') = 'string';

-- The primary key bounds the file lookup and projects_cover_asset_id indexes project
-- covers. Only matching visible parents are paged; rich source data is read after the limit.
create function public.academy_public_media_asset(
  p_asset_id text, p_hidden_prefix text, p_hidden_ids text[], p_after_kind text, p_after_id text, p_page_size integer
)
returns table (bucket text, path text, size_bytes bigint, source_kind text, parent_id text, source jsonb)
language sql stable security invoker
set search_path = pg_catalog
as $$
  select asset.bucket, asset.path, asset.size_bytes, candidate.kind, candidate.id,
    case candidate.kind
      when 'resource' then (select r.document from public.resources as r where r.id = candidate.id)
      when 'opportunity' then (select o.description from public.opportunities as o where o.id = candidate.id)
    end
  from public.media_assets as asset
  cross join lateral (
    select refs.kind, refs.id from (
      select 'course' as kind, course.id
      from public.course_version_outline as edition
      join public.courses as course
        on course.id = edition.course_id and course.current_version_id = edition.version_id
      where course.status = 'published' and edition.access ->> 'scope' = 'global'
        and jsonb_typeof(edition.meta #> '{cover,assetId}') = 'string'
        and edition.meta #>> '{cover,assetId}' = asset.id
        and edition.meta -> 'cover' = jsonb_build_object('assetId', asset.id)

      union all

      select 'project', project.id from public.projects as project
      where project.approved and project.branch_scope ->> 'scope' = 'global'
        and project.status in ('idea', 'forming', 'active', 'completed', 'showcased')
        and project.cover_asset_id = asset.id

      union all

      select 'resource', resource.id from public.resources as resource
      where resource.status = 'published' and resource.branch_scope ->> 'scope' = 'global'
        and private.public_resource_media_ids(resource.document) ? asset.id

      union all

      select 'opportunity', opportunity.id from public.opportunities as opportunity
      where opportunity.status = 'published' and opportunity.branch_scope ->> 'scope' = 'global'
        and private.public_rich_media_ids(opportunity.description) ? asset.id
    ) as refs
    where (p_hidden_prefix is null or not starts_with(refs.id, p_hidden_prefix))
      and refs.id <> all(p_hidden_ids)
      and (refs.kind, refs.id) > (p_after_kind, p_after_id)
    order by refs.kind, refs.id
    limit least(greatest(p_page_size, 1), 8)
  ) as candidate
  where asset.id = p_asset_id and asset.bucket = 'media'
  order by candidate.kind, candidate.id;
$$;

revoke all on function public.academy_public_media_asset(text, text, text[], text, text, integer) from public, anon, authenticated;
grant execute on function public.academy_public_media_asset(text, text, text[], text, text, integer) to service_role;
