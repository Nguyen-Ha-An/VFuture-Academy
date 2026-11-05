-- Each successful update advances a database-owned revision; a caller must compare
-- the revision it reviewed in the same statement that changes or deletes the row.
alter table public.teaching_announcements
  add column revision integer not null default 1 check (revision > 0);

create function public.bump_teaching_announcement_revision() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.bump_teaching_announcement_revision() from public, anon, authenticated;
create trigger teaching_announcements_revision
  before update on public.teaching_announcements
  for each row execute function public.bump_teaching_announcement_revision();

-- Keep audit insertion transactional and exclude announcement title/body.
create or replace function public.audit_teaching_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  target text;
  action_name text;
  before_value jsonb;
  after_value jsonb;
begin
  if tg_table_name = 'teaching_announcements' then
    target := 'teaching_announcement';
    action_name := case when tg_op = 'INSERT' then 'create'
      when old.status is distinct from new.status then new.status else 'edit' end;
    before_value := case when tg_op = 'INSERT' then null else jsonb_build_object('status',old.status,'revision',old.revision) end;
    after_value := jsonb_build_object('branchId',new.branch_id,'courseId',new.course_id,'status',new.status,'revision',new.revision);
  else
    target := 'assignment_schedule';
    action_name := 'update';
    before_value := case when tg_op = 'INSERT' then null else jsonb_build_object('dueAt',old.due_at) end;
    after_value := jsonb_build_object('branchId',new.branch_id,'courseVersionId',new.course_version_id,'itemId',new.item_id,'blockId',new.block_id,'dueAt',new.due_at);
  end if;
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
  values(new.updated_by,'teaching.' || case when target = 'teaching_announcement' then 'announcement' else 'schedule' end || '.' || action_name,target,new.id::text,before_value,after_value);
  return new;
end;
$$;

-- Remove the old unguarded delete entrypoint completely.
drop function public.delete_teaching_announcement(uuid,uuid);
create function public.delete_teaching_announcement(p_id uuid,p_actor_id uuid,p_expected_revision integer) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare deleted public.teaching_announcements%rowtype;
begin
  delete from public.teaching_announcements
    where id=p_id and status='draft' and revision=p_expected_revision returning * into deleted;
  if not found then return false; end if;
  insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
  values(p_actor_id,'teaching.announcement.delete','teaching_announcement',p_id::text,
    jsonb_build_object('branchId',deleted.branch_id,'courseId',deleted.course_id,'status',deleted.status,'revision',deleted.revision),null);
  return true;
end;
$$;
revoke all on function public.delete_teaching_announcement(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.delete_teaching_announcement(uuid,uuid,integer) to service_role;
