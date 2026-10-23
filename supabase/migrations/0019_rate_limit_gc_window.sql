-- Preserve every limiter bucket for its complete configured fixed window.
alter table public.rate_limits
  add column window_seconds integer not null default 3600
  check (window_seconds > 0);

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
    updated_at
  ) values (
    $1,
    checked_at,
    1,
    $3,
    checked_at
  )
  on conflict (rate_key) do update
  set
    window_started_at = case
      when bucket.window_started_at + make_interval(secs => bucket.window_seconds) <= checked_at
        then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at + make_interval(secs => bucket.window_seconds) <= checked_at
        then 1
      else bucket.request_count + 1
    end,
    window_seconds = $3,
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
  where window_started_at + make_interval(secs => window_seconds) <= clock_timestamp();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.rate_limit_gc() from public, anon, authenticated;
grant execute on function public.rate_limit_gc() to service_role;
