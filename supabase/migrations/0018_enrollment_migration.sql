-- Forward-only function migration. Each invocation locks and migrates one active
-- enrollment so progress and the enrollment version commit or roll back together.

create or replace function public.learner_migrate_enrollment(
  p_user_id uuid,
  p_course_id text,
  p_from_version uuid,
  p_to_version uuid
)
returns table (
  status text,
  reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_enrollment_id uuid;
begin
  if p_from_version = p_to_version then
    return query select 'skipped'::text, 'ALREADY_ON_LATEST_VERSION'::text;
    return;
  end if;

  select enrollment.id
  into locked_enrollment_id
  from public.enrollments as enrollment
  where enrollment.user_id = p_user_id
    and enrollment.course_id = p_course_id
    and enrollment.course_version_id = p_from_version
    and enrollment.status = 'active'
  for update;

  if not found then
    return query select 'skipped'::text, 'ACTIVE_ENROLLMENT_NOT_FOUND'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.course_version_outline as target_outline
    where target_outline.version_id = p_to_version
      and target_outline.course_id = p_course_id
  ) then
    return query select 'skipped'::text, 'LATEST_VERSION_UNAVAILABLE'::text;
    return;
  end if;

  if exists (
    select 1
    from public.lesson_progress as progress
    where progress.user_id = p_user_id
      and progress.course_version_id = p_from_version
      and not exists (
        select 1
        from public.course_version_outline as target_outline
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(target_outline.outline -> 'modules') = 'array'
              then target_outline.outline -> 'modules'
            else '[]'::jsonb
          end
        ) as target_module(value)
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(target_module.value -> 'items') = 'array'
              then target_module.value -> 'items'
            else '[]'::jsonb
          end
        ) as target_item(value)
        where target_outline.version_id = p_to_version
          and target_outline.course_id = p_course_id
          and target_item.value ->> 'id' = progress.item_id
      )
  ) then
    return query select 'skipped'::text, 'ITEM_NOT_IN_LATEST_VERSION'::text;
    return;
  end if;

  if exists (
    select 1
    from public.lesson_progress as old_progress
    join public.lesson_progress as new_progress
      on new_progress.user_id = old_progress.user_id
      and new_progress.course_version_id = p_to_version
      and new_progress.item_id = old_progress.item_id
    where old_progress.user_id = p_user_id
      and old_progress.course_version_id = p_from_version
  ) then
    return query select 'skipped'::text, 'TARGET_PROGRESS_CONFLICT'::text;
    return;
  end if;

  update public.lesson_progress as progress
  set course_version_id = p_to_version
  where progress.user_id = p_user_id
    and progress.course_version_id = p_from_version;

  update public.enrollments as enrollment
  set course_version_id = p_to_version
  where enrollment.id = locked_enrollment_id
    and enrollment.course_version_id = p_from_version;

  return query select 'migrated'::text, null::text;
end;
$$;

revoke all on function public.learner_migrate_enrollment(uuid, text, uuid, uuid) from public;
revoke all on function public.learner_migrate_enrollment(uuid, text, uuid, uuid) from anon, authenticated;
grant execute on function public.learner_migrate_enrollment(uuid, text, uuid, uuid) to service_role;
