-- Private notebook assets and optimistic draft revisions. Application services
-- authorize the enrollment/course owner before invoking these service-only RPCs.
create table public.notebook_artifacts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  course_id text not null references public.courses(id),
  course_version_id uuid references public.course_versions(id),
  item_id text not null,
  block_id text,
  purpose text not null check (purpose in ('template','dataset','draft','submission')),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  template_asset_id uuid references public.notebook_artifacts(id),
  template_checksum text,
  runtime_profile_id text not null,
  runtime_profile_version text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  mime text not null,
  filename text not null,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now(),
  check (purpose in ('template','dataset') or (course_version_id is not null and template_asset_id is not null and template_checksum is not null)),
  check (purpose = 'dataset' or size_bytes <= 5242880),
  check ((purpose = 'dataset' and mime in ('text/csv','application/json'))
    or (purpose <> 'dataset' and mime = 'application/x-ipynb+json')),
  check ((purpose = 'dataset' and filename ~* '\.(csv|json)$')
    or (purpose <> 'dataset' and filename ~* '\.ipynb$'))
);
create index notebook_artifacts_target on public.notebook_artifacts(owner_id,course_version_id,item_id,block_id);
create index notebook_artifacts_pending on public.notebook_artifacts(created_at) where status = 'pending';
alter table public.notebook_artifacts enable row level security;
revoke all on public.notebook_artifacts from anon, authenticated;
grant select, insert, delete on public.notebook_artifacts to service_role;

create function public.prevent_ready_notebook_artifact_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'ready' then
    raise exception 'NOTEBOOK_ARTIFACT_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if (new.id,new.owner_id,new.course_id,new.course_version_id,new.item_id,new.block_id,new.purpose,
      new.template_asset_id,new.template_checksum,new.runtime_profile_id,new.runtime_profile_version,
      new.mime,new.filename,new.created_at)
    is distinct from
     (old.id,old.owner_id,old.course_id,old.course_version_id,old.item_id,old.block_id,old.purpose,
      old.template_asset_id,old.template_checksum,old.runtime_profile_id,old.runtime_profile_version,
      old.mime,old.filename,old.created_at) then
    raise exception 'NOTEBOOK_ARTIFACT_TARGET_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger prevent_ready_notebook_artifact_mutation
before update or delete on public.notebook_artifacts
for each row execute function public.prevent_ready_notebook_artifact_mutation();
revoke all on function public.prevent_ready_notebook_artifact_mutation() from public, anon, authenticated, service_role;

create table public.notebook_drafts (
  user_id uuid not null references auth.users(id),
  course_version_id uuid not null references public.course_versions(id),
  item_id text not null,
  block_id text,
  artifact_id uuid not null references public.notebook_artifacts(id),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct(user_id,course_version_id,item_id,block_id)
);
alter table public.notebook_drafts enable row level security;
revoke all on public.notebook_drafts from anon, authenticated;
grant select on public.notebook_drafts to service_role;

create function public.save_notebook_draft(
  p_user_id uuid, p_course_version_id uuid, p_item_id text, p_block_id text,
  p_artifact_id uuid, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.notebook_drafts;
begin
  if not exists (select 1 from public.notebook_artifacts a where a.id=p_artifact_id
    and a.owner_id=p_user_id and a.course_version_id=p_course_version_id
    and a.item_id=p_item_id and a.block_id is not distinct from p_block_id
    and a.purpose='draft' and a.status='ready') then
    raise exception 'NOTEBOOK_ARTIFACT_INVALID';
  end if;
  if p_expected_revision = 0 then
    insert into public.notebook_drafts(user_id,course_version_id,item_id,block_id,artifact_id)
    values(p_user_id,p_course_version_id,p_item_id,p_block_id,p_artifact_id)
    on conflict do nothing returning * into saved;
  else
    update public.notebook_drafts set artifact_id=p_artifact_id,revision=revision+1,updated_at=now()
    where user_id=p_user_id and course_version_id=p_course_version_id and item_id=p_item_id
      and block_id is not distinct from p_block_id and revision=p_expected_revision
    returning * into saved;
  end if;
  if saved.revision is null then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('revision',saved.revision,'artifactId',saved.artifact_id,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.save_notebook_draft(uuid,uuid,text,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.save_notebook_draft(uuid,uuid,text,text,uuid,bigint) to service_role;

create function public.finalize_notebook_artifact(p_id uuid,p_owner_id uuid,p_path text,p_checksum text,p_size bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare artifact public.notebook_artifacts;
begin
 select * into artifact from public.notebook_artifacts where id=p_id and owner_id=p_owner_id for update;
 if artifact.id is null then raise exception 'NOTEBOOK_ARTIFACT_INVALID'; end if;
 if artifact.status='ready' then return; end if;
 insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes,ownership_kind,owner_branch_id)
 select artifact.id::text,artifact.owner_id,'notebooks',p_path,artifact.mime,p_size,c.ownership_kind,c.owner_branch_id
 from public.courses c where c.id=artifact.course_id;
 update public.notebook_artifacts set storage_path=p_path,checksum=p_checksum,size_bytes=p_size,status='ready' where id=p_id;
end $$;
revoke all on function public.finalize_notebook_artifact(uuid,uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.finalize_notebook_artifact(uuid,uuid,text,text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('notebooks','notebooks',false,10485760,array['application/x-ipynb+json','application/json','text/csv'])
on conflict(id) do nothing;

-- Once notebook storage exists, CMS snapshots must pin actual ready assets.
-- This also guards service-role callers that accidentally bypass the TS adapter.
create function public.guard_notebook_review_dependencies()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare dependency jsonb; asset jsonb; stored public.notebook_artifacts;
begin
  for dependency in select value from jsonb_array_elements(new.dependencies) where value->>'kind'='notebook' loop
    if jsonb_typeof(dependency->'assets') is distinct from 'array' then
      raise exception 'CMS_NOTEBOOK_DEPENDENCIES_INVALID';
    end if;
    if (select count(*) from jsonb_array_elements(dependency->'assets') a where a->>'purpose'='template') <> 1 then
      raise exception 'CMS_NOTEBOOK_DEPENDENCIES_INVALID';
    end if;
    for asset in select value from jsonb_array_elements(dependency->'assets') loop
      select * into stored from public.notebook_artifacts where id::text=asset->>'id';
      if stored.id is null or stored.status<>'ready' or stored.course_id<>new.content_id
        or stored.purpose not in ('template','dataset')
        or stored.purpose is distinct from asset->>'purpose'
        or stored.checksum is distinct from asset->>'checksum'
        or stored.size_bytes::text is distinct from asset->>'sizeBytes' then
        raise exception 'CMS_NOTEBOOK_DEPENDENCIES_INVALID';
      end if;
    end loop;
  end loop;
  return new;
end $$;
create trigger cms_notebook_dependency_guard before insert on public.cms_content_snapshots
for each row execute function public.guard_notebook_review_dependencies();
revoke all on function public.guard_notebook_review_dependencies() from public,anon,authenticated,service_role;
