-- Compatible application must be deployed before new persisted permissions activate.
-- Course identity is stable across versions; an empty group retains its revision.
insert into public.permission_registry(permission,group_name,scope_kind) values
 ('teaching.assignment.manage','grading','any'),('teaching.scope.all','grading','any');
alter table public.role_definitions disable trigger role_definitions_protect_built_in;
update public.role_definitions set permissions=permissions || array(
 select permission from unnest(array['teaching.assignment.manage','teaching.scope.all']::text[]) permission
 where not permission=any(public.role_definitions.permissions)
) where id in ('school_admin','central_admin');
alter table public.role_definitions enable trigger role_definitions_protect_built_in;

create table public.course_teaching_groups (
 course_id text not null references public.courses(id) on delete cascade,
 branch_id text not null references public.branches(id) on delete cascade,
 revision integer not null default 0 check(revision>=0),
 primary key(course_id,branch_id)
);
create table public.course_teaching_assignments (
 course_id text not null,
 branch_id text not null,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check(role in ('primary','assistant')),
 primary key(course_id,branch_id,user_id),
 foreign key(course_id,branch_id) references public.course_teaching_groups(course_id,branch_id) on delete cascade
);
create unique index course_teaching_one_primary on public.course_teaching_assignments(course_id,branch_id) where role='primary';
create index course_teaching_by_user on public.course_teaching_assignments(user_id,branch_id,course_id);
alter table public.course_teaching_groups enable row level security;
alter table public.course_teaching_assignments enable row level security;
revoke all on public.course_teaching_groups,public.course_teaching_assignments from public,anon,authenticated,service_role;
grant select on public.course_teaching_groups,public.course_teaching_assignments to service_role;

create function public.teaching_course_accessible(p_course_id text,p_branch_id text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.courses c where c.id=p_course_id
 and (c.ownership_kind='central' or c.owner_branch_id=p_branch_id)
 and (exists(select 1 from public.enrollments e where e.course_id=c.id and e.branch_id=p_branch_id
   and e.branch_scope_known and e.status in ('active','completed'))
 or (c.status='published' and exists(select 1 from public.course_version_outline o where o.version_id=c.current_version_id
   and (o.access->>'scope'='global' or (o.access->>'scope'='branches' and (o.access->'branchIds') ? p_branch_id))))))
$$;
create function public.teaching_candidate(p_user_id uuid,p_branch_id text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.user_accounts a join public.branch_memberships m on m.user_id=a.user_id
 where a.user_id=p_user_id and a.status='active' and m.branch_id=p_branch_id and m.status='active')
 and exists(select 1 from unnest(array['submission.grade','exam.release','teaching.announcement.manage',
 'teaching.schedule.manage','report.branch.read','analytics.branch.read']::text[]) permission
 where public.authorization_has_permission(p_user_id,permission,'branch',p_branch_id))
$$;

-- Both the operation capability and assignment are necessary. A global operation
-- grant alone never implies access to every course. Unknown history is global only.
create function public.teaching_has_course_permission(p_actor_id uuid,p_permission text,p_course_id text,p_branch_id text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_branch_id is null then
   public.authorization_has_permission(p_actor_id,p_permission,'central',null)
   and public.authorization_has_permission(p_actor_id,'teaching.scope.all','central',null)
 else public.authorization_has_permission(p_actor_id,p_permission,'branch',p_branch_id)
   and (public.authorization_has_permission(p_actor_id,'teaching.scope.all','branch',p_branch_id)
   or (public.teaching_candidate(p_actor_id,p_branch_id) and exists(
     select 1 from public.course_teaching_assignments a where a.user_id=p_actor_id
       and a.course_id=p_course_id and a.branch_id=p_branch_id))) end
$$;

create function public.teaching_course_scope(p_actor_id uuid,p_permission text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'all',public.authorization_has_permission(p_actor_id,p_permission,'central',null)
   and public.authorization_has_permission(p_actor_id,'teaching.scope.all','central',null),
 'branchIds',coalesce((select jsonb_agg(b.id order by b.id) from public.branches b
   where public.authorization_has_permission(p_actor_id,p_permission,'branch',b.id)
   and public.authorization_has_permission(p_actor_id,'teaching.scope.all','branch',b.id)),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('courseId',a.course_id,'branchId',a.branch_id) order by a.course_id,a.branch_id)
   from public.course_teaching_assignments a where a.user_id=p_actor_id
   and public.teaching_candidate(a.user_id,a.branch_id)
   and public.authorization_has_permission(p_actor_id,p_permission,'branch',a.branch_id)),'[]'::jsonb))
$$;

