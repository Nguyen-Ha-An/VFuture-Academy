-- Completion effect invariants and certificate/XP security hardening.

create unique index if not exists certificates_user_course_unique
  on public.certificates (user_id, course_id);

create index if not exists xp_events_weekly_leaderboard
  on public.xp_events (created_at desc, user_id);

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "certificate PDFs are public" on storage.objects;

create or replace function public.xp_weekly_leaderboard(
  scope text,
  branch_id text,
  week_start timestamptz
)
returns table (
  rank bigint,
  handle text,
  display_name text,
  points numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select events.user_id, sum(events.points) as points
    from public.xp_events as events
    where events.created_at >= $3
      and events.created_at < $3 + interval '7 days'
    group by events.user_id
  ), eligible as (
    select profiles.handle, profiles.display_name, totals.points
    from totals
    join public.profiles as profiles on profiles.id = totals.user_id
    where profiles.profile_public = true
      and (
        $1 = 'global'
        or ($1 = 'branch' and profiles.branch_id = $2)
      )
  )
  select
    row_number() over (
      order by eligible.points desc, eligible.display_name, eligible.handle
    ) as rank,
    eligible.handle,
    eligible.display_name,
    eligible.points
  from eligible
  order by rank
$$;

revoke all on function public.xp_weekly_leaderboard(text, text, timestamptz) from public;
revoke all on function public.xp_weekly_leaderboard(text, text, timestamptz) from anon, authenticated;
grant execute on function public.xp_weekly_leaderboard(text, text, timestamptz) to service_role;

create or replace function public.xp_user_total(user_id uuid)
returns table (
  total_points numeric,
  weekly_points numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select
      events.user_id,
      sum(events.points) as total_points,
      sum(events.points) filter (
        where events.created_at >= (
          date_trunc('week', timezone('Asia/Ho_Chi_Minh', now()))
          at time zone 'Asia/Ho_Chi_Minh'
        )
      ) as weekly_points
    from public.xp_events as events
    where events.user_id = $1
    group by events.user_id
  )
  select totals.total_points, coalesce(totals.weekly_points, 0::numeric)
  from totals
  union all
  select 0::numeric, 0::numeric
  where not exists (select 1 from totals)
$$;

revoke all on function public.xp_user_total(uuid) from public;
revoke all on function public.xp_user_total(uuid) from anon, authenticated;
grant execute on function public.xp_user_total(uuid) to service_role;

create or replace function public.xp_update_streak(user_id uuid, active_date date)
returns table (
  current_streak int,
  longest_streak int,
  last_active_date date
)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.streaks as existing (
    user_id,
    current_streak,
    longest_streak,
    last_active_date,
    updated_at
  ) values (
    $1,
    1,
    1,
    $2,
    now()
  )
  on conflict (user_id) do update
  set current_streak = case
        when existing.last_active_date is null then 1
        when excluded.last_active_date <= existing.last_active_date then existing.current_streak
        when excluded.last_active_date = existing.last_active_date + 1 then existing.current_streak + 1
        else 1
      end,
      longest_streak = greatest(
        existing.longest_streak,
        case
          when existing.last_active_date is null then 1
          when excluded.last_active_date <= existing.last_active_date then existing.current_streak
          when excluded.last_active_date = existing.last_active_date + 1 then existing.current_streak + 1
          else 1
        end
      ),
      last_active_date = case
        when existing.last_active_date is null
          or excluded.last_active_date > existing.last_active_date
          then excluded.last_active_date
        else existing.last_active_date
      end,
      updated_at = now()
  returning
    existing.current_streak,
    existing.longest_streak,
    existing.last_active_date
$$;

revoke all on function public.xp_update_streak(uuid, date) from public;
revoke all on function public.xp_update_streak(uuid, date) from anon, authenticated;
grant execute on function public.xp_update_streak(uuid, date) to service_role;
