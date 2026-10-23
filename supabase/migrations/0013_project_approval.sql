-- Forward-only approval workflow for learner-proposed projects.
-- Existing published projects become approved showcases; the legacy published
-- status is normalized to showcased because application code uses lifecycle
-- status and approval as independent concepts.

alter table public.projects
  add column approved boolean not null default false;

update public.projects
set approved = true
where published_at is not null or status = 'published';

update public.projects
set status = 'showcased'
where status = 'published';

drop policy if exists "published projects readable when scoped" on public.projects;

create policy "approved projects or own proposals readable when scoped" on public.projects
  for select to authenticated using (
    (approved or owner_id = (select auth.uid()))
    and (
      branch_scope->>'scope' = 'global'
      or branch_scope->'branchIds' ? (select public.current_branch_id())
    )
  );

create index projects_approved_created_at on public.projects (created_at desc) where approved;
create index projects_owner_created_at on public.projects (owner_id, created_at desc);