create function public.teaching_teacher_options(p_actor_id uuid,p_branch_id text,p_page integer default 1,p_page_size integer default 100) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.authorization_assert_actor(p_actor_id,'teaching.assignment.manage','branch',p_branch_id);
 if p_page<1 or p_page_size<1 or p_page_size>100 then raise exception using errcode='22023',message='Invalid pagination'; end if;
 return jsonb_build_object('page',p_page,'pageSize',p_page_size,
 'hasMore',(select count(*)>(p_page::bigint*p_page_size) from public.profiles p where public.teaching_candidate(p.id,p_branch_id)),
 'teachers',coalesce((select jsonb_agg(jsonb_build_object('userId',p.id,'displayName',p.display_name,'handle',p.handle) order by lower(p.display_name),p.id)
 from (select p.* from public.profiles p where public.teaching_candidate(p.id,p_branch_id)
 order by lower(p.display_name),p.id limit p_page_size offset ((p_page::bigint-1)*p_page_size)) p),'[]'::jsonb));
end;
$$;

create function public.teaching_course_teachers(p_actor_id uuid,p_course_id text,p_branch_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare resolved_branch text:=p_branch_id; staff boolean:=false; scope_value jsonb;
begin
 if not exists(select 1 from public.user_accounts where user_id=p_actor_id and status='active') then
   raise exception using errcode='42501',message='Permission denied'; end if;
 if resolved_branch is not null then
   scope_value:=public.teaching_course_scope(p_actor_id,'learning.read');
   staff:=public.authorization_has_permission(p_actor_id,'teaching.assignment.manage','branch',resolved_branch)
     or (public.authorization_has_permission(p_actor_id,'learning.read','branch',resolved_branch)
       and ((scope_value->>'all')::boolean or scope_value->'branchIds' ? resolved_branch
       or scope_value->'assignments' @> jsonb_build_array(jsonb_build_object('courseId',p_course_id,'branchId',resolved_branch))));
 end if;
 if not staff then
   -- Deliberately use enrollment history, never the learner's current profile branch.
   select case when e.branch_scope_known then e.branch_id else null end into resolved_branch from public.enrollments e where e.user_id=p_actor_id and e.course_id=p_course_id
     and e.status in ('active','completed')
     and (p_branch_id is null or (e.branch_scope_known and e.branch_id=p_branch_id));
   if found and resolved_branch is null then
     return jsonb_build_object('courseId',p_course_id,'branchId',null,'branchScopeKnown',false,'revision',0,'teachers','[]'::jsonb);
   end if;
   if not found then raise exception using errcode='42501',message='Permission denied'; end if;
 elsif not public.teaching_course_accessible(p_course_id,resolved_branch) then
   raise exception using errcode='P0002',message='Course not found';
 end if;
 return jsonb_build_object('courseId',p_course_id,'branchId',resolved_branch,'branchScopeKnown',true,
   'revision',coalesce((select revision from public.course_teaching_groups where course_id=p_course_id and branch_id=resolved_branch),0),
   'teachers',coalesce((select jsonb_agg(
     (case when staff then jsonb_build_object('userId',a.user_id) else '{}'::jsonb end)
      || jsonb_build_object('displayName',p.display_name,'role',a.role)
      order by case a.role when 'primary' then 0 else 1 end,lower(p.display_name),a.user_id)
     from public.course_teaching_assignments a join public.profiles p on p.id=a.user_id
     where a.course_id=p_course_id and a.branch_id=resolved_branch and (staff or public.teaching_candidate(a.user_id,a.branch_id))),'[]'::jsonb));
end;
$$;

create function public.replace_course_teachers(p_actor_id uuid,p_course_id text,p_branch_id text,p_expected_revision integer,p_teachers jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actual_revision integer; before_value jsonb; after_value jsonb;
begin
 -- Serialize with membership/role administration so capability revocation cannot
 -- race validation and commit. The per-group row lock serializes competing editors.
 perform pg_advisory_xact_lock(hashtextextended('vfuture.authorization.mutations',0));
 perform 1 from public.authorization_guard where id=true for update;
 perform public.authorization_assert_actor(p_actor_id,'teaching.assignment.manage','branch',p_branch_id);
 if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_teachers) is distinct from 'array'
   or jsonb_array_length(p_teachers)>100 then raise exception using errcode='22023',message='Invalid teachers'; end if;
 if not public.teaching_course_accessible(p_course_id,p_branch_id) then raise exception using errcode='P0002',message='Course not found'; end if;
 if exists(select 1 from jsonb_array_elements(p_teachers) t where jsonb_typeof(t)<>'object'
    or not(t ? 'userId') or not(t ? 'role') or t->>'userId' is null
    or t->>'role' is null or t->>'role' not in ('primary','assistant')
    or (select count(*) from jsonb_object_keys(t))<>2)
   or (select count(*) from jsonb_array_elements(p_teachers))<>(select count(distinct t->>'userId') from jsonb_array_elements(p_teachers) t)
   or (jsonb_array_length(p_teachers)>0 and (select count(*) from jsonb_array_elements(p_teachers) t where t->>'role'='primary')<>1)
 then raise exception using errcode='22023',message='Invalid teachers'; end if;
 if exists(select 1 from jsonb_array_elements(p_teachers) t where not public.teaching_candidate((t->>'userId')::uuid,p_branch_id)) then
   raise exception using errcode='22023',message='Teacher must be active with branch membership and teaching capability'; end if;
 insert into public.course_teaching_groups(course_id,branch_id) values(p_course_id,p_branch_id) on conflict do nothing;
 select revision into actual_revision from public.course_teaching_groups where course_id=p_course_id and branch_id=p_branch_id for update;
 if actual_revision<>p_expected_revision then raise exception using errcode='40001',message='Teacher assignments changed'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) order by user_id),'[]'::jsonb) into before_value
 from public.course_teaching_assignments where course_id=p_course_id and branch_id=p_branch_id;
 delete from public.course_teaching_assignments where course_id=p_course_id and branch_id=p_branch_id;
 insert into public.course_teaching_assignments(course_id,branch_id,user_id,role)
 select p_course_id,p_branch_id,(t->>'userId')::uuid,t->>'role' from jsonb_array_elements(p_teachers) t;
 update public.course_teaching_groups set revision=revision+1 where course_id=p_course_id and branch_id=p_branch_id;
 select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) order by user_id),'[]'::jsonb) into after_value
 from public.course_teaching_assignments where course_id=p_course_id and branch_id=p_branch_id;
 insert into public.audit_log(actor_id,action,target_type,target_id,before,after)
 values(p_actor_id,'teaching.assignment.replace','course_teaching_group',p_course_id||':'||p_branch_id,
 jsonb_build_object('revision',actual_revision,'teachers',before_value),
 jsonb_build_object('courseId',p_course_id,'branchId',p_branch_id,'revision',actual_revision+1,'teachers',after_value));
 return public.teaching_course_teachers(p_actor_id,p_course_id,p_branch_id);
