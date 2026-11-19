-- A new improvement carries the cumulative credit for its pinned quiz. The
-- original attempt reference, amount and date remain available on each event.
alter table public.xp_events add column quiz_reward_scope text,
  add column quiz_reward_total smallint,
  add constraint quiz_reward_receipt check (case
    when quiz_reward_total is null then quiz_reward_scope is null
    when kind <> 'quiz_submitted' or ref_type <> 'quiz_attempt' then false
    when quiz_reward_total = 0 then points = 0 and quiz_reward_scope is null
    else quiz_reward_scope is not null and points > 0 and quiz_reward_total between 5 and 20
  end);
revoke insert, update, delete on public.xp_events from public, anon, authenticated;
create unique index xp_events_quiz_reward_total on public.xp_events (user_id, quiz_reward_scope, quiz_reward_total desc)
  where quiz_reward_scope is not null;

-- Apply the same award rule to the current RPC and older application versions
-- that still insert the quiz-attempt reference directly.
create function private.bound_quiz_reward()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  attempt record;
  reward_scope text;
  earned integer;
  credited numeric;
  legacy_writer boolean := new.ref_type = 'quiz_attempt';
begin
  if not legacy_writer and new.ref_type <> 'quiz_reward_request' then
    raise exception 'A quiz reward requires a quiz attempt' using errcode = '23514';
  end if;
  new.ref_type := 'quiz_attempt';
  select a.id, a.course_version_id, a.item_id, a.quiz_id, a.submitted_at, a.answers, a.results,
         item.grading -> 'questions' as questions
    into strict attempt
    from public.quiz_attempts a
    join public.course_version_items item on (item.version_id, item.item_id) = (a.course_version_id, a.item_id)
    where a.id = new.ref_id::uuid and a.user_id = new.user_id;

  -- The server grades the saved answers. Count answered leaves, including a
  -- wrong answer, boolean false and numeric zero. Groups can use either full
  -- or local child IDs. A selected code language alone is an empty editor.
  with recursive answers(result, answer) as (
    select r, attempt.answers -> (r ->> 'questionId')
    from jsonb_array_elements(case when jsonb_typeof(attempt.results) = 'array' then attempt.results else '[]'::jsonb end) r
    union all
    select child, coalesce(nullif(parent.answer -> (child ->> 'questionId'), 'null'::jsonb),
                           parent.answer -> split_part(child ->> 'questionId', '/', -1))
    from answers parent cross join lateral jsonb_array_elements(
      case when jsonb_typeof(parent.result -> 'children') = 'array' then parent.result -> 'children' else '[]'::jsonb end
    ) child
  ), leaves as (
    select result ->> 'status' as status,
           case
             when question ->> 'type' = 'code_answer' then answer -> 'code'
             when question ->> 'type' in ('classification', 'fill_blank')
                  and jsonb_typeof(question -> 'correctAnswer') = 'object' and jsonb_typeof(answer) = 'object'
               then (select jsonb_agg(entry.value) from jsonb_each(answer) entry where (question -> 'correctAnswer') ? entry.key)
             else answer
           end as content
    from answers cross join lateral (values (attempt.questions -> (result ->> 'questionId'))) definition(question)
    where not (result ? 'children')
      and result ->> 'status' in ('correct', 'partial', 'incorrect', 'self_assessed')
  )
  select case when count(*) = 0 then 0 else least(20, 5 + 2 * count(*) filter (where status = 'correct')) end
    into earned from leaves
    -- Include Unicode whitespace used by browser text inputs and rich text pastes.
    where jsonb_path_exists(content, 'strict $.** ? (
      @.type() == "boolean" || @.type() == "number" ||
      (@.type() == "string" && @ like_regex "[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")
    )');
  if earned = 0 then return null; end if;

  -- Item and quiz IDs cannot contain colons. Two attempts at different scores
  -- must serialize even though their XP event references differ.
  reward_scope := concat_ws(':', attempt.course_version_id, attempt.item_id, attempt.quiz_id);
  perform pg_advisory_xact_lock(hashtextextended('academy.quiz-xp:' || new.user_id || ':' || reward_scope, 0));
  select e.quiz_reward_total into credited from public.xp_events e
    where e.user_id = new.user_id and e.quiz_reward_scope = reward_scope
    order by e.quiz_reward_total desc limit 1;
  if not found then
    -- Include pre-migration and restored legacy events in the first receipt.
    -- Historical amounts, references and leaderboard dates stay intact.
    select least(20, coalesce(sum(e.points), 0)) into credited
      from public.quiz_attempts a
      join public.xp_events e on e.user_id = a.user_id and e.ref_id = a.id::text
      where (a.user_id, a.course_version_id, a.item_id, a.quiz_id) =
            (new.user_id, attempt.course_version_id, attempt.item_id, attempt.quiz_id)
        and e.kind = 'quiz_submitted' and e.ref_type = 'quiz_attempt';
  end if;

  -- A replay of an existing event cannot earn a second event, even for a
  -- legacy receipt with a different amount. Meaningful practice counts for
  -- the streak on its original ICT submission day regardless of the XP delta.
  if earned > credited and exists (
    select 1 from public.xp_events e where (e.user_id, e.kind, e.ref_type, e.ref_id) =
                                           (new.user_id, new.kind, new.ref_type, attempt.id::text)
  ) then
    earned := 0;
  end if;
  perform public.xp_update_streak(new.user_id, (attempt.submitted_at at time zone 'Asia/Ho_Chi_Minh')::date);
  if earned <= credited then
    if not legacy_writer then return null; end if;
    -- The previous client requests one inserted row. Returning no row makes
    -- PostgREST roll back the transaction, including this practice day's streak.
    new.points := 0;
    new.quiz_reward_scope := null;
    new.quiz_reward_total := 0;
  else
    new.points := earned - credited;
    new.quiz_reward_scope := reward_scope;
    new.quiz_reward_total := earned;
  end if;
  new.ref_id := attempt.id::text;
  new.created_at := attempt.submitted_at;
  return new;
