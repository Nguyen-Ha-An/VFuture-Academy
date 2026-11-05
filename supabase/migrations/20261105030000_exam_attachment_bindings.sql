-- Exam attachments are finalized and bound in the same transaction. Existing
-- assignment reservations and historical exam answers are not rewritten.
create table public.exam_attachment_bindings (
  asset_id text primary key references public.media_assets(id) on delete restrict,
  reservation_id uuid not null unique references public.media_upload_reservations(id) on delete restrict,
  owner_id uuid not null,
  attempt_id uuid not null references public.exam_attempts(id) on delete restrict,
  root_question_id text not null,
  question_id text not null,
  filename text not null,
  size_bytes bigint not null,
  mime text not null,
  created_at timestamptz not null default now()
);
alter table public.exam_attachment_bindings enable row level security;
revoke all on public.exam_attachment_bindings from public, anon, authenticated, service_role;
grant select on public.exam_attachment_bindings to service_role;

-- A self-assessed lesson quiz does not create an attempt until submission.
-- Its upload is instead bound to the owned enrollment-pinned quiz question.
create table public.quiz_attachment_bindings (
  asset_id text primary key references public.media_assets(id) on delete restrict,
  reservation_id uuid not null unique references public.media_upload_reservations(id) on delete restrict,
  owner_id uuid not null,
  course_version_id uuid not null,
  item_id text not null,
  quiz_id text not null,
  branch_id text,
  branch_scope_known boolean not null default false,
  root_question_id text not null,
  question_id text not null,
  filename text not null,
  size_bytes bigint not null,
  mime text not null,
  created_at timestamptz not null default now(),
  check (branch_scope_known is false or branch_id is not null),
  foreign key(course_version_id,item_id) references public.course_version_items(version_id,item_id) on delete restrict
);
alter table public.quiz_attachment_bindings enable row level security;
revoke all on public.quiz_attachment_bindings from public, anon, authenticated, service_role;
grant select on public.quiz_attachment_bindings to service_role;

-- Resolve only selected root questions and their actual pinned group descendants.
create function public.exam_pinned_question(p_set jsonb, p_root text, p_leaf text)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with recursive selected as (
    select s.value->>'id' as section_id
    from jsonb_array_elements(coalesce(p_set->'sections','[]'::jsonb)) s
    where coalesce(s.value->'questionIds','[]'::jsonb) ? p_root
  ), roots as (
    select q.value as question
    from selected s
    cross join lateral jsonb_array_elements(coalesce(p_set->'learner'->'sections','[]'::jsonb)) ls
    cross join lateral jsonb_array_elements(coalesce(ls.value->'questions','[]'::jsonb)) q
    where ls.value->>'id'=s.section_id and q.value->>'id'=p_root
  ), tree(question) as (
    select question from roots
    union all
    select child.value from tree parent
    cross join lateral jsonb_array_elements(case when parent.question->>'type'='question_group' then coalesce(parent.question->'questions','[]'::jsonb) else '[]'::jsonb end) child
  )
  select question from tree where question->>'id'=p_leaf limit 1
$$;
revoke all on function public.exam_pinned_question(jsonb,text,text) from public, anon, authenticated;

-- Exam reservation identity cannot be rebound by later state/lease transitions.
create function public.exam_attachment_reservation_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (old.request ? 'examAttemptId' or old.request ? 'quizId' or new.request ? 'examAttemptId' or new.request ? 'quizId') and (new.owner_id is distinct from old.owner_id
    or new.asset_id is distinct from old.asset_id or new.request is distinct from old.request
    or new.purpose is distinct from old.purpose or new.bucket is distinct from old.bucket
    or new.pending_path is distinct from old.pending_path or new.ready_path is distinct from old.ready_path
    or new.filename is distinct from old.filename or new.size_bytes is distinct from old.size_bytes
    or new.mime is distinct from old.mime or new.checksum is distinct from old.checksum) then
    raise exception 'EXAM_ATTACHMENT_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
create trigger exam_attachment_reservation_immutable before update on public.media_upload_reservations
  for each row execute function public.exam_attachment_reservation_immutable();
revoke all on function public.exam_attachment_reservation_immutable() from public, anon, authenticated;

