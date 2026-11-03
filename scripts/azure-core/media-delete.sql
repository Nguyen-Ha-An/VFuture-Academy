-- Azure-only physical deletion of unused Studio content. The journal retains the
-- original asset metadata after its active library row and remote bytes are gone.
create table academy_private.media_deletion_guards (
  asset_id text primary key,
  state text not null default 'active' check(state in ('active','pending','deleted')),
  revision bigint not null default 0,
  snapshot jsonb,
  started_by uuid,
  started_at timestamptz,
  completed_at timestamptz
);
alter table academy_private.media_deletion_guards enable row level security;
revoke all on academy_private.media_deletion_guards from public,anon,authenticated,service_role;

create function academy_private.media_decode_url_text(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare offset_index int:=1; decoded bytea:=''::bytea; pair text;
begin
  if position('%' in p_value)=0 then return p_value; end if;
  while offset_index<=char_length(p_value) loop
    pair:=substring(p_value from offset_index+1 for 2);
    if substring(p_value from offset_index for 1)='%' and pair ~ '^[0-9A-Fa-f]{2}$' then
      decoded:=decoded||decode(pair,'hex');offset_index:=offset_index+3;
    else decoded:=decoded||convert_to(substring(p_value from offset_index for 1),'UTF8');offset_index:=offset_index+1;end if;
  end loop;
  return convert_from(decoded,'UTF8');
exception when character_not_in_repertoire or untranslatable_character then return p_value;
end $$;
create function academy_private.media_row_references(p_row jsonb,p_asset text)
returns boolean language plpgsql stable set search_path='' as $$
declare object_bucket text; object_path text; scalar text;
begin
  select bucket,path into object_bucket,object_path from public.media_assets where id=p_asset;
  if not found then select snapshot->>'bucket',snapshot->>'path' into object_bucket,object_path
    from academy_private.media_deletion_guards where asset_id=p_asset; end if;
  for scalar in select value #>> '{}' from jsonb_path_query(p_row,'strict $.** ? (@.type() == "string")') s(value) loop
    scalar:=academy_private.media_decode_url_text(scalar);
    if scalar=p_asset or position('/api/v1/media/'||p_asset in scalar)>0
      or position('/api/v1/public/media/'||p_asset in scalar)>0
      or position('/media/'||p_asset||'/' in scalar)>0
      or (nullif(object_path,'') is not null and (scalar=object_path or position('/'||object_bucket||'/'||object_path in scalar)>0)) then return true; end if;
  end loop;
  return false;
end $$;
create function academy_private.media_reference_tables()
returns text[] language sql immutable set search_path='' as $$
 select array['course_drafts','course_draft_items','course_versions','course_version_items','course_version_item_renders',
 'course_version_outline','bank_question_versions','resources','projects','opportunities','submission_files','certificates',
 'notebook_artifacts','notebook_drafts','cms_content_drafts','cms_content_snapshots','cms_review_requests','cms_publications','profiles'];
$$;

-- Every reference writer UPDATES the same per-asset row that deletion locks.
-- This is intentional: a mere advisory/row lock would allow a stale REPEATABLE
-- READ snapshot to miss a writer that committed while deletion waited. The row
-- version update makes that stale deleter serialize-fail instead.
create function academy_private.media_fence_reference(p_asset text)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into academy_private.media_deletion_guards(asset_id) values(p_asset) on conflict do nothing;
  update academy_private.media_deletion_guards set revision=revision+1 where asset_id=p_asset and state='active';
  if not found then raise exception 'MEDIA_PROTECTED'; end if;
end $$;
create function academy_private.media_reference_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate text;
begin
  for candidate in
    select id from (select id from public.media_assets union select asset_id from academy_private.media_deletion_guards) assets
      where academy_private.media_row_references(to_jsonb(new),id) order by id
  loop perform academy_private.media_fence_reference(candidate); end loop;
  return new;
end $$;
create function academy_private.media_asset_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate text;
begin
  if tg_op='DELETE' then
    if old.bucket='media' and old.purpose='content' and
      (current_setting('academy.media.delete_finish',true) is distinct from old.id or not exists(
        select 1 from academy_private.media_deletion_guards where asset_id=old.id and state='pending')) then raise exception 'MEDIA_PROTECTED'; end if;
    return old;
  end if;
  -- Also fence aliases of the same object: a second asset ID must not acquire
  -- a reference to a path while the original asset is being physically removed.
  for candidate in
    select id from (
      select new.id id union select id from public.media_assets where bucket=new.bucket and path=new.path
      union select asset_id from academy_private.media_deletion_guards where snapshot->>'bucket'=new.bucket and snapshot->>'path'=new.path
    ) candidates order by id
  loop perform academy_private.media_fence_reference(candidate); end loop;
  return new;
end $$;
do $$declare relation text;begin
  foreach relation in array academy_private.media_reference_tables() loop
    execute format('create trigger zz_academy_media_reference_guard before insert or update on public.%I for each row execute function academy_private.media_reference_guard()',relation);
  end loop;
end $$;
-- Existing CMS guards run first and retain their established lock ordering.
create trigger zz_academy_media_asset_guard before insert or update or delete on public.media_assets
for each row execute function academy_private.media_asset_guard();

create function academy_private.media_assert_delete_actor(p_actor uuid,p_snapshot jsonb,p_scope_kind text,p_branch_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_scope_kind not in ('central','branch') or p_scope_kind is null or
    (p_scope_kind='central' and p_branch_id is not null) or
    (p_scope_kind='branch' and (p_branch_id is null or p_snapshot->>'ownership_kind'<>'branch' or p_snapshot->>'owner_branch_id' is distinct from p_branch_id)) then
    raise insufficient_privilege using message='Permission denied';
  end if;
  if not coalesce(public.authorization_has_permission(p_actor,'content.edit',p_scope_kind,p_branch_id),false)
    and not coalesce(public.authorization_has_permission(p_actor,'media.upload',p_scope_kind,p_branch_id),false) then
    raise insufficient_privilege using message='Permission denied';
  end if;
end $$;

create function public.academy_media_delete_begin(p_actor uuid,p_asset text,p_scope_kind text,p_branch_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare guard academy_private.media_deletion_guards; asset public.media_assets; relation text; referenced boolean;
begin
  perform public.cms_lock_content('media_asset',p_asset);
  insert into academy_private.media_deletion_guards(asset_id) values(p_asset) on conflict do nothing;
  select * into guard from academy_private.media_deletion_guards where asset_id=p_asset for update;
  if not found then raise serialization_failure; end if;
  if guard.state<>'active' then
    perform academy_private.media_assert_delete_actor(p_actor,guard.snapshot,p_scope_kind,p_branch_id);
    return jsonb_build_object('id',p_asset,'bucket',guard.snapshot->>'bucket','path',guard.snapshot->>'path','state',guard.state);
  end if;
  select * into asset from public.media_assets where id=p_asset for update;
  if not found then raise exception 'MEDIA_NOT_FOUND'; end if;
  perform academy_private.media_assert_delete_actor(p_actor,to_jsonb(asset),p_scope_kind,p_branch_id);
  if asset.bucket<>'media' or asset.purpose<>'content' then raise exception 'MEDIA_PROTECTED'; end if;
  if exists(select 1 from public.cms_review_requests where content_type='media_asset' and content_id=p_asset and status='pending') then raise exception 'MEDIA_REVIEW_PENDING'; end if;
  if exists(select 1 from public.media_assets where id<>p_asset and bucket=asset.bucket and path=asset.path) then raise exception 'MEDIA_IN_USE'; end if;
  foreach relation in array academy_private.media_reference_tables() loop
    execute format('select exists(select 1 from public.%I row where academy_private.media_row_references(to_jsonb(row),$1))',relation) into referenced using p_asset;
    if referenced then raise exception 'MEDIA_IN_USE'; end if;
  end loop;
  update academy_private.media_deletion_guards set state='pending',revision=revision+1,snapshot=to_jsonb(asset),started_by=p_actor,started_at=clock_timestamp() where asset_id=p_asset;
  insert into public.audit_log(actor_id,action,target_type,target_id,after) values(p_actor,'media.delete.requested','media_asset',p_asset,jsonb_build_object('state','pending'));
  return jsonb_build_object('id',p_asset,'bucket',asset.bucket,'path',asset.path,'state','pending');
end $$;
create function public.academy_media_delete_finish(p_actor uuid,p_asset text,p_scope_kind text,p_branch_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare guard academy_private.media_deletion_guards;
begin
  perform public.cms_lock_content('media_asset',p_asset);
  select * into guard from academy_private.media_deletion_guards where asset_id=p_asset for update;
  if not found or guard.state='active' then raise exception 'MEDIA_NOT_FOUND'; end if;
  perform academy_private.media_assert_delete_actor(p_actor,guard.snapshot,p_scope_kind,p_branch_id);
  if guard.state='deleted' then return jsonb_build_object('id',p_asset,'bucket',guard.snapshot->>'bucket','path',guard.snapshot->>'path','state','deleted'); end if;
  -- The retained Storage adapter removes this inventory row only after actual
  -- object-info confirms absence, while native-token holds stay quarantined.
  if exists(select 1 from academy_private.storage_objects where bucket_id=guard.snapshot->>'bucket' and name=guard.snapshot->>'path') then raise exception 'MEDIA_BYTES_REMAIN'; end if;
  perform set_config('academy.media.delete_finish',p_asset,true);
  delete from public.media_assets where id=p_asset;
  update academy_private.media_deletion_guards set state='deleted',revision=revision+1,completed_at=clock_timestamp() where asset_id=p_asset;
  insert into public.audit_log(actor_id,action,target_type,target_id,after) values(p_actor,'media.delete.completed','media_asset',p_asset,jsonb_build_object('state','deleted'));
  return jsonb_build_object('id',p_asset,'bucket',guard.snapshot->>'bucket','path',guard.snapshot->>'path','state','deleted');
end $$;
revoke all on function academy_private.media_decode_url_text(text),academy_private.media_row_references(jsonb,text),academy_private.media_reference_tables(),academy_private.media_fence_reference(text),academy_private.media_reference_guard(),academy_private.media_asset_guard(),academy_private.media_assert_delete_actor(uuid,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.academy_media_delete_begin(uuid,text,text,text),public.academy_media_delete_finish(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.academy_media_delete_begin(uuid,text,text,text),public.academy_media_delete_finish(uuid,text,text,text) to service_role;
