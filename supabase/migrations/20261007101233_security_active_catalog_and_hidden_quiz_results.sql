-- Extend the existing account gate without replacing audience/ownership policies.
-- service_role continues to bypass RLS for authorized server operations.
create policy active_account_required on public.resources
  as restrictive for all to authenticated
  using ((select private.admin_session_active()))
  with check ((select private.admin_session_active()));
create policy active_account_required on public.opportunities
  as restrictive for all to authenticated
  using ((select private.admin_session_active()))
  with check ((select private.admin_session_active()));
create policy active_account_required on public.projects
  as restrictive for all to authenticated
  using ((select private.admin_session_active()))
  with check ((select private.admin_session_active()));

-- Parts contain correct option/blank IDs even when no answer reveal was returned.
-- Traverse every object/array so legacy nested groups and malformed wrappers are
-- safe too. Retain every other value, including primitives, scores and statuses.
create or replace function private.quiz_results_without_parts(value jsonb)
returns jsonb
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  cleaned jsonb;
begin
  case jsonb_typeof(value)
    when 'object' then
      select coalesce(jsonb_object_agg(entry.key, private.quiz_results_without_parts(entry.value)), '{}'::jsonb)
        into cleaned from jsonb_each(value) entry where entry.key <> 'parts';
    when 'array' then
      select coalesce(jsonb_agg(private.quiz_results_without_parts(entry.value) order by entry.ordinality), '[]'::jsonb)
        into cleaned from jsonb_array_elements(value) with ordinality entry(value, ordinality);
    else cleaned := value;
  end case;
  return cleaned;
end;
$$;
revoke all on function private.quiz_results_without_parts(jsonb) from public, anon, authenticated;
grant execute on function private.quiz_results_without_parts(jsonb) to service_role;

-- Only the two explicit reveal policies permit answer-bearing parts. Unknown,
-- missing or malformed pinned grading fails closed rather than revealing keys.
create or replace function private.sanitize_hidden_quiz_results()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  feedback jsonb;
begin
  select item.grading -> 'quizzes' -> new.quiz_id -> 'feedback' into feedback
    from public.course_version_items item
    where item.version_id = new.course_version_id and item.item_id = new.item_id;
  if feedback is null or feedback not in ('"per_question"'::jsonb, '"after_submit"'::jsonb) then
    new.results := private.quiz_results_without_parts(new.results);
  end if;
  return new;
end;
$$;
revoke all on function private.sanitize_hidden_quiz_results() from public, anon, authenticated;
grant execute on function private.sanitize_hidden_quiz_results() to service_role;
create trigger quiz_attempts_sanitize_hidden_results
  before insert or update on public.quiz_attempts
  for each row execute function private.sanitize_hidden_quiz_results();

-- Old clients also persisted submit/check responses in quiz block activity state.
-- Touch only these response fields; learner drafts may legitimately use 'parts'.
create or replace function private.quiz_activity_state_without_parts(value jsonb)
returns jsonb
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  cleaned jsonb := value;
begin
  if jsonb_typeof(value) = 'object' then
    if jsonb_typeof(value -> 'last') = 'object' and (value -> 'last') ? 'results' then
      cleaned := jsonb_set(cleaned, '{last,results}', private.quiz_results_without_parts(value #> '{last,results}'));
    end if;
    if value ? 'checks' then
      cleaned := jsonb_set(cleaned, '{checks}', private.quiz_results_without_parts(value -> 'checks'));
    end if;
  end if;
  return cleaned;
end;
$$;
revoke all on function private.quiz_activity_state_without_parts(jsonb) from public, anon, authenticated;
grant execute on function private.quiz_activity_state_without_parts(jsonb) to service_role;

create or replace function private.sanitize_hidden_quiz_activity_state()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  quiz_policies jsonb;
  feedback jsonb;
begin
  select item.grading -> 'quizzes' into quiz_policies
    from public.course_version_items item
    where item.version_id = new.course_version_id and item.item_id = new.item_id;
  -- A block absent from the quiz registry is a nonquiz activity: do not alter it.
  if jsonb_typeof(quiz_policies) = 'object' and quiz_policies ? new.block_id then
    feedback := quiz_policies -> new.block_id -> 'feedback';
    if feedback is null or feedback not in ('"per_question"'::jsonb, '"after_submit"'::jsonb) then
      new.state := private.quiz_activity_state_without_parts(new.state);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sanitize_hidden_quiz_activity_state() from public, anon, authenticated;
grant execute on function private.sanitize_hidden_quiz_activity_state() to service_role;
create trigger activity_state_sanitize_hidden_quiz_results
  before insert or update on public.activity_state
  for each row execute function private.sanitize_hidden_quiz_activity_state();

-- Sanitizing old attempts must also include suspended/deleted-account history.
-- Disable only the active-account write guard inside one atomic statement: ALTER
-- TABLE holds its lock until transaction end, so concurrent writes cannot bypass
-- the guard. History stamping remains enabled and all history fields stay intact.
do $$
begin
  alter table public.quiz_attempts disable trigger quiz_attempts_require_active_account;
  update public.quiz_attempts attempt
    set results = private.quiz_results_without_parts(attempt.results)
    where not exists (
      select 1 from public.course_version_items item
      where item.version_id = attempt.course_version_id and item.item_id = attempt.item_id
        and item.grading -> 'quizzes' -> attempt.quiz_id -> 'feedback'
          in ('"per_question"'::jsonb, '"after_submit"'::jsonb)
    )
    and attempt.results is distinct from private.quiz_results_without_parts(attempt.results);
  alter table public.quiz_attempts enable trigger quiz_attempts_require_active_account;

  alter table public.activity_state disable trigger activity_state_require_active_account;
  update public.activity_state activity
    set state = private.quiz_activity_state_without_parts(activity.state)
    from public.course_version_items item
    where item.version_id = activity.course_version_id and item.item_id = activity.item_id
      and jsonb_typeof(item.grading -> 'quizzes') = 'object'
      and (item.grading -> 'quizzes') ? activity.block_id
      and coalesce(item.grading -> 'quizzes' -> activity.block_id -> 'feedback'
        in ('"per_question"'::jsonb, '"after_submit"'::jsonb), false) = false
      and activity.state is distinct from private.quiz_activity_state_without_parts(activity.state);
  alter table public.activity_state enable trigger activity_state_require_active_account;
end;
$$;
