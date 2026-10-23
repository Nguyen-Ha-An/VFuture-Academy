-- Store window expiry directly so periodic collection can use an index.
-- The 0019 predicate `window_started_at + make_interval(secs => window_seconds)` is not
-- sargable on either column, so 0020's index on window_started_at could never be used, and
-- a functional index on the expression is rejected because timestamptz + interval is STABLE
-- rather than IMMUTABLE. A stored column written by the claim function is indexable.
alter table public.rate_limits
  add column expires_at timestamptz;

update public.rate_limits
set expires_at = window_started_at + make_interval(secs => window_seconds)
where expires_at is null;

alter table public.rate_limits
  alter column expires_at set not null;

create index rate_limits_expires_at_idx on public.rate_limits (expires_at);

-- Both earlier indexes are dead weight that is still maintained on every claim:
-- 0019 replaced the updated_at collector, and no plan can use window_started_at alone.
drop index if exists public.rate_limits_updated_at_idx;
drop index if exists public.rate_limits_window_started_at_idx;

create or replace function public.rate_limit(
  key text,
  "limit" integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz := clock_timestamp();
  claimed_count integer;
begin
  if $1 is null or char_length($1) not between 1 and 512 then
    raise exception 'rate limit key must contain 1 to 512 characters' using errcode = '22023';
  end if;
  if $2 is null or $2 < 1 or $3 is null or $3 < 1 then
    raise exception 'rate limit and window must be positive integers' using errcode = '22023';
  end if;

  insert into public.rate_limits as bucket (
    rate_key,
    window_started_at,
    request_count,
    window_seconds,
    expires_at,
    updated_at
  ) values (
    $1,
    checked_at,
    1,
    $3,
    checked_at + make_interval(secs => $3),
    checked_at
  )
  on conflict (rate_key) do update
  set
    window_started_at = case
      when bucket.expires_at <= checked_at then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.expires_at <= checked_at then 1
      else bucket.request_count + 1
    end,
    window_seconds = $3,
    expires_at = case
      when bucket.expires_at <= checked_at then checked_at + make_interval(secs => $3)
      else bucket.window_started_at + make_interval(secs => $3)
    end,
    updated_at = checked_at
  returning request_count into claimed_count;

  return claimed_count <= $2;
end;
$$;

revoke all on function public.rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit(text, integer, integer) to service_role;

create or replace function public.rate_limit_gc()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  delete from public.rate_limits
  where expires_at <= clock_timestamp();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.rate_limit_gc() from public, anon, authenticated;
grant execute on function public.rate_limit_gc() to service_role;
