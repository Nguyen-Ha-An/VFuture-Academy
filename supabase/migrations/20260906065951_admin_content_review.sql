-- Central CMS ownership, immutable review snapshots, and atomic publication gates.
-- Existing content is intentionally backfilled to Central ownership. Audience remains
-- an independent distribution setting and never grants authoring access.

alter table public.courses
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add constraint courses_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

alter table public.bank_questions
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add constraint bank_questions_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

alter table public.resources
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add constraint resources_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

alter table public.opportunities
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add column created_by uuid references public.profiles(id),
  add constraint opportunities_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

alter table public.projects
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add constraint projects_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

alter table public.media_assets
  add column ownership_kind text not null default 'central'
    check (ownership_kind in ('central', 'branch')),
  add column owner_branch_id text references public.branches(id),
  add constraint media_assets_valid_ownership check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  );

create index courses_content_owner_idx on public.courses (ownership_kind, owner_branch_id, updated_at desc);
create index bank_questions_content_owner_idx on public.bank_questions (ownership_kind, owner_branch_id, updated_at desc);
create index resources_content_owner_idx on public.resources (ownership_kind, owner_branch_id, updated_at desc);
create index opportunities_content_owner_idx on public.opportunities (ownership_kind, owner_branch_id, updated_at desc);
create index projects_content_owner_idx on public.projects (ownership_kind, owner_branch_id, updated_at desc);
create index media_assets_content_owner_idx on public.media_assets (ownership_kind, owner_branch_id, created_at desc);

create or replace function public.cms_guard_live_content_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare old_row jsonb; new_row jsonb;
begin
  old_row := to_jsonb(old);
  new_row := to_jsonb(new);
  if current_setting('vfuture.cms_publishing', true) = 'on' then return new; end if;
  if tg_table_name in ('resources', 'opportunities') and (
    (old_row->>'status' <> 'published' and new_row->>'status' = 'published')
    or (old_row->>'status' = 'published' and new_row is distinct from old_row)
  ) then
    raise exception using errcode = '42501', message = 'CMS_REVIEW_PUBLICATION_REQUIRED';
  end if;
  if tg_table_name = 'projects' and (
    (not coalesce((old_row->>'approved')::boolean, false) and coalesce((new_row->>'approved')::boolean, false))
    or (coalesce((old_row->>'approved')::boolean, false) and new_row is distinct from old_row)
  ) then
    raise exception using errcode = '42501', message = 'CMS_REVIEW_PUBLICATION_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function public.cms_guard_live_content_mutation() from public, anon, authenticated, service_role;
create trigger resources_cms_live_guard before update on public.resources for each row execute function public.cms_guard_live_content_mutation();
create trigger opportunities_cms_live_guard before update on public.opportunities for each row execute function public.cms_guard_live_content_mutation();
create trigger projects_cms_live_guard before update on public.projects for each row execute function public.cms_guard_live_content_mutation();

-- Non-versioned legacy entities keep their active row unchanged while a later
-- revision is edited. Studio reads the draft; learner/public reads keep using
-- the published row until the draft completes a new review.
create table public.cms_content_drafts (
  content_type text not null check (content_type in ('resource', 'opportunity', 'project')),
  content_id text not null,
  revision_key text not null,
  source jsonb not null,
  audience jsonb not null default '{}'::jsonb,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (content_type, content_id)
);
alter table public.cms_content_drafts enable row level security;
revoke all on table public.cms_content_drafts from public, anon, authenticated;
grant select, insert, update, delete on table public.cms_content_drafts to service_role;

create table public.cms_content_snapshots (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in (
    'course', 'bank_question', 'resource', 'opportunity', 'project', 'media_asset'
  )),
  content_id text not null,
  revision_key text not null,
  checksum text not null,
  ownership_kind text not null check (ownership_kind in ('central', 'branch')),
  owner_branch_id text references public.branches(id),
  audience jsonb not null default '{}'::jsonb,
  source jsonb not null,
  dependencies jsonb not null default '[]'::jsonb check (jsonb_typeof(dependencies) = 'array'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (content_type, content_id, revision_key, checksum),
  check (
    (ownership_kind = 'central' and owner_branch_id is null)
    or (ownership_kind = 'branch' and owner_branch_id is not null)
  )
);

alter table public.cms_content_snapshots
  add constraint cms_content_snapshots_identity unique (content_type, content_id, id);

create table public.cms_review_requests (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  snapshot_id uuid not null references public.cms_content_snapshots(id),
  status text not null default 'pending'
    check (status in ('pending', 'changes_requested', 'approved', 'stale', 'published')),
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewer_id uuid references public.profiles(id),
  decision_note text,
  decided_at timestamptz,
  self_review boolean not null default false,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  foreign key (content_type, content_id, snapshot_id)
    references public.cms_content_snapshots(content_type, content_id, id)
);

create table public.cms_publications (
  content_type text not null,
  content_id text not null,
  snapshot_id uuid not null references public.cms_content_snapshots(id),
  review_id uuid not null unique references public.cms_review_requests(id),
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  primary key (content_type, content_id)
);

create unique index cms_one_active_review_idx
  on public.cms_review_requests (content_type, content_id)
  where status in ('pending', 'approved');
create index cms_review_queue_idx on public.cms_review_requests (status, submitted_at desc);
create index cms_review_snapshot_idx on public.cms_review_requests (snapshot_id);
create index cms_snapshot_owner_idx on public.cms_content_snapshots (ownership_kind, owner_branch_id, created_at desc);
create index cms_publications_snapshot_idx on public.cms_publications (snapshot_id);

alter table public.cms_content_snapshots enable row level security;
alter table public.cms_review_requests enable row level security;
alter table public.cms_publications enable row level security;
revoke all on table public.cms_content_snapshots, public.cms_review_requests, public.cms_publications from public, anon, authenticated;
grant select, insert on table public.cms_content_snapshots to service_role;
grant select, insert, update on table public.cms_review_requests to service_role;
grant select, insert, update on table public.cms_publications to service_role;

create or replace function public.prevent_cms_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '55000', message = 'CMS snapshots are immutable';
end;
$$;
revoke all on function public.prevent_cms_snapshot_mutation() from public, anon, authenticated, service_role;
create trigger cms_content_snapshots_immutable
  before update or delete on public.cms_content_snapshots
  for each row execute function public.prevent_cms_snapshot_mutation();

