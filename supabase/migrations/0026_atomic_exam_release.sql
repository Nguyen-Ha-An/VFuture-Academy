-- Preserve the first exam release timestamp and admit release effects once.

create or replace function public.exam_release_attempt(
  p_attempt_id uuid,
  p_released_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_attempt public.exam_attempts;
begin
  if p_released_at is null then
    raise exception 'invalid exam release timestamp' using errcode = '22023';
  end if;

  select attempt.* into locked_attempt
  from public.exam_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception 'exam attempt not found' using errcode = '22023';
  end if;
  if locked_attempt.status <> 'graded' or locked_attempt.released_at is not null then
    return jsonb_build_object(
      'transitioned', false,
      'attempt', to_jsonb(locked_attempt)
    );
  end if;

  update public.exam_attempts
  set released_at = p_released_at
  where id = p_attempt_id
    and status = 'graded'
    and released_at is null
  returning * into locked_attempt;

  return jsonb_build_object(
    'transitioned', true,
    'attempt', to_jsonb(locked_attempt)
  );
end
$$;

revoke all on function public.exam_release_attempt(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.exam_release_attempt(uuid, timestamptz) to service_role;