create function public.exam_attachment_binding_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'EXAM_ATTACHMENT_IMMUTABLE' using errcode='55000';
end $$;
create trigger exam_attachment_binding_immutable before update or delete on public.exam_attachment_bindings
  for each row execute function public.exam_attachment_binding_immutable();
create trigger quiz_attachment_binding_immutable before update or delete on public.quiz_attachment_bindings
  for each row execute function public.exam_attachment_binding_immutable();
revoke all on function public.exam_attachment_binding_immutable() from public, anon, authenticated;

create function public.exam_attachment_asset_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.exam_attachment_bindings where asset_id=old.id)
    or exists(select 1 from public.quiz_attachment_bindings where asset_id=old.id) then
    if tg_op='DELETE' then raise exception 'EXAM_ATTACHMENT_IN_USE' using errcode='55000'; end if;
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
      or new.bucket is distinct from old.bucket or new.path is distinct from old.path
      or new.purpose is distinct from old.purpose or new.mime is distinct from old.mime
      or new.size_bytes is distinct from old.size_bytes then
      raise exception 'EXAM_ATTACHMENT_IMMUTABLE' using errcode='55000';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger exam_attachment_asset_immutable before update or delete on public.media_assets
  for each row execute function public.exam_attachment_asset_immutable();
revoke all on function public.exam_attachment_asset_immutable() from public, anon, authenticated;

