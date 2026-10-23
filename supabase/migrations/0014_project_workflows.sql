-- Atomic persistence for project/member replacement and learner proposal quotas.
-- These functions are service-role only; route handlers remain responsible for
-- authenticating the actor and validating the strict request schema.

create or replace function public.studio_project_save(
  p_project jsonb,
  p_members jsonb,
  p_create boolean
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.projects;
begin
  if p_create then
    insert into public.projects (
      id, title, summary, status, output_links, skills, course_ids,
      owner_id, cover_asset_id, approved, branch_scope, published_at,
      created_at, updated_at
    ) values (
      p_project->>'id',
      p_project->'title',
      p_project->'summary',
      p_project->>'status',
      coalesce(p_project->'output_links', '[]'::jsonb),
      array(select jsonb_array_elements_text(coalesce(p_project->'skills', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(p_project->'course_ids', '[]'::jsonb))),
      (p_project->>'owner_id')::uuid,
      nullif(p_project->>'cover_asset_id', ''),
      coalesce((p_project->>'approved')::boolean, false),
      coalesce(p_project->'branch_scope', '{"scope":"global"}'::jsonb),
      (p_project->>'published_at')::timestamptz,
      coalesce((p_project->>'created_at')::timestamptz, now()),
      coalesce((p_project->>'updated_at')::timestamptz, now())
    )
    returning * into saved;
  else
    update public.projects
    set title = p_project->'title',
        summary = p_project->'summary',
        status = p_project->>'status',
        output_links = coalesce(p_project->'output_links', '[]'::jsonb),
        skills = array(select jsonb_array_elements_text(coalesce(p_project->'skills', '[]'::jsonb))),
        course_ids = array(select jsonb_array_elements_text(coalesce(p_project->'course_ids', '[]'::jsonb))),
        owner_id = (p_project->>'owner_id')::uuid,
        cover_asset_id = nullif(p_project->>'cover_asset_id', ''),
        approved = coalesce((p_project->>'approved')::boolean, false),
        branch_scope = coalesce(p_project->'branch_scope', '{"scope":"global"}'::jsonb),
        published_at = (p_project->>'published_at')::timestamptz,
        updated_at = coalesce((p_project->>'updated_at')::timestamptz, now())
    where id = p_project->>'id'
    returning * into saved;

    if saved.id is null then
      raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
    end if;
  end if;

  delete from public.project_members where project_id = saved.id;
  insert into public.project_members (project_id, user_id, role)
  select saved.id, member.user_id, member.role
  from jsonb_to_recordset(coalesce(p_members, '[]'::jsonb))
    as member(user_id uuid, role text);

  if not exists (
    select 1 from public.project_members
    where project_id = saved.id and user_id = saved.owner_id and role = 'owner'
  ) or (
    select count(*) from public.project_members
    where project_id = saved.id and role = 'owner'
  ) <> 1 then
    raise exception using errcode = '23514', message = 'PROJECT_OWNER_MEMBERSHIP_REQUIRED';
  end if;

  return saved;
end;
$$;

create or replace function public.learner_project_propose(
  p_project jsonb,
  p_members jsonb,
  p_owner_id uuid,
  p_since timestamptz,
  p_limit integer
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  proposal_count bigint;
  proposal jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('project-proposal:' || p_owner_id::text, 0));

  select count(*) into proposal_count
  from public.projects
  where owner_id = p_owner_id
    and created_at >= p_since;

  if proposal_count >= p_limit then
    raise exception using errcode = 'P0001', message = 'PROJECT_PROPOSAL_LIMIT';
  end if;

  proposal := p_project || jsonb_build_object(
    'owner_id', p_owner_id,
    'status', 'idea',
    'approved', false,
    'published_at', null
  );

  return public.studio_project_save(proposal, p_members, true);
end;
$$;

revoke all on function public.studio_project_save(jsonb, jsonb, boolean) from public;
revoke all on function public.studio_project_save(jsonb, jsonb, boolean) from anon, authenticated;
grant execute on function public.studio_project_save(jsonb, jsonb, boolean) to service_role;

revoke all on function public.learner_project_propose(jsonb, jsonb, uuid, timestamptz, integer) from public;
revoke all on function public.learner_project_propose(jsonb, jsonb, uuid, timestamptz, integer) from anon, authenticated;
grant execute on function public.learner_project_propose(jsonb, jsonb, uuid, timestamptz, integer) to service_role;
