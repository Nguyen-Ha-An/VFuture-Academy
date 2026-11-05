-- POST-DEPLOY ACTIVATION ONLY: run after the compatible application is live.
-- Old versions reject unknown permissions while resolving teacher/central-admin
-- actors, so do not execute this step as part of the pre-deploy schema expansion.
-- Built-in definitions remain protected before and after this transaction.
alter table public.role_definitions disable trigger role_definitions_protect_built_in;
update public.role_definitions
set permissions = permissions || array(
  select permission
  from unnest(array['teaching.announcement.manage','teaching.schedule.manage']::text[])
    with ordinality as needed(permission, position)
  where not (permission = any(public.role_definitions.permissions))
  order by position
)
where id in ('teacher', 'central_admin')
  and (not ('teaching.announcement.manage' = any(permissions))
    or not ('teaching.schedule.manage' = any(permissions)));
alter table public.role_definitions enable trigger role_definitions_protect_built_in;
