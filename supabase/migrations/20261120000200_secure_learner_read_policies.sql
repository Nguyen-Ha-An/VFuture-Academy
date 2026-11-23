-- Resource, opportunity and project audience policies use the learner's primary school.
-- Profiles predating an explicit membership still qualify until that school suspends them.
create or replace function public.current_branch_id()
returns text
language sql stable security definer set search_path = ''
as $$
  select p.branch_id
  from public.profiles p
  join public.user_accounts a on a.user_id = p.id and a.status = 'active'
  where p.id = (select auth.uid())
    and not exists (
      select 1 from public.branch_memberships m
      where m.user_id = p.id and m.branch_id = p.branch_id and m.status = 'suspended'
    )
$$;
revoke all on function public.current_branch_id() from public, anon;
grant execute on function public.current_branch_id() to authenticated;

-- A null edition asks about current catalog visibility only (the public RPC contract).
-- A concrete edition can also be authorized by the caller's own enrollment.
-- These tables include server-only fields; the caller receives only a boolean.
create function private.learner_can_read_outline(p_course_id text, p_version_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.admin_session_active()) and exists (
    select 1
    from public.courses c
    join public.course_versions v
      on v.course_id = c.id and v.id = coalesce(p_version_id, c.current_version_id)
    join public.course_version_outline o on o.version_id = v.id and o.course_id = c.id
    where c.id = p_course_id and c.status in ('published', 'archived')
      and (
        (c.status = 'published' and c.current_version_id = v.id and (
          o.access->>'scope' = 'global'
          or (o.access->>'scope' = 'branches' and jsonb_typeof(o.access->'branchIds') = 'array'
            and o.access->'branchIds' ? (select public.current_branch_id()))
        ))
        or (p_version_id is not null and exists (
          select 1 from public.enrollments e
          where e.user_id = (select auth.uid()) and e.course_id = c.id and e.course_version_id = v.id
            and e.status in ('active', 'completed')
            and (not e.branch_scope_known or not exists (
              select 1 from public.branch_memberships m
              where m.user_id = e.user_id and m.branch_id = e.branch_id and m.status = 'suspended'
            ))
        ))
      )
  )
$$;
revoke all on function private.learner_can_read_outline(text, uuid) from public, anon, authenticated, service_role;
grant execute on function private.learner_can_read_outline(text, uuid) to authenticated;

create or replace function public.can_access_course(p_course_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.learner_can_read_outline(p_course_id, null)
$$;
revoke all on function public.can_access_course(text) from public, anon;
grant execute on function public.can_access_course(text) to authenticated;

alter policy "outline readable when accessible" on public.course_version_outline
  using (private.learner_can_read_outline(course_id, version_id));

-- The existing owner policies still choose each learner's rows. Add the same
-- account check that already protects their enrollments and learning history.
do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'profiles', 'user_roles', 'opportunity_interest', 'project_members',
    'project_interest', 'skill_evidence', 'certificates', 'xp_events', 'streaks'
  ] loop
    execute format(
      'create policy active_account_required on public.%I as restrictive for select to authenticated using ((select private.admin_session_active()))',
      protected_table
    );
  end loop;
end
$$;
