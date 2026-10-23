-- Preserve published learner destinations for foreign shared content.
-- The media-purpose wrapper must only canonicalize editable content links;
-- read-only entries already carry immutable publication data and learner URLs.
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
        when entry ->> 'content_type' = 'resource' and entry ->> 'editable' = 'true'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/library?type=resource&id=' || (entry ->> 'content_id'))::text))
        when entry ->> 'content_type' = 'opportunity' and entry ->> 'editable' = 'true'
          then jsonb_set(entry, '{studio_href}', to_jsonb(('/studio/library?type=opportunity&id=' || (entry ->> 'content_id'))::text))
        when entry ->> 'content_type' = 'project' and entry ->> 'editable' = 'true'
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
