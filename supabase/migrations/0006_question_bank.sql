-- Forward-only question-bank procedures. Question versions are immutable;
-- published corrections are represented by inserting and publishing a new version.

create or replace function public.studio_bank_import_bundle(
  p_actor_id uuid,
  p_questions jsonb
)
returns table(id text, version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  question jsonb;
  colliding_ids text[];
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'p_questions must be a non-empty JSON array';
  end if;

  select coalesce(array_agg(candidate.id order by candidate.id), '{}'::text[])
  into colliding_ids
  from (
    select distinct value ->> 'id' as id
    from jsonb_array_elements(p_questions)
  ) as candidate
  join public.bank_questions as bank_question on bank_question.id = candidate.id;

  if cardinality(colliding_ids) > 0 then
    raise exception using
      errcode = 'P2001',
      message = 'BANK_QUESTION_EXISTS',
      detail = to_jsonb(colliding_ids)::text;
  end if;

  for question in select value from jsonb_array_elements(p_questions)
  loop
    begin
      insert into public.bank_questions (
        id,
        owner_id,
        type,
        tags,
        difficulty,
        status,
        current_version_id,
        languages
      ) values (
        question ->> 'id',
        p_actor_id,
        question ->> 'type',
        coalesce(array(select jsonb_array_elements_text(question -> 'tags')), '{}'::text[]),
        nullif(question ->> 'difficulty', ''),
        'draft',
        null,
        coalesce(array(select jsonb_array_elements_text(question -> 'languages')), '{vi}'::text[])
      );

      insert into public.bank_question_versions (
        question_id,
        version,
        payload,
        renders,
        grading,
        created_by
      ) values (
        question ->> 'id',
        1,
        question -> 'payload',
        question -> 'renders',
        question -> 'grading',
        p_actor_id
      );
    exception when unique_violation then
      raise exception using
        errcode = 'P2001',
        message = 'BANK_QUESTION_EXISTS',
        detail = jsonb_build_array(question ->> 'id')::text;
    end;

    id := question ->> 'id';
    version := 1;
    return next;
  end loop;
end;
$$;

create or replace function public.studio_bank_create_version(
  p_question_id text,
  p_actor_id uuid,
  p_payload jsonb,
  p_renders jsonb,
  p_grading jsonb,
  p_type text,
  p_tags text[],
  p_difficulty text
)
returns table(id uuid, version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version integer;
  created_id uuid;
  question_status text;
begin
  select bank_question.status
  into question_status
  from public.bank_questions as bank_question
  where bank_question.id = p_question_id
  for update;

  if not found then
    raise exception 'bank question not found';
  end if;

  if question_status = 'archived' then
    raise exception using
      errcode = 'P2002',
      message = 'BANK_QUESTION_ARCHIVED';
  end if;

  select coalesce(max(bank_version.version), 0) + 1
  into next_version
  from public.bank_question_versions as bank_version
  where bank_version.question_id = p_question_id;

  insert into public.bank_question_versions (
    question_id,
    version,
    payload,
    renders,
    grading,
    created_by
  ) values (
    p_question_id,
    next_version,
    p_payload,
    p_renders,
    p_grading,
    p_actor_id
  )
  returning bank_question_versions.id into created_id;

  -- For published questions, draft-version tags and difficulty stay in the
  -- immutable version payload until that version is published.
  update public.bank_questions
  set
    type = case when bank_questions.status = 'published' then bank_questions.type else p_type end,
    tags = case when bank_questions.status = 'published' then bank_questions.tags else coalesce(p_tags, '{}'::text[]) end,
    difficulty = case when bank_questions.status = 'published' then bank_questions.difficulty else p_difficulty end,
    updated_at = now()
  where bank_questions.id = p_question_id;

  return query select created_id, next_version;
end;
$$;

create or replace function public.prevent_bank_question_version_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    return old;
  end if;

  raise exception 'bank question versions are immutable';
  return null;
end;
$$;

drop trigger if exists bank_question_versions_immutable on public.bank_question_versions;

create trigger bank_question_versions_immutable
before update or delete on public.bank_question_versions
for each row execute function public.prevent_bank_question_version_mutation();

create or replace function public.studio_bank_publish(
  p_question_id text,
  p_version_id uuid,
  p_actor_id uuid
)
returns table(id text, status text, current_version_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  question_before jsonb;
  question_after jsonb;
  latest_version_id uuid;
  version_payload jsonb;
begin
  select to_jsonb(bank_question)
  into question_before
  from public.bank_questions as bank_question
  where bank_question.id = p_question_id
  for update;

  if not found then
    raise exception 'bank question not found';
  end if;

  if question_before ->> 'status' = 'archived' then
    raise exception using
      errcode = 'P2002',
      message = 'BANK_QUESTION_ARCHIVED';
  end if;

  select bank_version.id, bank_version.payload
  into latest_version_id, version_payload
  from public.bank_question_versions as bank_version
  where bank_version.question_id = p_question_id
  order by bank_version.version desc
  limit 1;

  if latest_version_id is distinct from p_version_id then
    raise exception using
      errcode = '40001',
      message = 'bank question version changed during publish';
  end if;

  update public.bank_questions as bank_question
  set
    status = 'published',
    current_version_id = p_version_id,
    type = version_payload ->> 'type',
    tags = coalesce(array(select jsonb_array_elements_text(version_payload -> 'tags')), '{}'::text[]),
    difficulty = nullif(version_payload ->> 'difficulty', ''),
    updated_at = now()
  where bank_question.id = p_question_id
  returning bank_question.id, bank_question.status, bank_question.current_version_id, to_jsonb(bank_question)
  into id, status, current_version_id, question_after;

  insert into public.audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    before,
    after
  ) values (
    p_actor_id,
    'bank.publish',
    'bank_question',
    p_question_id,
    question_before,
    question_after
  );

  return next;
end;
$$;

create or replace function public.studio_bank_question_usages(p_question_id text)
returns table(version_id uuid, item_id text, course_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select item.version_id, item.item_id, course_version.course_id
  from public.course_version_items as item
  join public.course_versions as course_version on course_version.id = item.version_id
  where jsonb_path_exists(
    item.source,
    'lax $.**."$ref" ? (@ == $bank_ref)',
    jsonb_build_object('bank_ref', 'bank:' || p_question_id)
  ) or jsonb_path_exists(
    item.source,
    'lax $.**."$pool".from[*] ? (@ == $bank_ref)',
    jsonb_build_object('bank_ref', 'bank:' || p_question_id)
  )
  order by course_version.course_id, item.version_id, item.item_id;
$$;

revoke all on function public.studio_bank_import_bundle(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.studio_bank_create_version(text, uuid, jsonb, jsonb, jsonb, text, text[], text) from public, anon, authenticated;
revoke all on function public.prevent_bank_question_version_mutation() from public, anon, authenticated, service_role;
revoke all on function public.studio_bank_publish(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.studio_bank_question_usages(text) from public, anon, authenticated;

grant execute on function public.studio_bank_import_bundle(uuid, jsonb) to service_role;
grant execute on function public.studio_bank_create_version(text, uuid, jsonb, jsonb, jsonb, text, text[], text) to service_role;
grant execute on function public.studio_bank_publish(text, uuid, uuid) to service_role;
grant execute on function public.studio_bank_question_usages(text) to service_role;
