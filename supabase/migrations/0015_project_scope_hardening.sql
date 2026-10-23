-- Fail closed on malformed project branch scopes before application services
-- read them with the service role. Invalid existing rows are made unapproved so
-- only their owner can repair and re-submit them through Studio.

create or replace function public.valid_project_branch_scope(value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  branch_value jsonb;
begin
  if jsonb_typeof(value) <> 'object' then
    return false;
  end if;

  if value->>'scope' = 'global' then
    return value = '{"scope":"global"}'::jsonb;
  end if;

  if value->>'scope' <> 'branches'
    or jsonb_typeof(value->'branchIds') <> 'array'
    or jsonb_array_length(value->'branchIds') = 0
    or value - 'scope' - 'branchIds' <> '{}'::jsonb then
    return false;
  end if;

  for branch_value in
    select element from jsonb_array_elements(value->'branchIds') as elements(element)
  loop
    if jsonb_typeof(branch_value) <> 'string'
      or (branch_value #>> '{}') !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

update public.projects
set approved = false,
    branch_scope = '{"scope":"global"}'::jsonb,
    published_at = null,
    updated_at = now()
where not public.valid_project_branch_scope(branch_scope);

alter table public.projects
  add constraint projects_branch_scope_shape
  check (public.valid_project_branch_scope(branch_scope));