end;
$$;

create function public.teaching_assigned_courses(p_actor_id uuid,p_locale text default 'vi') returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('courses',coalesce((select jsonb_agg(jsonb_build_object(
 'courseId',a.course_id,'title',coalesce(o.meta->'title'->>p_locale,o.meta->'title'->>'vi',o.meta->'title'->>'en',case when jsonb_typeof(o.meta->'title')='string' then o.meta->>'title' end,a.course_id),
 'branchId',a.branch_id,'branchName',b.name,'role',a.role) order by a.branch_id,a.course_id)
 from public.course_teaching_assignments a join public.branches b on b.id=a.branch_id
 join public.courses c on c.id=a.course_id
 left join lateral (select outline.meta from public.course_version_outline outline
   where outline.course_id=c.id and (outline.version_id=c.current_version_id or exists(select 1 from public.enrollments e
     where e.course_id=c.id and e.course_version_id=outline.version_id and e.branch_id=a.branch_id and e.branch_scope_known and e.status in ('active','completed')))
   order by (outline.version_id=c.current_version_id) desc,outline.version_id limit 1) o on true
 where a.user_id=p_actor_id and public.teaching_candidate(a.user_id,a.branch_id)
 and public.teaching_course_accessible(a.course_id,a.branch_id)),'[]'::jsonb))
$$;

-- No public RPC caller may supply another actor's identity. Only trusted server
-- clients call these functions; assignment rows cannot be changed around the RPC.
revoke all on function public.teaching_course_accessible(text,text),public.teaching_candidate(uuid,text),
 public.teaching_has_course_permission(uuid,text,text,text),public.teaching_course_scope(uuid,text),public.teaching_teacher_options(uuid,text,integer,integer),
 public.teaching_course_teachers(uuid,text,text),public.replace_course_teachers(uuid,text,text,integer,jsonb),
 public.teaching_assigned_courses(uuid,text) from public,anon,authenticated;
grant execute on function public.teaching_has_course_permission(uuid,text,text,text),public.teaching_course_scope(uuid,text),public.teaching_teacher_options(uuid,text,integer,integer),
 public.teaching_course_teachers(uuid,text,text),public.replace_course_teachers(uuid,text,text,integer,jsonb),
 public.teaching_assigned_courses(uuid,text) to service_role;