-- Seed review history for content that was already live before Central review
-- existed, so the first reviewed edit has an exact published baseline.
create function public.cms_backfill_publication(
  p_content_type text, p_content_id text, p_revision_key text, p_checksum text,
  p_ownership_kind text, p_owner_branch_id text, p_audience jsonb, p_source jsonb,
  p_actor_user_id uuid, p_published_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare snapshot_id uuid; review_id uuid;
begin
  if p_actor_user_id is null or not exists (select 1 from public.profiles where id=p_actor_user_id) then return; end if;
  insert into public.cms_content_snapshots(
    content_type,content_id,revision_key,checksum,ownership_kind,owner_branch_id,
    audience,source,dependencies,created_by,created_at
  ) values (
    p_content_type,p_content_id,p_revision_key,p_checksum,p_ownership_kind,p_owner_branch_id,
    coalesce(p_audience,'{}'::jsonb),p_source,'[]'::jsonb,p_actor_user_id,coalesce(p_published_at,now())
  ) returning id into snapshot_id;
  insert into public.cms_review_requests(
    content_type,content_id,snapshot_id,status,submitted_by,submitted_at,reviewer_id,
    decision_note,decided_at,self_review,published_by,published_at
  ) values (
    p_content_type,p_content_id,snapshot_id,'published',p_actor_user_id,coalesce(p_published_at,now()),
    p_actor_user_id,'Legacy publication backfill',coalesce(p_published_at,now()),true,
    p_actor_user_id,coalesce(p_published_at,now())
  ) returning id into review_id;
  insert into public.cms_publications(content_type,content_id,snapshot_id,review_id,published_by,published_at)
  values(p_content_type,p_content_id,snapshot_id,review_id,p_actor_user_id,coalesce(p_published_at,now()));
end;
$$;
revoke all on function public.cms_backfill_publication(text,text,text,text,text,text,jsonb,jsonb,uuid,timestamptz)
  from public,anon,authenticated,service_role;

select public.cms_backfill_publication(
  'course',course.id,version.id::text,version.checksum,course.ownership_kind,course.owner_branch_id,
  outline.access,jsonb_build_object(
    'manifest',version.manifest,
    'items',coalesce((select jsonb_object_agg(item.item_id,jsonb_build_object(
      'source',item.source,'grading',item.grading,'checksum',item.checksum
    ) order by item.item_id) from public.course_version_items item where item.version_id=version.id),'{}'::jsonb),
    'versionId',version.id
  ),version.published_by,version.published_at
)
from public.courses course
join public.course_versions version on version.id=course.current_version_id
join public.course_version_outline outline on outline.version_id=version.id
where course.status='published';

select public.cms_backfill_publication(
  'bank_question',question.id,version.id::text,
  encode(digest(jsonb_build_object('question',to_jsonb(question),'version',to_jsonb(version))::text,'sha256'),'hex'),
  question.ownership_kind,question.owner_branch_id,'{}'::jsonb,
  jsonb_build_object('question',to_jsonb(question),'version',to_jsonb(version)),
  version.created_by,version.created_at
)
from public.bank_questions question
join public.bank_question_versions version on version.id=question.current_version_id
where question.status='published';

select public.cms_backfill_publication(
  'resource',resource.id,resource.updated_at::text,
  encode(digest(jsonb_build_object('document',resource.document)::text,'sha256'),'hex'),
  resource.ownership_kind,resource.owner_branch_id,resource.branch_scope,
  jsonb_build_object('document',resource.document),resource.owner_id,resource.published_at
)
from public.resources resource where resource.status='published';

select public.cms_backfill_publication(
  'opportunity',opportunity.id,opportunity.updated_at::text,
  encode(digest(jsonb_build_object('record',to_jsonb(opportunity)-'search')::text,'sha256'),'hex'),
  opportunity.ownership_kind,opportunity.owner_branch_id,opportunity.branch_scope,
  jsonb_build_object('record',to_jsonb(opportunity)-'search'),
  coalesce(opportunity.created_by,(select profile.id from public.profiles profile order by profile.id limit 1)),
  opportunity.published_at
)
from public.opportunities opportunity where opportunity.status='published';

select public.cms_backfill_publication(
  'project',project.id,project.updated_at::text,
  encode(digest(jsonb_build_object(
    'record',to_jsonb(project),'members',coalesce((select jsonb_agg(to_jsonb(member) order by member.user_id)
      from public.project_members member where member.project_id=project.id),'[]'::jsonb)
  )::text,'sha256'),'hex'),
  project.ownership_kind,project.owner_branch_id,project.branch_scope,
  jsonb_build_object(
    'record',to_jsonb(project),'members',coalesce((select jsonb_agg(to_jsonb(member) order by member.user_id)
      from public.project_members member where member.project_id=project.id),'[]'::jsonb)
  ),project.owner_id,project.published_at
)
from public.projects project where project.approved=true;

select public.cms_backfill_publication(
  'media_asset',asset.id,
  encode(digest(asset.bucket||':'||asset.path||':'||asset.size_bytes::text||':'||asset.mime||':'||coalesce(asset.alt::text,'null'),'sha256'),'hex'),
  encode(digest(to_jsonb(asset)::text,'sha256'),'hex'),asset.ownership_kind,asset.owner_branch_id,'{}'::jsonb,
  jsonb_build_object('asset',to_jsonb(asset)),
  coalesce((select profile.id from public.profiles profile where profile.id=asset.owner_id),
    (select profile.id from public.profiles profile order by profile.id limit 1)),asset.created_at
)
from public.media_assets asset;

drop function public.cms_backfill_publication(text,text,text,text,text,text,jsonb,jsonb,uuid,timestamptz);

create or replace function public.cms_current_snapshot(p_content_type text, p_content_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  case p_content_type
    when 'course' then
      select jsonb_build_object(
        'revision_key', draft.updated_at::text,
        'ownership_kind', course.ownership_kind,
        'owner_branch_id', course.owner_branch_id,
        'audience', coalesce(draft.manifest->'access', '{}'::jsonb),
        'source', jsonb_build_object(
          'manifest', draft.manifest,
          'items', coalesce((select jsonb_object_agg(item.item_id, item.document order by item.item_id)
            from public.course_draft_items item where item.draft_id = draft.id), '{}'::jsonb),
          'baseVersionId', draft.base_version_id
        )
      ) into result
      from public.courses course
      join public.course_drafts draft on draft.course_id = course.id
      where course.id = p_content_id;
    when 'bank_question' then
      select jsonb_build_object(
        'revision_key', version.id::text,
        'ownership_kind', question.ownership_kind,
        'owner_branch_id', question.owner_branch_id,
        'audience', '{}'::jsonb,
        'source', jsonb_build_object(
          'question', to_jsonb(question),
          'version', to_jsonb(version)
        )
      ) into result
      from public.bank_questions question
      join lateral (
        select candidate.* from public.bank_question_versions candidate
        where candidate.question_id = question.id
        order by candidate.version desc limit 1
      ) version on true
      where question.id = p_content_id;
    when 'resource' then
      select jsonb_build_object(
        'revision_key', coalesce(draft.revision_key, resource.updated_at::text),
        'has_draft', draft.content_id is not null,
        'ownership_kind', resource.ownership_kind,
        'owner_branch_id', resource.owner_branch_id,
        'audience', coalesce(draft.audience, resource.branch_scope),
        'source', coalesce(draft.source, jsonb_build_object('document', resource.document))
      ) into result from public.resources resource
      left join public.cms_content_drafts draft on draft.content_type = 'resource' and draft.content_id = resource.id
      where resource.id = p_content_id;
    when 'opportunity' then
      select jsonb_build_object(
        'revision_key', coalesce(draft.revision_key, opportunity.updated_at::text),
        'has_draft', draft.content_id is not null,
        'ownership_kind', opportunity.ownership_kind,
        'owner_branch_id', opportunity.owner_branch_id,
        'audience', coalesce(draft.audience, opportunity.branch_scope),
        'source', coalesce(draft.source, jsonb_build_object('record', to_jsonb(opportunity) - 'search'))
      ) into result from public.opportunities opportunity
      left join public.cms_content_drafts draft on draft.content_type = 'opportunity' and draft.content_id = opportunity.id
      where opportunity.id = p_content_id;
    when 'project' then
      select jsonb_build_object(
        'revision_key', coalesce(draft.revision_key, project.updated_at::text),
        'has_draft', draft.content_id is not null,
        'ownership_kind', project.ownership_kind,
        'owner_branch_id', project.owner_branch_id,
        'audience', coalesce(draft.audience, project.branch_scope),
        'source', coalesce(draft.source, jsonb_build_object(
          'record', to_jsonb(project),
          'members', coalesce((select jsonb_agg(to_jsonb(member) order by member.user_id)
            from public.project_members member where member.project_id = project.id), '[]'::jsonb)
        ))
      ) into result from public.projects project
      left join public.cms_content_drafts draft on draft.content_type = 'project' and draft.content_id = project.id
      where project.id = p_content_id;
    when 'media_asset' then
      select jsonb_build_object(
        'revision_key', encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex'),
        'ownership_kind', asset.ownership_kind,
        'owner_branch_id', asset.owner_branch_id,
        'audience', '{}'::jsonb,
        'source', jsonb_build_object('asset', to_jsonb(asset))
      ) into result from public.media_assets asset where asset.id = p_content_id;
    else
      raise exception using errcode = '22023', message = 'CMS_CONTENT_TYPE_INVALID';
  end case;
  if result is null then
    raise exception using errcode = 'P0002', message = 'CMS_CONTENT_NOT_FOUND';
  end if;
  return result;
end;
$$;
revoke all on function public.cms_current_snapshot(text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_content_access(
  p_actor_user_id uuid, p_content_type text, p_content_id text, p_permission text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare current_snapshot jsonb;
  fine_permission text;
begin
  if p_permission not in ('content.read','content.edit','content.review.request') then
    raise exception using errcode='22023',message='CMS_PERMISSION_INVALID';
  end if;
  current_snapshot := public.cms_current_snapshot(p_content_type,p_content_id);
  fine_permission := case p_content_type
    when 'course' then case when p_permission='content.read' then 'course.read' else 'course.edit' end
    when 'bank_question' then 'bank.edit' when 'resource' then 'resource.edit'
    when 'opportunity' then 'opportunity.edit' when 'project' then 'project.edit'
    when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id,p_permission,
      current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id')
    and not public.authorization_has_permission(p_actor_user_id,fine_permission,
      current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id') then
    raise exception using errcode='42501',message='Permission denied';
  end if;
end;
$$;
revoke all on function public.cms_assert_content_access(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cms_assert_content_access(uuid,text,text,text) to service_role;

create or replace function public.cms_get_editor_content(
  p_actor_user_id uuid, p_content_type text, p_content_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb; fine_permission text;
begin
  candidate := public.cms_current_snapshot(p_content_type,p_content_id);
  fine_permission := case p_content_type when 'course' then 'course.edit' when 'bank_question' then 'bank.edit'
    when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
    when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id,'content.edit',candidate->>'ownership_kind',candidate->>'owner_branch_id')
    and not public.authorization_has_permission(p_actor_user_id,fine_permission,candidate->>'ownership_kind',candidate->>'owner_branch_id') then
    raise exception using errcode='42501',message='Permission denied';
  end if;
  return candidate;
end;
$$;
revoke all on function public.cms_get_editor_content(uuid,text,text) from public,anon,authenticated;
grant execute on function public.cms_get_editor_content(uuid,text,text) to service_role;

create or replace function public.cms_assign_ownership(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_ownership_kind text,
  p_owner_branch_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_snapshot jsonb; fine_permission text;
begin
  if (p_ownership_kind = 'central' and p_owner_branch_id is not null)
    or (p_ownership_kind = 'branch' and p_owner_branch_id is null)
    or p_ownership_kind not in ('central', 'branch') then
    raise exception using errcode = '22023', message = 'CMS_OWNERSHIP_INVALID';
  end if;
  fine_permission := case p_content_type when 'course' then 'course.create' when 'bank_question' then 'bank.edit'
    when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
    when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end;
  if not public.authorization_has_permission(p_actor_user_id,'content.create',p_ownership_kind,p_owner_branch_id)
    and not public.authorization_has_permission(p_actor_user_id,fine_permission,p_ownership_kind,p_owner_branch_id) then
    raise exception using errcode='42501',message='Permission denied';
  end if;
  if exists (select 1 from public.cms_review_requests where content_type=p_content_type and content_id=p_content_id)
    or exists (select 1 from public.cms_publications where content_type=p_content_type and content_id=p_content_id) then
    raise exception using errcode = '55000', message = 'CMS_OWNERSHIP_LOCKED';
  end if;
  case p_content_type
    when 'course' then update public.courses set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'bank_question' then update public.bank_questions set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'resource' then update public.resources set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft';
    when 'opportunity' then update public.opportunities set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and status='draft' and created_by=p_actor_user_id;
    when 'project' then update public.projects set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and approved=false;
    when 'media_asset' then update public.media_assets set ownership_kind=p_ownership_kind,owner_branch_id=p_owner_branch_id where id=p_content_id and owner_id=p_actor_user_id;
    else raise exception using errcode='22023',message='CMS_CONTENT_TYPE_INVALID';
  end case;
  if not found then raise exception using errcode='42501',message='CMS_OWNERSHIP_ASSIGNMENT_DENIED'; end if;
  current_snapshot := public.cms_current_snapshot(p_content_type,p_content_id);
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after,branch_id)
  values(p_actor_user_id,'content.ownership.assign',p_content_type,p_content_id,null,
    jsonb_build_object('ownershipKind',p_ownership_kind,'ownerBranchId',p_owner_branch_id),p_owner_branch_id);
  return jsonb_build_object('content_type',p_content_type,'content_id',p_content_id,'ownership_kind',p_ownership_kind,'owner_branch_id',p_owner_branch_id);
end;
$$;
revoke all on function public.cms_assign_ownership(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.cms_assign_ownership(uuid,text,text,text,text) to service_role;

create or replace function public.cms_snapshot_dependencies(
  p_source jsonb,
  p_ownership_kind text,
  p_owner_branch_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  dependency jsonb;
  dependency_id text;
  dependency_row record;
  dependencies jsonb := '[]'::jsonb;
begin
  for dependency in select distinct value from jsonb_path_query(p_source, 'strict $.**.assetId') value
  loop
    dependency_id := dependency #>> '{}';
    select asset.id, asset.ownership_kind, asset.owner_branch_id,
      encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex') revision_key
    into dependency_row
    from public.media_assets asset where asset.id = dependency_id;
    if not found then
      raise exception using errcode = '23503', message = 'CMS_ASSET_NOT_FOUND';
    end if;
    if dependency_row.ownership_kind = 'branch'
      and (p_ownership_kind <> 'branch' or dependency_row.owner_branch_id is distinct from p_owner_branch_id) then
      raise exception using errcode = '42501', message = 'CMS_FOREIGN_ASSET';
    end if;
    dependencies := dependencies || jsonb_build_array(jsonb_build_object(
      'kind', 'asset', 'id', dependency_id, 'revision_key', dependency_row.revision_key
    ));
  end loop;

  for dependency in select distinct value
    from jsonb_path_query(p_source, 'strict $.**."$ref"') value
    where value #>> '{}' like 'bank:%'
  loop
    dependency_id := substring(dependency #>> '{}' from 6);
    select question.ownership_kind, question.owner_branch_id, version.id::text revision_key
    into dependency_row
    from public.bank_questions question
    join lateral (
      select candidate.id from public.bank_question_versions candidate
      where candidate.question_id = question.id order by candidate.version desc limit 1
    ) version on true
    where question.id = dependency_id;
    if not found then
      raise exception using errcode = '23503', message = 'CMS_BANK_VERSION_NOT_FOUND';
    end if;
    if dependency_row.ownership_kind = 'branch'
      and (p_ownership_kind <> 'branch' or dependency_row.owner_branch_id is distinct from p_owner_branch_id) then
      raise exception using errcode = '42501', message = 'CMS_FOREIGN_BANK_QUESTION';
    end if;
    dependencies := dependencies || jsonb_build_array(jsonb_build_object(
      'kind', 'bank_version', 'id', dependency_id, 'revision_key', dependency_row.revision_key
    ));
  end loop;
  return dependencies;
end;
$$;
revoke all on function public.cms_snapshot_dependencies(jsonb, text, text) from public, anon, authenticated, service_role;

create or replace function public.cms_assert_dependencies(p_dependencies jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  dependency jsonb;
  current_revision text;
begin
  for dependency in select value from jsonb_array_elements(p_dependencies)
  loop
    if dependency ->> 'kind' = 'asset' then
      select encode(digest(asset.bucket || ':' || asset.path || ':' || asset.size_bytes::text || ':' || asset.mime || ':' || coalesce(asset.alt::text, 'null'), 'sha256'), 'hex')
      into current_revision from public.media_assets asset where asset.id = dependency ->> 'id';
    elsif dependency ->> 'kind' = 'bank_version' then
      select version.id::text into current_revision
      from public.bank_question_versions version
      where version.question_id = dependency ->> 'id'
      order by version.version desc limit 1;
    elsif dependency ->> 'kind' = 'notebook' then
      if exists (
        select 1 from jsonb_array_elements(coalesce(dependency->'assets', '[]'::jsonb)) pinned
        where not exists (select 1 from public.media_assets asset where asset.id = pinned->>'id')
      ) then
        raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
      end if;
      continue;
    else
      raise exception using errcode = '22023', message = 'CMS_DEPENDENCY_KIND_INVALID';
    end if;
    if current_revision is null or current_revision is distinct from dependency ->> 'revision_key' then
      raise exception using errcode = '40001', message = 'CMS_DEPENDENCY_CHANGED';
    end if;
  end loop;
end;
$$;
revoke all on function public.cms_assert_dependencies(jsonb) from public, anon, authenticated, service_role;

create or replace function public.cms_invalidate_reviews(p_content_type text, p_content_id text, p_current_revision text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  update public.cms_review_requests review
  set status = 'stale', decided_at = coalesce(review.decided_at, now())
  from public.cms_content_snapshots snapshot
  where review.snapshot_id = snapshot.id
    and review.content_type = p_content_type
    and review.content_id = p_content_id
    and review.status in ('pending', 'approved')
    and snapshot.revision_key is distinct from p_current_revision;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.cms_invalidate_reviews(text, text, text) from public, anon, authenticated;
grant execute on function public.cms_invalidate_reviews(text, text, text) to service_role;

create or replace function public.cms_invalidate_source_review_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare new_row jsonb;
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
  elsif tg_table_name = 'projects' and not coalesce((new_row->>'approved')::boolean,false) then
    perform public.cms_invalidate_reviews('project', new_row->>'id', new_row->>'updated_at');
  elsif tg_table_name = 'media_assets' then
    perform public.cms_invalidate_reviews('media_asset', new_row->>'id',
      encode(digest((new_row->>'bucket') || ':' || (new_row->>'path') || ':' || (new_row->>'size_bytes') || ':' || (new_row->>'mime') || ':' || coalesce((new_row->'alt')::text, 'null'), 'sha256'), 'hex'));
  end if;
  return new;
end;
$$;
revoke all on function public.cms_invalidate_source_review_trigger() from public,anon,authenticated,service_role;
create trigger course_drafts_cms_review_invalidation after update on public.course_drafts for each row execute function public.cms_invalidate_source_review_trigger();
create trigger bank_versions_cms_review_invalidation after insert on public.bank_question_versions for each row execute function public.cms_invalidate_source_review_trigger();
create trigger resources_cms_review_invalidation after update on public.resources for each row execute function public.cms_invalidate_source_review_trigger();
create trigger opportunities_cms_review_invalidation after update on public.opportunities for each row execute function public.cms_invalidate_source_review_trigger();
create trigger projects_cms_review_invalidation after update on public.projects for each row execute function public.cms_invalidate_source_review_trigger();
create trigger media_assets_cms_review_invalidation after update on public.media_assets for each row execute function public.cms_invalidate_source_review_trigger();

create or replace function public.cms_save_content_draft(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_expected_revision text,
  p_source jsonb,
  p_audience jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_snapshot jsonb; next_revision text; fine_permission text;
begin
  if p_content_type not in ('resource', 'opportunity', 'project') or jsonb_typeof(p_source) <> 'object' then
    raise exception using errcode = '22023', message = 'CMS_DRAFT_INVALID';
  end if;
  current_snapshot := public.cms_current_snapshot(p_content_type, p_content_id);
  fine_permission := case p_content_type when 'resource' then 'resource.edit'
    when 'opportunity' then 'opportunity.edit' when 'project' then 'project.edit' end;
  if not public.authorization_has_permission(p_actor_user_id,'content.edit',current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id')
    and not public.authorization_has_permission(p_actor_user_id,fine_permission,current_snapshot->>'ownership_kind',current_snapshot->>'owner_branch_id') then
    raise exception using errcode='42501',message='Permission denied';
  end if;
  if p_expected_revision is not null and current_snapshot->>'revision_key' is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  next_revision := clock_timestamp()::text;
  insert into public.cms_content_drafts(content_type, content_id, revision_key, source, audience, updated_by, updated_at)
  values (p_content_type, p_content_id, next_revision, p_source, coalesce(p_audience, '{}'::jsonb), p_actor_user_id, now())
  on conflict (content_type, content_id) do update set
    revision_key = excluded.revision_key, source = excluded.source, audience = excluded.audience,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.cms_invalidate_reviews(p_content_type, p_content_id, next_revision);
  return jsonb_build_object('id', p_content_id, 'status', 'draft', 'revision_key', next_revision, 'live_status', 'published');
end;
$$;
revoke all on function public.cms_save_content_draft(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cms_save_content_draft(uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.cms_review_candidate(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_expected_revision text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare candidate jsonb;
begin
  candidate := public.cms_current_snapshot(p_content_type, p_content_id);
  perform public.authorization_assert_actor(
    p_actor_user_id, 'content.review.request', candidate->>'ownership_kind', candidate->>'owner_branch_id'
  );
  if p_expected_revision is not null and candidate->>'revision_key' is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  return candidate;
end;
$$;
revoke all on function public.cms_review_candidate(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cms_review_candidate(uuid, text, text, text) to service_role;

create or replace function public.cms_notebook_locations(p_source jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(location order by location->>'itemId',location->>'blockId'),'[]'::jsonb)
  from (
    select distinct location
    from (
      select jsonb_build_object('itemId',entry.key,'blockId',null) location
      from jsonb_each(coalesce(p_source->'items','{}'::jsonb)) entry
      where jsonb_typeof(entry.value->'notebook')='object'
      union all
      select jsonb_build_object('itemId',inline_item->>'id','blockId',null)
      from jsonb_path_query(p_source,'lax $.manifest.modules[*].items[*]') inline_item
      where jsonb_typeof(inline_item->'notebook')='object' and nullif(inline_item->>'id','') is not null
      union all
      select jsonb_build_object('itemId',entry.key,'blockId',notebook_block->>'id')
      from jsonb_each(coalesce(p_source->'items','{}'::jsonb)) entry
      cross join lateral jsonb_path_query(entry.value,'lax $.**.blocks[*]') notebook_block
      where jsonb_typeof(notebook_block->'notebook')='object' and nullif(notebook_block->>'id','') is not null
    ) discovered
  ) unique_locations;
$$;
revoke all on function public.cms_notebook_locations(jsonb) from public,anon,authenticated,service_role;

create or replace function public.cms_request_review(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_expected_revision text,
  p_notebook_dependencies jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_snapshot jsonb;
  owner_scope text;
  owner_branch text;
  dependencies jsonb;
  snapshot_id uuid;
  review_row public.cms_review_requests;
  notebook_locations jsonb;
begin
  current_snapshot := public.cms_current_snapshot(p_content_type, p_content_id);
  owner_scope := current_snapshot ->> 'ownership_kind';
  owner_branch := current_snapshot ->> 'owner_branch_id';
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review.request', owner_scope, owner_branch);
  if current_snapshot ->> 'revision_key' is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  if owner_scope = 'branch' and p_content_type in ('course','resource','opportunity','project') and (
    current_snapshot->'audience'->>'scope' is distinct from 'branches'
    or not (current_snapshot->'audience'->'branchIds' ? owner_branch)
    or exists (select 1 from jsonb_array_elements_text(coalesce(current_snapshot->'audience'->'branchIds','[]'::jsonb)) audience_branch
      where audience_branch is distinct from owner_branch)
  ) then
    raise exception using errcode='42501',message='CMS_AUDIENCE_SCOPE_INVALID';
  end if;

  dependencies := public.cms_snapshot_dependencies(
    current_snapshot -> 'source', owner_scope, owner_branch
  );
  if p_notebook_dependencies is not null and jsonb_typeof(p_notebook_dependencies) <> 'array' then
    raise exception using errcode = '22023', message = 'CMS_NOTEBOOK_DEPENDENCIES_INVALID';
  end if;
  notebook_locations := public.cms_notebook_locations(current_snapshot->'source');
  if jsonb_array_length(notebook_locations)>0 and (
    p_notebook_dependencies is null or jsonb_array_length(p_notebook_dependencies)=0
  ) then
    raise exception using errcode='55000',message='CMS_NOTEBOOK_ADAPTER_REQUIRED';
  end if;
  if p_notebook_dependencies is not null and (
    jsonb_array_length(p_notebook_dependencies) is distinct from jsonb_array_length(notebook_locations)
    or exists (
      select 1 from jsonb_array_elements(notebook_locations) location
      where not exists (
        select 1 from jsonb_array_elements(p_notebook_dependencies) dependency
        where dependency->>'itemId'=location->>'itemId'
          and dependency->>'blockId' is not distinct from location->>'blockId'
      )
    )
    or exists (
      select 1 from jsonb_array_elements(p_notebook_dependencies) dependency
      where nullif(dependency->>'itemId','') is null
        or nullif(dependency->>'runtimeMode','') is null
        or nullif(dependency->>'runtimeProfileId','') is null
        or nullif(dependency->>'runtimeProfileVersion','') is null
        or jsonb_typeof(coalesce(dependency->'assets','null'::jsonb))<>'array'
        or not exists (
          select 1 from jsonb_array_elements(notebook_locations) location
          where dependency->>'itemId'=location->>'itemId'
            and dependency->>'blockId' is not distinct from location->>'blockId'
        )
    )
  ) then
    raise exception using errcode='22023',message='CMS_NOTEBOOK_DEPENDENCIES_INVALID';
  end if;
  if p_notebook_dependencies is not null then
    dependencies := dependencies || coalesce((select jsonb_agg(
      jsonb_build_object('kind', 'notebook') || dependency
      order by dependency->>'itemId', dependency->>'blockId'
    ) from jsonb_array_elements(p_notebook_dependencies) dependency), '[]'::jsonb);
  end if;
  perform public.cms_invalidate_reviews(p_content_type, p_content_id, p_expected_revision);
  update public.cms_review_requests set status = 'stale'
  where content_type = p_content_type and content_id = p_content_id
    and status in ('pending', 'approved');

  insert into public.cms_content_snapshots (
    content_type, content_id, revision_key, checksum, ownership_kind,
    owner_branch_id, audience, source, dependencies, created_by
  ) values (
    p_content_type, p_content_id, current_snapshot ->> 'revision_key',
    encode(digest((current_snapshot -> 'source')::text, 'sha256'), 'hex'),
    owner_scope, owner_branch, current_snapshot -> 'audience',
    current_snapshot -> 'source', dependencies, p_actor_user_id
  ) on conflict (content_type, content_id, revision_key, checksum) do nothing
  returning id into snapshot_id;

  if snapshot_id is null then
    select existing.id into snapshot_id from public.cms_content_snapshots existing
    where existing.content_type = p_content_type and existing.content_id = p_content_id
      and existing.revision_key = current_snapshot ->> 'revision_key'
      and existing.checksum = encode(digest((current_snapshot -> 'source')::text, 'sha256'), 'hex');
  end if;

  insert into public.cms_review_requests (
    content_type, content_id, snapshot_id, submitted_by
  ) values (p_content_type, p_content_id, snapshot_id, p_actor_user_id)
  returning * into review_row;

  insert into public.audit_log (actor_id, action, target_type, target_id, before, after, branch_id)
  values (p_actor_user_id, 'content.review.request', p_content_type, p_content_id, null,
    jsonb_build_object('reviewId', review_row.id, 'revision', p_expected_revision), owner_branch);
  return to_jsonb(review_row);
end;
$$;

create or replace function public.cms_decide_review(
  p_actor_user_id uuid,
  p_review_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  review public.cms_review_requests;
  snapshot public.cms_content_snapshots;
  current_snapshot jsonb;
begin
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review', 'central', null);
  if p_decision not in ('approve', 'changes_requested') or nullif(btrim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'CMS_REVIEW_DECISION_INVALID';
  end if;
  select * into review from public.cms_review_requests where id = p_review_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CMS_REVIEW_NOT_FOUND'; end if;
  if review.status <> 'pending' then raise exception using errcode = '55000', message = 'CMS_REVIEW_NOT_PENDING'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  current_snapshot := public.cms_current_snapshot(review.content_type, review.content_id);
  if snapshot.revision_key is distinct from current_snapshot ->> 'revision_key'
    or snapshot.checksum is distinct from encode(digest((current_snapshot -> 'source')::text, 'sha256'), 'hex') then
    update public.cms_review_requests set status = 'stale' where id = review.id returning * into review;
    return to_jsonb(review);
  end if;
  begin
    perform public.cms_assert_dependencies(snapshot.dependencies);
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale' where id = review.id returning * into review;
    return to_jsonb(review);
  end;
  update public.cms_review_requests
  set status = case p_decision when 'approve' then 'approved' else 'changes_requested' end,
      reviewer_id = p_actor_user_id, decision_note = btrim(p_note), decided_at = now(),
      self_review = submitted_by = p_actor_user_id
  where id = review.id returning * into review;
  insert into public.audit_log (actor_id, action, target_type, target_id, before, after, branch_id)
  values (p_actor_user_id, 'content.review.' || p_decision, review.content_type, review.content_id,
    jsonb_build_object('reviewId', review.id, 'status', 'pending'),
    jsonb_build_object('reviewId', review.id, 'status', review.status, 'selfReview', review.self_review),
    snapshot.owner_branch_id);
  return to_jsonb(review);
end;
$$;

create or replace function public.cms_assert_publishable(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_revision_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  review public.cms_review_requests;
  snapshot public.cms_content_snapshots;
  current_snapshot jsonb;
  specific_permission text;
begin
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review', 'central', null);
  perform public.authorization_assert_actor(p_actor_user_id, 'content.publish', 'central', null);
  specific_permission := case p_content_type
    when 'course' then 'course.publish'
    when 'bank_question' then 'bank.publish'
    when 'resource' then 'resource.publish'
    when 'opportunity' then 'opportunity.publish'
    else null
  end;
  if specific_permission is not null then
    perform public.authorization_assert_actor(p_actor_user_id, specific_permission, 'central', null);
  end if;
  select request.* into review
  from public.cms_review_requests request
  join public.cms_content_snapshots candidate on candidate.id = request.snapshot_id
  where request.content_type = p_content_type and request.content_id = p_content_id
    and request.status = 'approved' and candidate.revision_key = p_revision_key
  order by request.decided_at desc limit 1 for update of request;
  if not found then raise exception using errcode = '42501', message = 'CMS_APPROVED_REVIEW_REQUIRED'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  current_snapshot := public.cms_current_snapshot(p_content_type, p_content_id);
  if snapshot.revision_key is distinct from current_snapshot ->> 'revision_key'
    or snapshot.checksum is distinct from encode(digest((current_snapshot -> 'source')::text, 'sha256'), 'hex') then
    update public.cms_review_requests set status = 'stale' where id = review.id;
    return null;
  end if;
  begin
    perform public.cms_assert_dependencies(snapshot.dependencies);
  exception when serialization_failure then
    update public.cms_review_requests set status = 'stale' where id = review.id;
    return null;
  end;
  return review.id;
end;
$$;

create or replace function public.cms_finalize_publication(
  p_actor_user_id uuid,
  p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review public.cms_review_requests; snapshot public.cms_content_snapshots;
begin
  select * into review from public.cms_review_requests where id = p_review_id for update;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  insert into public.cms_publications (content_type, content_id, snapshot_id, review_id, published_by)
  values (review.content_type, review.content_id, snapshot.id, review.id, p_actor_user_id)
  on conflict (content_type, content_id) do update set
    snapshot_id = excluded.snapshot_id, review_id = excluded.review_id,
    published_by = excluded.published_by, published_at = now();
  update public.cms_review_requests set status = 'published', published_by = p_actor_user_id, published_at = now()
  where id = review.id returning * into review;
  insert into public.audit_log (actor_id, action, target_type, target_id, before, after, branch_id)
  values (p_actor_user_id, 'content.publish', review.content_type, review.content_id, null,
    jsonb_build_object('reviewId', review.id, 'snapshotId', snapshot.id, 'checksum', snapshot.checksum),
    snapshot.owner_branch_id);
  return to_jsonb(review);
end;
$$;
revoke all on function public.cms_finalize_publication(uuid, uuid) from public, anon, authenticated, service_role;

-- Preserve the existing course compiler/publisher, but remove its direct service-role bypass.
alter function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  rename to studio_publish_version_guarded_pre_cms_review;
revoke all on function public.studio_publish_version_guarded_pre_cms_review(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.studio_publish_version(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create function public.studio_publish_version_guarded(
  course_id text, manifest jsonb, compiled jsonb, checklist jsonb, report jsonb,
  actor_id uuid, notes text, audit_row jsonb, expected_updated_at timestamptz,
  skill_declarations jsonb, skill_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review_id uuid; published jsonb; current_snapshot jsonb;
begin
  current_snapshot := public.cms_current_snapshot('course', course_id);
  if current_snapshot->'source'->'manifest' is distinct from manifest then
    raise exception using errcode = '40001', message = 'CMS_REVISION_CHANGED';
  end if;
  review_id := public.cms_assert_publishable(actor_id, 'course', course_id, current_snapshot->>'revision_key');
  if review_id is null then return jsonb_build_object('conflict',true,'cms_stale',true); end if;
  published := public.studio_publish_version_guarded_pre_cms_review(
    course_id, manifest, compiled, checklist, report, actor_id, notes, audit_row,
    expected_updated_at, skill_declarations, skill_category
  );
  if coalesce((published->>'conflict')::boolean, false) then return published; end if;
  perform public.cms_finalize_publication(actor_id, review_id);
  return published;
end;
$$;

alter function public.studio_bank_publish(text, uuid, uuid) rename to studio_bank_publish_pre_cms_review;
revoke all on function public.studio_bank_publish_pre_cms_review(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.studio_bank_publish(p_question_id text, p_version_id uuid, p_actor_id uuid)
returns table(id text, status text, current_version_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review_id uuid;
begin
  review_id := public.cms_assert_publishable(p_actor_id, 'bank_question', p_question_id, p_version_id::text);
  if review_id is null then return; end if;
  return query select published.id, published.status, published.current_version_id
    from public.studio_bank_publish_pre_cms_review(p_question_id, p_version_id, p_actor_id) published;
  perform public.cms_finalize_publication(p_actor_id, review_id);
end;
$$;

alter function public.studio_project_save(jsonb, jsonb, boolean) rename to studio_project_save_pre_cms_review;
revoke all on function public.studio_project_save_pre_cms_review(jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;

create function public.studio_project_save(p_project jsonb, p_members jsonb, p_create boolean)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_project public.projects;
begin
  if p_create then
    return public.studio_project_save_pre_cms_review(
      p_project || jsonb_build_object('approved', false, 'published_at', null), p_members, true
    );
  end if;
  select * into current_project from public.projects where id = p_project->>'id' for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND'; end if;
  if current_project.approved
    or coalesce((p_project->>'approved')::boolean, false) is distinct from current_project.approved then
    raise exception using errcode = '42501', message = 'PROJECT_REVIEW_REQUIRED';
  end if;
  return public.studio_project_save_pre_cms_review(
    p_project || jsonb_build_object('approved', false, 'published_at', null), p_members, false
  );
end;
$$;

create or replace function public.cms_publish_content(
  p_actor_user_id uuid,
  p_content_type text,
  p_content_id text,
  p_revision_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review_id uuid; snapshot public.cms_content_snapshots; source_record jsonb;
begin
  review_id := public.cms_assert_publishable(p_actor_user_id, p_content_type, p_content_id, p_revision_key);
  if review_id is null then return jsonb_build_object('status','stale','content_type',p_content_type,'content_id',p_content_id); end if;
  select candidate.* into snapshot from public.cms_content_snapshots candidate
  join public.cms_review_requests review on review.snapshot_id = candidate.id
  where review.id = review_id;
  source_record := snapshot.source->'record';
  perform set_config('vfuture.cms_publishing', 'on', true);
  case p_content_type
    when 'resource' then
      update public.resources set document = snapshot.source->'document', branch_scope = snapshot.audience,
        status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
      where id = p_content_id;
    when 'opportunity' then
      update public.opportunities set
        title=source_record->'title', organization=source_record->>'organization', type=source_record->>'type',
        description=source_record->'description', eligibility=source_record->'eligibility',
        recommended_skills=array(select jsonb_array_elements_text(source_record->'recommended_skills')),
        recommended_courses=array(select jsonb_array_elements_text(source_record->'recommended_courses')),
        required_courses=array(select jsonb_array_elements_text(source_record->'required_courses')),
        application_url=nullif(source_record->>'application_url',''), internal_application=coalesce((source_record->>'internal_application')::boolean,false),
        open_at=(source_record->>'open_at')::timestamptz, close_at=(source_record->>'close_at')::timestamptz,
        start_at=(source_record->>'start_at')::timestamptz, end_at=(source_record->>'end_at')::timestamptz,
        location=nullif(source_record->>'location',''), online=coalesce((source_record->>'online')::boolean,false),
        branch_scope=snapshot.audience, featured=coalesce((source_record->>'featured')::boolean,false),
        status='published', published_at=coalesce(published_at,now()), updated_at=now()
      where id = p_content_id;
    when 'project' then
      update public.projects set title=source_record->'title', summary=source_record->'summary',
        status=source_record->>'status', output_links=source_record->'output_links',
        skills=array(select jsonb_array_elements_text(source_record->'skills')),
        course_ids=array(select jsonb_array_elements_text(source_record->'course_ids')),
        owner_id=(source_record->>'owner_id')::uuid, cover_asset_id=nullif(source_record->>'cover_asset_id',''),
        branch_scope=snapshot.audience, approved=true, published_at=coalesce(published_at,now()), updated_at=now()
      where id = p_content_id;
      delete from public.project_members where project_id = p_content_id;
      insert into public.project_members(project_id,user_id,role,created_at,updated_at)
      select p_content_id,(member->>'user_id')::uuid,member->>'role',now(),now()
      from jsonb_array_elements(coalesce(snapshot.source->'members','[]'::jsonb)) member;
    when 'media_asset' then null;
    when 'bank_question' then
      perform public.studio_bank_publish_pre_cms_review(p_content_id, snapshot.revision_key::uuid, p_actor_user_id);
    when 'course' then
      raise exception using errcode = '55000', message = 'CMS_USE_STUDIO_COURSE_PUBLISH';
    else raise exception using errcode = '22023', message = 'CMS_CONTENT_TYPE_INVALID';
  end case;
  delete from public.cms_content_drafts where content_type = p_content_type and content_id = p_content_id;
  return public.cms_finalize_publication(p_actor_user_id, review_id);
end;
$$;

create or replace function public.cms_publish_review(p_actor_user_id uuid, p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare review public.cms_review_requests; snapshot public.cms_content_snapshots;
begin
  select * into review from public.cms_review_requests where id = p_review_id;
  if not found then raise exception using errcode = 'P0002', message = 'CMS_REVIEW_NOT_FOUND'; end if;
  select * into snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  return public.cms_publish_content(p_actor_user_id, review.content_type, review.content_id, snapshot.revision_key);
end;
$$;

create or replace function public.cms_list_content(
  p_actor_user_id uuid, p_scope_kind text, p_branch_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not (
    public.authorization_has_permission(p_actor_user_id, 'content.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'course.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'bank.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'resource.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'opportunity.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'project.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'media.upload', p_scope_kind, p_branch_id)
  ) then raise exception using errcode = '42501', message = 'Permission denied'; end if;
  if p_scope_kind = 'branch' and p_branch_id is null then
    raise exception using errcode = '22023', message = 'CMS_BRANCH_REQUIRED';
  end if;
  select coalesce(jsonb_agg(
    row_value || jsonb_build_object(
      'revision_key', visible_snapshot.value->>'revision_key',
      'audience', visible_snapshot.value->'audience',
      'editable', content_access.editable,
      'status', case when content_access.editable then row_value->>'status' else 'published' end,
      'updated_at', case when content_access.editable then row_value->>'updated_at' else publication.published_at::text end,
      'studio_href', case when content_access.editable then row_value->>'studio_href' else case row_value->>'content_type'
        when 'course' then '/app/courses/'||(row_value->>'content_id')
        when 'resource' then '/app/resources/'||(row_value->>'content_id')
        when 'opportunity' then '/app/opportunities/'||(row_value->>'content_id')
        when 'project' then '/app/projects/'||(row_value->>'content_id')
        else row_value->>'studio_href' end end,
      'title', case row_value->>'content_type'
        when 'course' then visible_snapshot.value#>'{source,manifest,title}'
        when 'bank_question' then coalesce(visible_snapshot.value#>'{source,version,payload,title}', to_jsonb(row_value->>'content_id'))
        when 'resource' then visible_snapshot.value#>'{source,document,title}'
        when 'opportunity' then visible_snapshot.value#>'{source,record,title}'
        when 'project' then visible_snapshot.value#>'{source,record,title}'
        when 'media_asset' then to_jsonb(coalesce(visible_snapshot.value#>>'{source,asset,alt,en}', visible_snapshot.value#>>'{source,asset,path}', row_value->>'content_id'))
      end,
      'review_status', case when content_access.editable then (select request.status from public.cms_review_requests request
        where request.content_type = row_value->>'content_type' and request.content_id = row_value->>'content_id'
        order by request.submitted_at desc limit 1) else null end
    ) order by case when content_access.editable then row_value->>'updated_at' else publication.published_at::text end desc
  ), '[]'::jsonb) into result
  from (
    select jsonb_build_object('content_type','course','content_id',id,'status',status,'ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',updated_at,'studio_href','/studio/courses/'||id) row_value from public.courses
    union all select jsonb_build_object('content_type','bank_question','content_id',id,'status',status,'ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',updated_at,'studio_href','/admin/bank/'||id) from public.bank_questions
    union all select jsonb_build_object('content_type','resource','content_id',id,'status',status,'ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',updated_at,'studio_href','/admin/resources/'||id) from public.resources
    union all select jsonb_build_object('content_type','opportunity','content_id',id,'status',status,'ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',updated_at,'studio_href','/admin/opportunities/'||id) from public.opportunities
    union all select jsonb_build_object('content_type','project','content_id',id,'status',case when approved then 'published' else 'draft' end,'ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',updated_at,'studio_href','/admin/projects/'||id) from public.projects
    union all select jsonb_build_object('content_type','media_asset','content_id',id,'status','asset','ownership_kind',ownership_kind,'owner_branch_id',owner_branch_id,'updated_at',created_at,'studio_href','/studio/media') from public.media_assets
  ) content
  cross join lateral (
    select public.cms_current_snapshot(content.row_value->>'content_type', content.row_value->>'content_id') value
  ) current_snapshot
  left join public.cms_publications publication
    on publication.content_type=content.row_value->>'content_type' and publication.content_id=content.row_value->>'content_id'
  left join public.cms_content_snapshots live_snapshot on live_snapshot.id=publication.snapshot_id
  cross join lateral (
    select (p_scope_kind='central' or (
      content.row_value->>'ownership_kind'='branch' and content.row_value->>'owner_branch_id'=p_branch_id
    )) editable
  ) content_access
  cross join lateral (
    select case when content_access.editable then current_snapshot.value else jsonb_build_object(
      'revision_key',live_snapshot.revision_key,'audience',live_snapshot.audience,'source',live_snapshot.source
    ) end value
  ) visible_snapshot
  where (
    public.authorization_has_permission(p_actor_user_id, 'content.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, case content.row_value->>'content_type'
      when 'course' then 'course.read' when 'bank_question' then 'bank.edit'
      when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
      when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end,
      p_scope_kind, p_branch_id)
  ) and (
    p_scope_kind = 'central'
    or (content.row_value->>'ownership_kind' = 'branch' and content.row_value->>'owner_branch_id' = p_branch_id)
    or (live_snapshot.audience->>'scope' = 'branches' and live_snapshot.audience->'branchIds' ? p_branch_id)
  );
  return result;
end;
$$;

create or replace function public.cms_get_review_preview(p_actor_user_id uuid, p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  review public.cms_review_requests;
  reviewed_snapshot public.cms_content_snapshots;
  publication public.cms_publications;
  published_snapshot public.cms_content_snapshots;
begin
  perform public.authorization_assert_actor(p_actor_user_id, 'content.review', 'central', null);
  select * into review from public.cms_review_requests where id = p_review_id;
  if not found then raise exception using errcode='P0002',message='CMS_REVIEW_NOT_FOUND'; end if;
  select * into reviewed_snapshot from public.cms_content_snapshots where id = review.snapshot_id;
  select * into publication from public.cms_publications
  where content_type = review.content_type and content_id = review.content_id;
  if publication.snapshot_id is not null then
    select * into published_snapshot from public.cms_content_snapshots where id = publication.snapshot_id;
  end if;
  return jsonb_build_object(
    'review', jsonb_build_object(
      'id',review.id,'content_type',review.content_type,'content_id',review.content_id,'status',review.status,
      'submitted_by',review.submitted_by,'submitted_at',review.submitted_at,'reviewer_id',review.reviewer_id,
      'decision_note',review.decision_note,'decided_at',review.decided_at,'self_review',review.self_review,
      'published_by',review.published_by,'published_at',review.published_at
    ),
    'snapshot', jsonb_build_object(
      'id',reviewed_snapshot.id,'revision_key',reviewed_snapshot.revision_key,'checksum',reviewed_snapshot.checksum,
      'ownership_kind',reviewed_snapshot.ownership_kind,'owner_branch_id',reviewed_snapshot.owner_branch_id,
      'audience',reviewed_snapshot.audience,'dependencies',reviewed_snapshot.dependencies,
      'created_by',reviewed_snapshot.created_by,'created_at',reviewed_snapshot.created_at
    ),
    'reviewed_source', reviewed_snapshot.source,
    'published_snapshot', case when published_snapshot.id is null then null else jsonb_build_object(
      'id',published_snapshot.id,'revision_key',published_snapshot.revision_key,'checksum',published_snapshot.checksum,
      'audience',published_snapshot.audience,'source',published_snapshot.source,
      'published_by',publication.published_by,'published_at',publication.published_at
    ) end
  );
end;
$$;

create or replace function public.cms_list_reviews(
  p_actor_user_id uuid, p_scope_kind text, p_branch_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not (
    public.authorization_has_permission(p_actor_user_id, 'content.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'course.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'bank.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'resource.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'opportunity.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'project.edit', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'media.upload', p_scope_kind, p_branch_id)
  ) then raise exception using errcode = '42501', message = 'Permission denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', review.id, 'content_type', review.content_type, 'content_id', review.content_id,
    'status', review.status, 'submitted_by', review.submitted_by, 'submitted_at', review.submitted_at,
    'reviewer_id', review.reviewer_id, 'decision_note', review.decision_note,
    'self_review', review.self_review, 'revision_key', snapshot.revision_key,
    'checksum', snapshot.checksum, 'ownership_kind', snapshot.ownership_kind,
    'owner_branch_id', snapshot.owner_branch_id, 'audience', snapshot.audience,
    'dependencies', snapshot.dependencies
  ) order by review.submitted_at desc), '[]'::jsonb) into result
  from public.cms_review_requests review
  join public.cms_content_snapshots snapshot on snapshot.id = review.snapshot_id
  where (
    p_scope_kind = 'central'
    or (snapshot.ownership_kind = 'branch' and snapshot.owner_branch_id = p_branch_id)
  ) and (
    public.authorization_has_permission(p_actor_user_id, 'content.read', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, case review.content_type
      when 'course' then 'course.read' when 'bank_question' then 'bank.edit'
      when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
      when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end,
      p_scope_kind, p_branch_id)
  );
  return result;
end;
$$;

revoke all on function public.cms_request_review(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cms_request_review(uuid, text, text, text, jsonb) to service_role;
revoke all on function public.cms_decide_review(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_decide_review(uuid, uuid, text, text) to service_role;
revoke all on function public.cms_assert_publishable(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cms_assert_publishable(uuid, text, text, text) to service_role;
revoke all on function public.cms_publish_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cms_publish_review(uuid, uuid) to service_role;
revoke all on function public.cms_publish_content(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cms_publish_content(uuid, text, text, text) to service_role;
revoke all on function public.cms_list_content(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_list_content(uuid, text, text) to service_role;
revoke all on function public.cms_list_reviews(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_list_reviews(uuid, text, text) to service_role;
revoke all on function public.cms_get_review_preview(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cms_get_review_preview(uuid,uuid) to service_role;
revoke all on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.studio_publish_version_guarded(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, timestamptz, jsonb, text) to service_role;
revoke all on function public.studio_bank_publish(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.studio_bank_publish(text, uuid, uuid) to service_role;
revoke all on function public.studio_project_save(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.studio_project_save(jsonb, jsonb, boolean) to service_role;