-- quota -> attempt -> reservation -> asset. Existing complete is reentrant on
-- the quota and reservation locks. Any binding failure rolls back completion.
create function public.exam_attachment_complete(p_owner uuid, p_id uuid, p_attempt uuid, p_lease uuid, p_extra jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.exam_attempts%rowtype; r public.media_upload_reservations%rowtype; q jsonb; section jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(817004007);
  select * into a from public.exam_attempts where id=p_attempt for update;
  if not found or a.user_id<>p_owner then raise exception 'UPLOAD_NOT_FOUND'; end if;
  select * into r from public.media_upload_reservations where id=p_id for update;
  if not found or r.owner_id<>p_owner or r.purpose<>'submission' or r.bucket<>'submissions'
    or r.request ? 'quizId'
    or r.request->>'examAttemptId' is distinct from p_attempt::text
    or r.request->>'itemId' is distinct from a.item_id then raise exception 'UPLOAD_NOT_FOUND'; end if;
  -- A previously bound ready result follows same-course historical access.
  -- It remains readable after an enrollment version upgrade or exam closure.
  if r.state='ready' then
    result:=public.exam_attachment_ready(p_owner,p_id);
    if result is null then raise exception 'UPLOAD_CONFLICT'; end if;
    return result;
  end if;
  -- New completion still requires the exact active enrollment pin.
  if not exists (
    select 1 from public.enrollments e where e.user_id=p_owner and e.course_version_id=a.course_version_id and e.course_id=r.request->>'courseId'
      and e.status in ('active','completed')
      and (e.branch_scope_known is not true or e.branch_id is null or not exists(select 1 from public.branch_memberships m where m.user_id=p_owner and m.branch_id=e.branch_id and m.status='suspended'))
  ) or (a.branch_scope_known is true and a.branch_id is not null and exists(select 1 from public.branch_memberships m where m.user_id=p_owner and m.branch_id=a.branch_id and m.status='suspended')) then raise exception 'UPLOAD_CONFLICT'; end if;
  if a.status<>'in_progress' or (a.deadline_at is not null and clock_timestamp()>a.deadline_at+interval '30 seconds') then raise exception 'UPLOAD_EXPIRED'; end if;
  select value into section from jsonb_array_elements(coalesce(a.question_set->'sections','[]'::jsonb)) where coalesce(value->'questionIds','[]'::jsonb) ? (r.request->>'rootQuestionId') limit 1;
  if section is null or (section->>'deadlineOffsetMs' is not null and clock_timestamp()>a.started_at+((section->>'deadlineOffsetMs')::numeric * interval '1 millisecond')+interval '30 seconds') then raise exception 'UPLOAD_EXPIRED'; end if;
  q:=public.exam_pinned_question(a.question_set,r.request->>'rootQuestionId',r.request->>'questionId');
  if q is null or q->>'type'<>'upload_answer' or not (coalesce(q->'accepts','[]'::jsonb) ? 'file')
    or r.size_bytes>coalesce((q->>'maxFileSizeMB')::integer,20)*1048576
    or (jsonb_array_length(coalesce(q->'allowedMimeTypes','[]'::jsonb))>0 and not (q->'allowedMimeTypes' ? r.mime)) then raise exception 'UPLOAD_CONFLICT'; end if;
  result:=public.media_upload_transition(p_owner,p_id,'complete',p_lease,p_extra);
  insert into public.exam_attachment_bindings(asset_id,reservation_id,owner_id,attempt_id,root_question_id,question_id,filename,size_bytes,mime)
    values(r.asset_id,r.id,p_owner,p_attempt,r.request->>'rootQuestionId',r.request->>'questionId',r.filename,r.size_bytes,r.mime);
  return result;
end $$;
revoke all on function public.exam_attachment_complete(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.exam_attachment_complete(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- A completed, already-bound upload can be acknowledged after the attempt
-- closes. This never turns an old unbound ready reservation into a binding.
create function public.exam_attachment_ready(p_owner uuid,p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(r) from public.media_upload_reservations r
  join public.exam_attachment_bindings b on b.reservation_id=r.id and b.asset_id=r.asset_id
  join public.media_assets m on m.id=b.asset_id
  join public.exam_attempts a on a.id=b.attempt_id and a.user_id=p_owner
  join public.course_versions cv on cv.id=a.course_version_id
  where r.id=p_id and r.owner_id=p_owner and r.state='ready' and r.purpose='submission' and r.bucket='submissions'
    and b.owner_id=p_owner and b.attempt_id::text=r.request->>'examAttemptId'
    and b.root_question_id=r.request->>'rootQuestionId' and b.question_id=r.request->>'questionId'
    and m.owner_id=p_owner and m.bucket=r.bucket and m.path=r.ready_path and m.purpose=r.purpose
    and cv.course_id=r.request->>'courseId'
    and exists(select 1 from public.enrollments e where e.user_id=p_owner and e.course_id=cv.course_id and e.status in ('active','completed'))
    and (a.branch_scope_known is not true or a.branch_id is null or not exists(select 1 from public.branch_memberships sm where sm.user_id=p_owner and sm.branch_id=a.branch_id and sm.status='suspended'))
    and exists(select 1 from storage.objects o where o.bucket_id=r.bucket and o.name=r.ready_path
      and o.metadata->>'size'=r.size_bytes::text and o.metadata->>'mimetype'=r.mime)
$$;
revoke all on function public.exam_attachment_ready(uuid,uuid) from public, anon, authenticated;
grant execute on function public.exam_attachment_ready(uuid,uuid) to service_role;

-- Locate the selected quiz block in a published pinned learner rendering, then
-- descend only through its selected root question and actual group children.
create function public.quiz_pinned_question(p_version uuid,p_item text,p_quiz text,p_root text,p_leaf text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with recursive blocks(value) as (
    select r.payload from public.course_version_item_renders r where r.version_id=p_version and r.item_id=p_item
    union all
    select child.value from blocks parent cross join lateral jsonb_array_elements(
      case when jsonb_typeof(parent.value->'blocks')='array' then parent.value->'blocks' else '[]'::jsonb end ||
      case when jsonb_typeof(parent.value->'items')='array' then parent.value->'items' else '[]'::jsonb end ||
      case when jsonb_typeof(parent.value->'steps')='array' then parent.value->'steps' else '[]'::jsonb end
    ) child
  ), roots(question) as (
    select q.value from blocks b cross join lateral jsonb_array_elements(case when jsonb_typeof(b.value->'questions')='array' then b.value->'questions' else '[]'::jsonb end) q
    where b.value->>'type'='quiz' and b.value->>'id'=p_quiz and q.value->>'id'=p_root
  ), tree(question) as (
    select question from roots
    union all
    select child.value from tree parent cross join lateral jsonb_array_elements(case when parent.question->>'type'='question_group' then coalesce(parent.question->'questions','[]'::jsonb) else '[]'::jsonb end) child
  ) select question from tree where question->>'id'=p_leaf limit 1
$$;
revoke all on function public.quiz_pinned_question(uuid,text,text,text,text) from public, anon, authenticated;

create function public.quiz_attachment_complete(p_owner uuid,p_id uuid,p_lease uuid,p_extra jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.media_upload_reservations%rowtype; e public.enrollments%rowtype; q jsonb; result jsonb; v uuid;
begin
  perform pg_advisory_xact_lock(817004007);
  select * into r from public.media_upload_reservations where id=p_id for update;
  if not found or r.owner_id<>p_owner or r.purpose<>'submission' or r.bucket<>'submissions' or not (r.request ? 'quizId') or r.request ? 'examAttemptId' then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if r.state='ready' then
    result:=public.quiz_attachment_ready(p_owner,p_id);
    if result is null then raise exception 'UPLOAD_CONFLICT'; end if;
    return result;
  end if;
  v:=(r.request->>'courseVersionId')::uuid;
  select * into e from public.enrollments where user_id=p_owner and course_version_id=v and course_id=r.request->>'courseId' and status in ('active','completed') limit 1;
  if not found or (e.branch_scope_known is true and e.branch_id is not null and exists(select 1 from public.branch_memberships m where m.user_id=p_owner and m.branch_id=e.branch_id and m.status='suspended')) then raise exception 'UPLOAD_CONFLICT'; end if;
  q:=public.quiz_pinned_question(v,r.request->>'itemId',r.request->>'quizId',r.request->>'rootQuestionId',r.request->>'questionId');
  if q is null or q->>'type'<>'upload_answer' or q->'selfAssessment' is distinct from 'true'::jsonb or not (coalesce(q->'accepts','[]'::jsonb) ? 'file')
    or r.size_bytes>coalesce((q->>'maxFileSizeMB')::integer,20)*1048576
    or (jsonb_array_length(coalesce(q->'allowedMimeTypes','[]'::jsonb))>0 and not (q->'allowedMimeTypes' ? r.mime)) then raise exception 'UPLOAD_CONFLICT'; end if;
  result:=public.media_upload_transition(p_owner,p_id,'complete',p_lease,p_extra);
  insert into public.quiz_attachment_bindings(asset_id,reservation_id,owner_id,course_version_id,item_id,quiz_id,branch_scope_known,branch_id,root_question_id,question_id,filename,size_bytes,mime)
    values(r.asset_id,r.id,p_owner,v,r.request->>'itemId',r.request->>'quizId',e.branch_scope_known is true and e.branch_id is not null,case when e.branch_scope_known is true then e.branch_id else null end,r.request->>'rootQuestionId',r.request->>'questionId',r.filename,r.size_bytes,r.mime);
  return result;
end $$;
revoke all on function public.quiz_attachment_complete(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.quiz_attachment_complete(uuid,uuid,uuid,jsonb) to service_role;

create function public.quiz_attachment_ready(p_owner uuid,p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(r) from public.media_upload_reservations r
  join public.quiz_attachment_bindings b on b.reservation_id=r.id and b.asset_id=r.asset_id
  join public.media_assets m on m.id=b.asset_id
  join public.course_versions cv on cv.id=b.course_version_id
  where r.id=p_id and r.owner_id=p_owner and r.state='ready' and r.purpose='submission' and r.bucket='submissions'
    and b.owner_id=p_owner and b.course_version_id::text=r.request->>'courseVersionId' and b.item_id=r.request->>'itemId'
    and b.quiz_id=r.request->>'quizId' and b.root_question_id=r.request->>'rootQuestionId' and b.question_id=r.request->>'questionId'
    and m.owner_id=p_owner and m.bucket=r.bucket and m.path=r.ready_path and m.purpose=r.purpose
    and cv.course_id=r.request->>'courseId'
    and exists(select 1 from public.enrollments e where e.user_id=p_owner and e.course_id=cv.course_id and e.status in ('active','completed'))
    and (b.branch_scope_known is not true or b.branch_id is null or not exists(select 1 from public.branch_memberships sm where sm.user_id=p_owner and sm.branch_id=b.branch_id and sm.status='suspended'))
    and exists(select 1 from storage.objects o where o.bucket_id=r.bucket and o.name=r.ready_path and o.metadata->>'size'=r.size_bytes::text and o.metadata->>'mimetype'=r.mime)
$$;
revoke all on function public.quiz_attachment_ready(uuid,uuid) from public, anon, authenticated;
grant execute on function public.quiz_attachment_ready(uuid,uuid) to service_role;

-- Validate only the pinned question tree and the corresponding answer subtree.
create function public.exam_validate_attachment_tree(p_attempt uuid,p_owner uuid,p_root text,p_question jsonb,p_answer jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare child jsonb; child_value jsonb; entry record; file jsonb; b public.exam_attachment_bindings%rowtype; file_count integer;
begin
  if p_answer is null or p_answer='null'::jsonb then return; end if;
  if p_question->>'type'='question_group' then
    if jsonb_typeof(p_answer)<>'object' then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
    for entry in select key,value from jsonb_each(p_answer) loop
      select value into child from jsonb_array_elements(coalesce(p_question->'questions','[]'::jsonb)) where value->>'id'=entry.key limit 1;
      child_value:=entry.value;
      if child is null then
        if jsonb_path_exists(child_value,'$.**.files[*]') then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
        continue;
      end if;
      perform public.exam_validate_attachment_tree(p_attempt,p_owner,p_root,child,child_value);
    end loop;
    return;
  end if;
  if p_question->>'type'<>'upload_answer' then
    if jsonb_path_exists(p_answer,'$.**.files[*]') then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
    return;
  end if;
  if jsonb_typeof(p_answer)<>'object' then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  if p_answer->'files' is null then return; end if;
  if jsonb_typeof(p_answer->'files')<>'array' then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  file_count:=jsonb_array_length(p_answer->'files');
  if file_count>coalesce((p_question->>'maxFiles')::integer,3) or (file_count>0 and not (coalesce(p_question->'accepts','[]'::jsonb) ? 'file')) then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  if file_count<>(select count(distinct value->>'assetId') from jsonb_array_elements(p_answer->'files')) then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  for file in select value from jsonb_array_elements(p_answer->'files') loop
    select * into b from public.exam_attachment_bindings where asset_id=file->>'assetId';
    if not found or b.owner_id<>p_owner or b.attempt_id<>p_attempt or b.root_question_id<>p_root or b.question_id<>p_question->>'id'
      or b.filename is distinct from file->>'name' or b.mime is distinct from file->>'mime'
      or jsonb_typeof(file->'size') is distinct from 'number' or (file->>'size')::numeric is distinct from b.size_bytes
      or b.size_bytes>coalesce((p_question->>'maxFileSizeMB')::integer,20)*1048576
      or (jsonb_array_length(coalesce(p_question->'allowedMimeTypes','[]'::jsonb))>0 and not (p_question->'allowedMimeTypes' ? b.mime)) then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  end loop;
end $$;
revoke all on function public.exam_validate_attachment_tree(uuid,uuid,text,jsonb,jsonb) from public, anon, authenticated;

-- Preserve historical answers when only non-attachment data changes. The
-- fingerprint includes the pinned leaf identity and the complete file DTOs.
create function public.exam_attachment_fingerprint(p_question jsonb,p_answer jsonb)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with recursive nodes(question,answer) as (
    select p_question,p_answer
    union all
    select child.value,parent.answer->(child.value->>'id') from nodes parent
    cross join lateral jsonb_array_elements(case when parent.question->>'type'='question_group' then coalesce(parent.question->'questions','[]'::jsonb) else '[]'::jsonb end) child
    where jsonb_typeof(parent.answer)='object'
  )
  select coalesce(jsonb_agg(jsonb_build_object('questionId',question->>'id','files',
    case when jsonb_typeof(answer)='array' then answer else answer->'files' end) order by question->>'id'), '[]'::jsonb)
  from nodes where question->>'type'='upload_answer' and
    (case when jsonb_typeof(answer)='array' then jsonb_array_length(answer)
      when jsonb_typeof(answer->'files')='array' then jsonb_array_length(answer->'files') else 0 end)>0
$$;
revoke all on function public.exam_attachment_fingerprint(jsonb,jsonb) from public, anon, authenticated;

create function public.exam_answer_may_reference_asset(p_answer jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_path_exists(coalesce(p_answer,'null'::jsonb),'$.**.files[*]')
    or jsonb_path_exists(coalesce(p_answer,'null'::jsonb),'$.** ? (@.type() == "string" && @ like_regex "^asset_")')
$$;
revoke all on function public.exam_answer_may_reference_asset(jsonb) from public, anon, authenticated;

create function public.exam_answer_attachment_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.exam_attempts%rowtype; q jsonb; asset text; prior jsonb; old_files jsonb; new_files jsonb;
begin
  -- Grading and result updates must not reinterpret unchanged historical JSON.
  if tg_op='UPDATE' and new.answer is not distinct from old.answer then return new; end if;
  if tg_op='INSERT' and not public.exam_answer_may_reference_asset(new.answer) then return new; end if;
  if tg_op='UPDATE' and not public.exam_answer_may_reference_asset(new.answer) and not public.exam_answer_may_reference_asset(old.answer) then return new; end if;
  select * into a from public.exam_attempts where id=new.attempt_id for update;
  if not found or a.user_id<>new.user_id then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  -- The finalize RPC uses INSERT ... ON CONFLICT UPDATE even for unchanged
  -- historical answers. PostgreSQL fires BEFORE INSERT before conflict lookup.
  if tg_op='INSERT' then
    select answer into prior from public.exam_answers where attempt_id=new.attempt_id and question_id=new.question_id and user_id=new.user_id;
    if found and prior is not distinct from new.answer then return new; end if;
  else
    prior:=old.answer;
  end if;
  q:=public.exam_pinned_question(a.question_set,new.question_id,new.question_id);
  if q is null then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  old_files:=jsonb_path_query_array(coalesce(prior,'null'::jsonb),'$.**.files');
  new_files:=jsonb_path_query_array(coalesce(new.answer,'null'::jsonb),'$.**.files');
  if old_files=new_files and public.exam_attachment_fingerprint(q,prior)=public.exam_attachment_fingerprint(q,new.answer) then return new; end if;
  if a.status<>'in_progress' then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  for asset in select distinct item.value #>> '{}' from jsonb_path_query(new.answer,'$.**.files[*].assetId') as item(value) order by 1 loop
    perform 1 from public.media_assets where id=asset for update;
    if not found then raise exception 'EXAM_ATTACHMENT_INVALID'; end if;
  end loop;
  perform public.exam_validate_attachment_tree(a.id,a.user_id,new.question_id,q,new.answer);
  return new;
end $$;
revoke all on function public.exam_answer_attachment_guard() from public, anon, authenticated;
create trigger exam_answer_attachment_guard before insert or update on public.exam_answers
  for each row execute function public.exam_answer_attachment_guard();

create function public.quiz_validate_attachment_tree(p_owner uuid,p_version uuid,p_item text,p_quiz text,p_root text,p_question jsonb,p_answer jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare child jsonb; entry record; file jsonb; b public.quiz_attachment_bindings%rowtype; file_count integer;
begin
  if p_answer is null or p_answer='null'::jsonb then return; end if;
  if p_question->>'type'='question_group' then
    if jsonb_typeof(p_answer)<>'object' then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
    for entry in select key,value from jsonb_each(p_answer) loop
      select value into child from jsonb_array_elements(coalesce(p_question->'questions','[]'::jsonb)) where value->>'id'=entry.key limit 1;
      if child is null then
        if public.exam_answer_may_reference_asset(entry.value) then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
        continue;
      end if;
      perform public.quiz_validate_attachment_tree(p_owner,p_version,p_item,p_quiz,p_root,child,entry.value);
    end loop;
    return;
  end if;
  if p_question->>'type'<>'upload_answer' then
    if jsonb_path_exists(p_answer,'$.**.files[*]') then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
    return;
  end if;
  if jsonb_typeof(p_answer)<>'object' then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  if p_answer->'files' is null then return; end if;
  if jsonb_typeof(p_answer->'files')<>'array' then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  file_count:=jsonb_array_length(p_answer->'files');
  if file_count>coalesce((p_question->>'maxFiles')::integer,3) or (file_count>0 and (p_question->'selfAssessment' is distinct from 'true'::jsonb or not (coalesce(p_question->'accepts','[]'::jsonb) ? 'file'))) then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  if file_count<>(select count(distinct value->>'assetId') from jsonb_array_elements(p_answer->'files')) then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  for file in select value from jsonb_array_elements(p_answer->'files') loop
    select * into b from public.quiz_attachment_bindings where asset_id=file->>'assetId';
    if not found or b.owner_id<>p_owner or b.course_version_id<>p_version or b.item_id<>p_item or b.quiz_id<>p_quiz or b.root_question_id<>p_root or b.question_id<>p_question->>'id'
      or b.filename is distinct from file->>'name' or b.mime is distinct from file->>'mime'
      or jsonb_typeof(file->'size') is distinct from 'number' or (file->>'size')::numeric is distinct from b.size_bytes
      or b.size_bytes>coalesce((p_question->>'maxFileSizeMB')::integer,20)*1048576
      or (jsonb_array_length(coalesce(p_question->'allowedMimeTypes','[]'::jsonb))>0 and not (p_question->'allowedMimeTypes' ? b.mime)) then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  end loop;
end $$;
revoke all on function public.quiz_validate_attachment_tree(uuid,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;

create function public.quiz_answer_attachment_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare entry record; q jsonb; asset text;
begin
  if tg_op='UPDATE' and new.answers is not distinct from old.answers then return new; end if;
  if not public.exam_answer_may_reference_asset(new.answers) then return new; end if;
  for asset in select distinct item.value #>> '{}' from jsonb_path_query(new.answers,'$.**.files[*].assetId') as item(value) order by 1 loop
    perform 1 from public.media_assets where id=asset for update;
    if not found then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
  end loop;
  for entry in select key,value from jsonb_each(new.answers) loop
    q:=public.quiz_pinned_question(new.course_version_id,new.item_id,new.quiz_id,entry.key,entry.key);
    if q is null then
      if public.exam_answer_may_reference_asset(entry.value) then raise exception 'QUIZ_ATTACHMENT_INVALID'; end if;
      continue;
    end if;
    perform public.quiz_validate_attachment_tree(new.user_id,new.course_version_id,new.item_id,new.quiz_id,entry.key,q,entry.value);
  end loop;
  return new;
end $$;
revoke all on function public.quiz_answer_attachment_guard() from public, anon, authenticated;
create trigger quiz_answer_attachment_guard before insert or update on public.quiz_attempts
  for each row execute function public.quiz_answer_attachment_guard();

-- Only a real answer at a pinned upload question is a grader-readable link.
-- A legacy unbound asset still requires matching asset owner and attempt owner.
create function public.exam_answer_has_asset(p_question jsonb,p_answer jsonb,p_asset text,p_leaf text default null)
returns boolean language plpgsql stable set search_path = public, pg_temp as $$
declare child jsonb; file jsonb; files jsonb;
begin
  if p_question is null or p_answer is null or p_answer='null'::jsonb then return false; end if;
  if p_question->>'type'='question_group' and jsonb_typeof(p_answer)='object' then
    for child in select value from jsonb_array_elements(coalesce(p_question->'questions','[]'::jsonb)) loop
      if public.exam_answer_has_asset(child,p_answer->(child->>'id'),p_asset,p_leaf) then return true; end if;
    end loop;
    return false;
  end if;
  if p_question->>'type'<>'upload_answer' or (p_leaf is not null and p_question->>'id'<>p_leaf) then return false; end if;
  files:=case when jsonb_typeof(p_answer)='array' then p_answer when jsonb_typeof(p_answer->'files')='array' then p_answer->'files' else '[]'::jsonb end;
  for file in select value from jsonb_array_elements(files) loop
    if (jsonb_typeof(file)='string' and file #>> '{}' = p_asset) or (jsonb_typeof(file)='object' and file->>'assetId'=p_asset) then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function public.exam_answer_has_asset(jsonb,jsonb,text,text) from public, anon, authenticated;

create function public.exam_attachment_gradeable_attempts(p_asset text,p_owner uuid)
returns table(attempt_id uuid,branch_id text,branch_scope_known boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id,a.branch_id,a.branch_scope_known
  from public.media_assets m
  join public.exam_answers ans on ans.user_id=m.owner_id
  join public.exam_attempts a on a.id=ans.attempt_id and a.user_id=m.owner_id
  left join public.exam_attachment_bindings b on b.asset_id=m.id
  where m.id=p_asset and m.owner_id=p_owner and m.bucket='submissions'
    and not exists(select 1 from public.quiz_attachment_bindings qb where qb.asset_id=m.id)
    and a.status <> 'in_progress' and a.submitted_at is not null
    and (b.asset_id is null or (b.owner_id=p_owner and b.attempt_id=a.id and b.root_question_id=ans.question_id))
    and public.exam_answer_has_asset(public.exam_pinned_question(a.question_set,ans.question_id,ans.question_id),ans.answer,p_asset,b.question_id)
$$;
revoke all on function public.exam_attachment_gradeable_attempts(text,uuid) from public, anon, authenticated;
grant execute on function public.exam_attachment_gradeable_attempts(text,uuid) to service_role;
