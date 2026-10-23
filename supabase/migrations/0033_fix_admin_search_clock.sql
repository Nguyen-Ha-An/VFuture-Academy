-- CURRENT_TIME is a PostgreSQL keyword (timetz), so it cannot be used as
-- the unqualified name of a timestamptz variable in these SQL statements.
create or replace function public.admin_consume_user_search_token(p_actor_id uuid)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_tokens numeric;
  bucket_refilled_at timestamptz;
  observed_at timestamptz := clock_timestamp();
begin
  insert into public.admin_user_search_buckets (actor_id, tokens, refilled_at)
  values (p_actor_id, 30, observed_at)
  on conflict (actor_id) do nothing;

  select search_bucket.tokens, search_bucket.refilled_at
  into bucket_tokens, bucket_refilled_at
  from public.admin_user_search_buckets search_bucket
  where search_bucket.actor_id = p_actor_id
  for update;

  bucket_tokens := least(
    30,
    bucket_tokens + extract(epoch from (observed_at - bucket_refilled_at)) * 0.5
  );

  if bucket_tokens >= 1 then
    update public.admin_user_search_buckets
    set tokens = bucket_tokens - 1,
        refilled_at = observed_at
    where actor_id = p_actor_id;
    return query select true, 0;
  else
    update public.admin_user_search_buckets
    set tokens = bucket_tokens,
        refilled_at = observed_at
    where actor_id = p_actor_id;
    return query select false, greatest(1, ceil((1 - bucket_tokens) / 0.5)::integer);
  end if;
end;
$$;

revoke all on function public.admin_consume_user_search_token(uuid) from public;
revoke all on function public.admin_consume_user_search_token(uuid) from anon, authenticated;
grant execute on function public.admin_consume_user_search_token(uuid) to service_role;
