create table public.rate_limits (
  rate_key text primary key check (char_length(rate_key) between 1 and 512),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.rate_limits enable row level security;

revoke all on table public.rate_limits from public, anon, authenticated;

create index rate_limits_updated_at_idx on public.rate_limits (updated_at);

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
  if key is null or char_length(key) not between 1 and 512 then
    raise exception 'rate limit key must contain 1 to 512 characters' using errcode = '22023';
  end if;
  if "limit" is null or "limit" < 1 or window_seconds is null or window_seconds < 1 then
    raise exception 'rate limit and window must be positive integers' using errcode = '22023';
  end if;

  insert into public.rate_limits as bucket (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  ) values (
    key,
    checked_at,
    1,
    checked_at
  )
  on conflict (rate_key) do update
  set
    window_started_at = case
      when bucket.window_started_at <= checked_at - make_interval(secs => window_seconds)
        then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at <= checked_at - make_interval(secs => window_seconds)
        then 1
      else bucket.request_count + 1
    end,
    updated_at = checked_at
  returning request_count into claimed_count;

  return claimed_count <= "limit";
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
  where updated_at < clock_timestamp() - interval '60 seconds';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.rate_limit_gc() from public, anon, authenticated;
grant execute on function public.rate_limit_gc() to service_role;
