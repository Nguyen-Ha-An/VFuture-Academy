-- Keep the database review queue aligned with the neutral Studio context:
-- Central review and publish capabilities imply read access to review rows,
-- while every row remains constrained by the requested authorized scope.

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
    or public.authorization_has_permission(p_actor_user_id, 'content.review', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'content.publish', p_scope_kind, p_branch_id)
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
    or public.authorization_has_permission(p_actor_user_id, 'content.review', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, 'content.publish', p_scope_kind, p_branch_id)
    or public.authorization_has_permission(p_actor_user_id, case review.content_type
      when 'course' then 'course.read' when 'bank_question' then 'bank.edit'
      when 'resource' then 'resource.edit' when 'opportunity' then 'opportunity.edit'
      when 'project' then 'project.edit' when 'media_asset' then 'media.upload' end,
      p_scope_kind, p_branch_id)
  );
  return result;
end;
$$;

revoke all on function public.cms_list_reviews(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cms_list_reviews(uuid, text, text) to service_role;
