-- CMS security-definer functions deliberately use a narrow search_path. On
-- hosted Supabase, pgcrypto can live in `extensions`, so unqualified digest()
-- calls fail inside those functions even when the extension is installed.
-- Provide a private callable bridge only when pgcrypto is not already in
-- public, then make the invalidation trigger explicit in either layout.
create or replace function public.cms_pgcrypto_digest(
  p_value text,
  p_algorithm text
)
returns bytea
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  extension_schema name;
  result bytea;
begin
  select namespace.nspname
    into extension_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if extension_schema is null then
    raise exception using errcode = '42883', message = 'CMS_PGCRYPTO_UNAVAILABLE';
  end if;

  execute format('select %I.digest($1, $2)', extension_schema)
    into result
    using p_value, p_algorithm;
  return result;
end;
$$;
revoke all on function public.cms_pgcrypto_digest(text, text) from public, anon, authenticated, service_role;

do $$
begin
  -- Fresh local databases install pgcrypto in public; hosted projects often
  -- install it in extensions. Preserve the former and bridge the latter.
  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'digest'
      and procedure.proargtypes = '25 25'::oidvector
  ) then
    execute $function$
      create function public.digest(value text, algorithm text)
      returns bytea
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $body$
        select public.cms_pgcrypto_digest(value, algorithm)
      $body$
    $function$;
    revoke all on function public.digest(text, text) from public, anon, authenticated, service_role;
  end if;
end;
$$;

create or replace function public.cms_invalidate_source_review_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_row jsonb;
begin
  new_row := to_jsonb(new);
  if tg_table_name = 'course_drafts' then
    perform public.cms_invalidate_reviews('course', new_row->>'course_id', new_row->>'updated_at');
  elsif tg_table_name = 'bank_question_versions' then
    perform public.cms_invalidate_reviews('bank_question', new_row->>'question_id', new_row->>'id');
  elsif tg_table_name = 'resources' and new_row->>'status' <> 'published' then
    perform public.cms_invalidate_reviews('resource', new_row->>'id', new_row->>'updated_at');
  elsif tg_table_name = 'opportunities' and new_row->>'status' <> 'published' then
    perform public.cms_invalidate_reviews('opportunity', new_row->>'id', new_row->>'updated_at');
  elsif tg_table_name = 'projects' and not coalesce((new_row->>'approved')::boolean, false) then
    perform public.cms_invalidate_reviews('project', new_row->>'id', new_row->>'updated_at');
  elsif tg_table_name = 'media_assets' then
    perform public.cms_invalidate_reviews(
      'media_asset',
      new_row->>'id',
      encode(
        public.cms_pgcrypto_digest(
          (new_row->>'bucket') || ':' || (new_row->>'path') || ':' ||
          (new_row->>'size_bytes') || ':' || (new_row->>'mime') || ':' ||
          coalesce((new_row->'alt')::text, 'null'),
          'sha256'
        ),
        'hex'
      )
    );
  end if;
  return new;
end;
$$;
revoke all on function public.cms_invalidate_source_review_trigger() from public, anon, authenticated, service_role;