end;
$$;
revoke all on function private.bound_quiz_reward() from public, anon, authenticated;
grant execute on function private.bound_quiz_reward() to service_role;
create trigger bound_quiz_reward before insert on public.xp_events
  for each row when (new.kind = 'quiz_submitted') execute function private.bound_quiz_reward();

-- One transaction returns the actual new event (if any) and the user's streak.
create function public.xp_record_quiz_submission(p_user_id uuid, p_attempt_id uuid)
returns table (event_id uuid, points numeric, current_streak integer, longest_streak integer, last_active_date date)
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.xp_events as e (user_id, kind, ref_type, ref_id, points)
    values (p_user_id, 'quiz_submitted', 'quiz_reward_request', p_attempt_id::text, 0)
    returning e.id, e.points into event_id, points;
  points := coalesce(points, 0);
  select s.current_streak, s.longest_streak, s.last_active_date
    into current_streak, longest_streak, last_active_date from public.streaks s where s.user_id = p_user_id;
  current_streak := coalesce(current_streak, 0);
  longest_streak := coalesce(longest_streak, 0);
  return next;
end;
$$;
revoke all on function public.xp_record_quiz_submission(uuid, uuid) from public, anon, authenticated;
grant execute on function public.xp_record_quiz_submission(uuid, uuid) to service_role;

-- A compatibility receipt alone does not qualify a learner for that week's ranking.
create or replace function public.xp_weekly_leaderboard(scope text, branch_id text, week_start timestamptz)
returns table (rank bigint, handle text, display_name text, points numeric)
language sql stable security definer set search_path = public, pg_temp
as $$
  with totals as (
    select e.user_id, sum(e.points) as points from public.xp_events e
    where e.created_at >= $3 and e.created_at < $3 + interval '7 days'
      and e.quiz_reward_total is distinct from 0
    group by e.user_id
  )
  select row_number() over (order by totals.points desc, p.display_name, p.handle),
         p.handle, p.display_name, totals.points
  from totals join public.profiles p on p.id = totals.user_id
  where p.profile_public and ($1 = 'global' or ($1 = 'branch' and p.branch_id = $2))
  order by 1
$$;
revoke all on function public.xp_weekly_leaderboard(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.xp_weekly_leaderboard(text, text, timestamptz) to service_role;
