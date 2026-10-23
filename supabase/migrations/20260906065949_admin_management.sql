-- Central administration. Called only by the authenticated application server;
-- every operation re-resolves the actor and explicit scope inside the transaction.
alter table public.role_definitions add column if not exists version integer not null default 1 check (version > 0);
alter table public.audit_log add column if not exists branch_id text references public.branches(id);
create index if not exists audit_log_branch_at on public.audit_log(branch_id, at desc, id desc);
create index if not exists profiles_directory_name on public.profiles(lower(display_name), id);

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and length(email) <= 254),
  branch_id text not null references public.branches(id),
  role_definition_id text references public.role_definitions(id),
  role_version integer,
  token_hash text not null unique check (length(token_hash) = 64),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  check (expires_at > created_at)
);
create index admin_invitations_branch_created on public.admin_invitations(branch_id, created_at desc);
alter table public.admin_invitations enable row level security;
revoke all on public.admin_invitations from public, anon, authenticated;
grant select,insert,update,delete on public.admin_invitations to service_role;

create or replace function public.admin_member_json(p_user_id uuid, p_scope_kind text, p_branch_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object(
   'id', p.id, 'displayName', p.display_name, 'handle', p.handle, 'email', coalesce(u.email,''),
   'branchId', case when p_scope_kind='central' or p.branch_id=p_branch_id then p.branch_id else null end,
   'accountStatus', a.status, 'createdAt', p.created_at,
   'memberships', coalesce((select jsonb_agg(jsonb_build_object(
     'branchId',m.branch_id,'branchName',b.name,'status',m.status,'isPrimary',m.branch_id=p.branch_id) order by b.name)
     from public.branch_memberships m join public.branches b on b.id=m.branch_id
     where m.user_id=p.id and (p_scope_kind='central' or m.branch_id=p_branch_id)), '[]'::jsonb),
   'assignments',coalesce((select jsonb_agg(jsonb_build_object(
     'id',r.id,'roleId',d.id,'roleName',d.name,
     'scope',case when r.branch_id is null then jsonb_build_object('kind','central') else jsonb_build_object('kind','branch','branchId',r.branch_id) end,
     'grantedAt',r.granted_at,'grantedBy',r.granted_by) order by d.name)
     from public.role_assignments r join public.role_definitions d on d.id=r.role_definition_id
     where r.user_id=p.id and (p_scope_kind='central' or r.branch_id=p_branch_id)), '[]'::jsonb))
 from public.profiles p join auth.users u on u.id=p.id join public.user_accounts a on a.user_id=p.id where p.id=p_user_id;
$$;

create or replace function public.admin_role_json(p_role_id text, p_scope_kind text, p_branch_id text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'scopeKind',d.scope_kind,
   'permissions',to_jsonb(d.permissions),'builtIn',d.built_in,'grantableBySchool',d.school_grantable,'version',d.version,
   'assignmentCount',(select count(*) from public.role_assignments a where a.role_definition_id=d.id and (p_scope_kind='central' or a.branch_id=p_branch_id)))
 from public.role_definitions d where d.id=p_role_id;
$$;

create or replace function public.admin_invitation_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',i.id,'email',i.email,'branchId',i.branch_id,'roleId',i.role_definition_id,
   'expiresAt',i.expires_at,'createdAt',i.created_at,
   'status',case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked' when i.expires_at <= now() then 'expired' else 'pending' end)
 from public.admin_invitations i where i.id=p_id;
$$;

create or replace function public.admin_management_read(
 p_actor_id uuid,p_scope_kind text,p_branch_id text,p_operation text,p_input jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 result jsonb; target uuid; page_no integer; size_no integer; q text; is_global boolean;
 allow_learning boolean; allow_grading boolean; allow_history boolean; role_values jsonb;
 member_value jsonb; search_token record;
begin
 perform public.authorization_assert_actor(p_actor_id,'admin.access',p_scope_kind,p_branch_id);
 is_global := p_scope_kind='central';
 if p_operation='options' or p_operation='roles' then
   if p_operation='roles' and not (
     public.authorization_has_permission(p_actor_id,'role.definition.read',p_scope_kind,p_branch_id) or
     public.authorization_has_permission(p_actor_id,'role.definition.manage','central',null) or
     public.authorization_has_permission(p_actor_id,'role.assignment.branch',p_scope_kind,p_branch_id)
   ) then raise insufficient_privilege; end if;
   select coalesce(jsonb_agg(public.admin_role_json(d.id,p_scope_kind,p_branch_id) order by d.built_in desc,d.name),'[]'::jsonb) into role_values
     from public.role_definitions d where
       (is_global and (public.authorization_has_permission(p_actor_id,'role.definition.read','central',null)
         or public.authorization_has_permission(p_actor_id,'role.definition.manage','central',null)
         or public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null)))
       or (not is_global and d.scope_kind='branch' and
         (public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null) or d.school_grantable));
   if p_operation='roles' then return role_values; end if;
   -- Options feed grant controls; role-definition browsing has its own wider endpoint.
   select coalesce(jsonb_agg(value),'[]'::jsonb) into role_values from jsonb_array_elements(role_values) candidate(value)
   where (is_global and public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null)
      and not exists(select 1 from jsonb_array_elements_text(value->'permissions') permission where not public.authorization_has_permission(p_actor_id,permission,'central',null)))
     or (not is_global and public.authorization_has_permission(p_actor_id,'role.assignment.branch','branch',p_branch_id)
       and (public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null)
         and not exists(select 1 from jsonb_array_elements_text(value->'permissions') permission where not public.authorization_has_permission(p_actor_id,permission,'branch',p_branch_id))
         or not public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null)
           and (value->>'id'='teacher' or exists(select 1 from public.role_assignments r join public.role_definitions d on d.id=r.role_definition_id
             where r.user_id=p_actor_id and r.branch_id=p_branch_id and r.role_definition_id not like 'legacy%' and 'role.assignment.branch'=any(d.permissions)))));

   return jsonb_build_object('scope',case when is_global then jsonb_build_object('kind','central') else jsonb_build_object('kind','branch','branchId',p_branch_id) end,
     'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from public.branches b
       where (is_global and public.authorization_has_permission(p_actor_id,'branch.read','central',null)) or b.id=p_branch_id),'[]'::jsonb),
     'roles',role_values,'permissions',coalesce((select jsonb_agg(permission) from unnest((select permissions from public.role_definitions where id='central_admin')) permission
       where public.authorization_has_permission(p_actor_id,permission,p_scope_kind,p_branch_id)),'[]'::jsonb));
 elsif p_operation='users' then
   perform public.authorization_assert_actor(p_actor_id,'member.read',p_scope_kind,p_branch_id);
   select * into search_token from public.admin_consume_user_search_token(p_actor_id);
   if not search_token.allowed then raise exception 'SEARCH_RATE_LIMIT' using errcode='P0001'; end if;
   page_no := greatest(1,least(coalesce((p_input->>'page')::integer,1),10000));
   size_no := greatest(1,least(coalesce((p_input->>'pageSize')::integer,20),50));
   q:=lower(trim(coalesce(p_input->>'query','')));
   if length(q)>160 then raise invalid_parameter_value; end if;
   select coalesce(jsonb_agg(to_jsonb(t) order by t.ordinal),'[]'::jsonb) into result from (
     select public.admin_member_json(p.id,p_scope_kind,p_branch_id) as member,
       row_number() over(order by lower(p.display_name),p.id) as ordinal
     from public.profiles p join auth.users u on u.id=p.id join public.user_accounts a on a.user_id=p.id
     where (is_global or p.branch_id=p_branch_id or exists(select 1 from public.branch_memberships m where m.user_id=p.id and m.branch_id=p_branch_id))
       and (q='' or position(q in lower(p.display_name))>0 or position(q in lower(coalesce(p.handle,'')))>0 or position(q in lower(coalesce(u.email,'')))>0)
       and (coalesce(p_input->>'status','')='' or case when a.status='suspended' then 'suspended' when is_global then a.status else coalesce((select m.status from public.branch_memberships m where m.user_id=p.id and m.branch_id=p_branch_id),a.status) end=p_input->>'status')
       and (coalesce(p_input->>'roleId','')='' or exists(select 1 from public.role_assignments r where r.user_id=p.id and r.role_definition_id=p_input->>'roleId' and (is_global or r.branch_id=p_branch_id)))
       and (coalesce(p_input->>'kind','')='' or (p_input->>'kind'='learner' and p.branch_id is not null and (is_global or p.branch_id=p_branch_id))
         or (p_input->>'kind'='staff' and exists(select 1 from public.role_assignments r join public.role_definitions d on d.id=r.role_definition_id where r.user_id=p.id and r.role_definition_id<>'member' and cardinality(d.permissions)>0 and (is_global or r.branch_id=p_branch_id))))
     order by lower(p.display_name),p.id offset ((page_no-1)*size_no) limit size_no+1
   )t;
   return jsonb_build_object('items',coalesce((select jsonb_agg(value->'member' order by ordinality) from jsonb_array_elements(result) with ordinality where ordinality<=size_no),'[]'::jsonb),
     'page',page_no,'pageSize',size_no,'hasMore',jsonb_array_length(result)>size_no);
 elsif p_operation='user' then
   perform public.authorization_assert_actor(p_actor_id,'member.read',p_scope_kind,p_branch_id);
   target:=(p_input->>'userId')::uuid;
   if not exists(select 1 from public.profiles p where p.id=target and (is_global or p.branch_id=p_branch_id or exists(select 1 from public.branch_memberships m where m.user_id=p.id and m.branch_id=p_branch_id))) then raise no_data_found; end if;
   member_value:=public.admin_member_json(target,p_scope_kind,p_branch_id);
   allow_learning:=public.authorization_has_permission(p_actor_id,'learning.read',p_scope_kind,p_branch_id);
   allow_grading:=public.authorization_has_permission(p_actor_id,'grading.read',p_scope_kind,p_branch_id);
   allow_history:=public.authorization_has_permission(p_actor_id,'audit.read',p_scope_kind,p_branch_id);
   result:=member_value || jsonb_build_object('actions',jsonb_build_object(
     'editIdentity',is_global and public.authorization_has_permission(p_actor_id,'member.manage','central',null),
     'transfer',is_global and public.authorization_has_permission(p_actor_id,'member.manage','central',null),
     'suspendAccount',is_global and public.authorization_has_permission(p_actor_id,'member.manage','central',null),
     'manageMembership',public.authorization_has_permission(p_actor_id,'membership.manage',p_scope_kind,p_branch_id),
     'assignRole',public.authorization_has_permission(p_actor_id,case when is_global then 'role.assignment.global' else 'role.assignment.branch' end,p_scope_kind,p_branch_id),
     'readLearning',allow_learning,'readSubmissions',allow_grading,'readHistory',allow_history),
     'effectivePermissions',coalesce((select jsonb_agg(jsonb_build_object('scope',s.scope,'permissions',s.permissions)) from (
       select case when r.branch_id is null then jsonb_build_object('kind','central') else jsonb_build_object('kind','branch','branchId',r.branch_id) end as scope,
       array_agg(distinct perm order by perm) as permissions
       from public.role_assignments r join public.role_definitions d on d.id=r.role_definition_id
       cross join lateral unnest(d.permissions) perm
       where r.user_id=target and (is_global or r.branch_id=p_branch_id)
       and public.authorization_has_permission(target,perm,case when r.branch_id is null then 'central' else 'branch' end,r.branch_id)
       group by r.branch_id)s),'[]'::jsonb));
   if allow_learning then
     result:=result || jsonb_build_object('learning',coalesce((select jsonb_agg(v order by v->>'courseId') from (
       select jsonb_build_object('courseId',e.course_id,'courseVersionId',e.course_version_id,'title',e.course_id,'status',e.status,
         'completedLessons',(select count(*) from public.lesson_progress lp where lp.user_id=target and lp.course_version_id=e.course_version_id and lp.status='completed'),
         'totalLessons',(select count(*) from public.course_version_items vi where vi.version_id=e.course_version_id and vi.kind='lesson'),
         'examAveragePercent',(select round(avg(g.percent),2) from public.exam_grades g where g.user_id=target and g.course_version_id=e.course_version_id),
         'branchId',case when is_global or e.branch_id=p_branch_id then e.branch_id else null end) v
       from public.enrollments e where e.user_id=target and (is_global or (e.branch_scope_known and e.branch_id=p_branch_id)
         or exists(select 1 from public.profiles p where p.id=target and p.branch_id=p_branch_id))
     )summary),'[]'::jsonb));
   end if;
   if allow_grading then
     result:=result || jsonb_build_object('submissions',coalesce((select jsonb_agg(v order by v->>'submittedAt' desc) from (
       select jsonb_build_object('id',s.id,'courseVersionId',s.course_version_id,'itemId',s.item_id,'status',s.status,'submittedAt',s.submitted_at,
         'branchId',s.branch_id,'percent',case when g.max_points>0 then round(g.total_points/g.max_points*100,2) else null end) v
       from public.assignment_submissions s left join public.grades g on g.submission_id=s.id
       where s.user_id=target and (is_global or (s.branch_scope_known and s.branch_id=p_branch_id))
       order by s.submitted_at desc limit 100
     )submissions),'[]'::jsonb));
   end if;
   if allow_grading then
     result:=result || jsonb_build_object('examResults',coalesce((select jsonb_agg(v order by v->>'submittedAt' desc) from (
       select jsonb_build_object('id',e.id,'courseVersionId',e.course_version_id,'itemId',e.item_id,'status',e.status,'submittedAt',e.submitted_at,'branchId',e.branch_id,'percent',e.percent) v
       from public.exam_attempts e where e.user_id=target and (is_global or (e.branch_scope_known and e.branch_id=p_branch_id))
       order by e.submitted_at desc nulls last,e.id limit 100
     )attempts),'[]'::jsonb));
   end if;
   if allow_history then
     result:=result || jsonb_build_object('history',coalesce((select jsonb_agg(v order by v->>'at' desc) from (
       select jsonb_build_object('id',a.id::text,'action',a.action,'actorId',a.actor_id,'targetType',a.target_type,'targetId',a.target_id,'at',a.at) v
       from public.audit_log a where a.target_type='user' and a.target_id=target::text and (is_global or a.branch_id=p_branch_id)
       order by a.at desc,a.id desc limit 100
     )history),'[]'::jsonb));
   end if;
   return result;
 elsif p_operation='invitations' then
   perform public.authorization_assert_actor(p_actor_id,'membership.manage',p_scope_kind,p_branch_id);
   select coalesce(jsonb_agg(public.admin_invitation_json(i.id) order by i.created_at desc),'[]'::jsonb) into result
     from (select * from public.admin_invitations where is_global or branch_id=p_branch_id order by created_at desc limit 100)i;
   return result;
 elsif p_operation='audit' then
   perform public.authorization_assert_actor(p_actor_id,'audit.read',p_scope_kind,p_branch_id);
   page_no:=greatest(1,least(coalesce((p_input->>'page')::integer,1),10000));
   return coalesce((select jsonb_agg(v order by v->>'at' desc) from (
     select jsonb_build_object('id',a.id::text,'action',a.action,'actorId',a.actor_id,'targetType',a.target_type,'targetId',a.target_id,'at',a.at) v
     from public.audit_log a where (is_global or a.branch_id=p_branch_id)
       and (coalesce(p_input->>'actor','')='' or a.actor_id=(p_input->>'actor')::uuid)
       and (coalesce(p_input->>'action','')='' or position(lower(p_input->>'action') in lower(a.action))>0)
       and (coalesce(p_input->>'target','')='' or position(lower(p_input->>'target') in lower(a.target_id))>0 or position(lower(p_input->>'target') in lower(a.target_type))>0)
     order by a.at desc,a.id desc offset ((page_no-1)*50) limit 50)t),'[]'::jsonb);
 elsif p_operation='branches' then
   perform public.authorization_assert_actor(p_actor_id,'branch.read',p_scope_kind,p_branch_id);
   return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'city',b.city,'createdAt',b.created_at) order by b.name)
     from public.branches b where is_global or b.id=p_branch_id),'[]'::jsonb);
 elsif p_operation='reports' then
   perform public.authorization_assert_actor(p_actor_id,case when is_global then 'report.global.read' else 'report.branch.read' end,p_scope_kind,p_branch_id);
   return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,
     'enrollments',(select count(*) from public.enrollments e where e.branch_scope_known and e.branch_id=b.id),
     'completedEnrollments',(select count(*) from public.enrollments e where e.branch_scope_known and e.branch_id=b.id and e.status='completed'),
     'submissions',(select count(*) from public.assignment_submissions s where s.branch_scope_known and s.branch_id=b.id),
     'pendingGrading',(select count(*) from public.assignment_submissions s where s.branch_scope_known and s.branch_id=b.id and s.status in ('submitted','in_review')),
     'averagePercent',(select round(avg(case when g.max_points>0 then g.total_points/g.max_points*100 end),2) from public.grades g join public.assignment_submissions s on s.id=g.submission_id where s.branch_scope_known and s.branch_id=b.id),
     'activeLearners30d',(select count(distinct e.user_id) from public.analytics_events e where e.branch_scope_known and e.branch_id=b.id and e.at>=now()-interval '30 days')
   ) order by b.name) from public.branches b where is_global or b.id=p_branch_id),'[]'::jsonb);
 elsif p_operation='dashboard' then
   result:='{}'::jsonb;
   if public.authorization_has_permission(p_actor_id,'member.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('members',(select count(*) from public.profiles p where is_global or p.branch_id=p_branch_id or exists(select 1 from public.branch_memberships m where m.user_id=p.id and m.branch_id=p_branch_id)));
   end if;
   if public.authorization_has_permission(p_actor_id,'branch.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('schools',(select count(*) from public.branches b where is_global or b.id=p_branch_id));
   end if;
   if public.authorization_has_permission(p_actor_id,'learning.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('enrollments',(select count(*) from public.enrollments e where is_global or (e.branch_scope_known and e.branch_id=p_branch_id)));
   end if;
   if public.authorization_has_permission(p_actor_id,'grading.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('pendingGrading',(select count(*) from public.assignment_submissions s where s.status in ('submitted','in_review') and (is_global or (s.branch_scope_known and s.branch_id=p_branch_id))));
   end if;
   if public.authorization_has_permission(p_actor_id,'audit.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('recentActivity',coalesce((select jsonb_agg(v order by v->>'at' desc) from (
       select jsonb_build_object('id',a.id::text,'action',a.action,'actorId',a.actor_id,'targetType',a.target_type,'targetId',a.target_id,'at',a.at) v
       from public.audit_log a where is_global or a.branch_id=p_branch_id order by a.at desc,a.id desc limit 10)t),'[]'::jsonb));
   end if;
   return result;
 else raise invalid_parameter_value;
 end if;
end;
$$;

create or replace function public.admin_management_write(
 p_actor_id uuid,p_scope_kind text,p_branch_id text,p_operation text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 target uuid; branch_target text; role_target text; role_row public.role_definitions%rowtype;
 before_value jsonb; result jsonb; state text; central_manager boolean; invite public.admin_invitations%rowtype;
 perms text[]; scope_kind text; new_role_id text; current_primary text; actor_role_count integer;
begin
 perform public.authorization_assert_actor(p_actor_id,'admin.access',p_scope_kind,p_branch_id);
 -- Serialize privilege and membership transitions, including concurrent last-admin removals.
 perform pg_advisory_xact_lock(hashtextextended('vfuture.authorization.mutations',0));
 central_manager:=public.authorization_has_permission(p_actor_id,'role.assignment.global','central',null);
 if p_operation in ('branch.create','branch.update') then
   if p_scope_kind<>'central' then raise insufficient_privilege; end if;
   perform public.authorization_assert_actor(p_actor_id,'branch.manage','central',null);
   branch_target:=p_input->>'branchId';
   if branch_target is null or branch_target !~ '^[a-z0-9][a-z0-9-]{0,63}$' then raise invalid_parameter_value; end if;
   if (p_operation='branch.create' or p_input ? 'name') and (length(trim(coalesce(p_input->>'name','')))=0 or length(p_input->>'name')>160) then raise invalid_parameter_value; end if;
   if p_operation='branch.create' then
     insert into public.branches(id,name,city) values(branch_target,trim(p_input->>'name'),nullif(trim(p_input->>'city'),''));
   else
     select to_jsonb(b) into before_value from public.branches b where b.id=branch_target for update;
     if not found then raise no_data_found; end if;
     update public.branches set name=case when p_input ? 'name' then trim(p_input->>'name') else name end,city=case when p_input ? 'city' then nullif(trim(p_input->>'city'),'') else city end where id=branch_target;
   end if;
   select jsonb_build_object('id',b.id,'name',b.name,'city',b.city,'createdAt',b.created_at) into result from public.branches b where b.id=branch_target;
   insert into public.audit_log(actor_id,action,target_type,target_id,before,after,branch_id) values(p_actor_id,p_operation,'branch',branch_target,before_value,result,branch_target);
   return result;
 elsif p_operation like 'user.%' then
   target:=(p_input->>'userId')::uuid;
   select branch_id into current_primary from public.profiles where id=target for update;
   if not found then raise no_data_found; end if;
   if p_scope_kind='branch' and current_primary is distinct from p_branch_id and not exists(select 1 from public.branch_memberships where user_id=target and branch_id=p_branch_id) then raise no_data_found; end if;
   before_value:=public.admin_member_json(target,p_scope_kind,p_branch_id);
   if p_operation='user.identity' then
     if p_scope_kind<>'central' then raise insufficient_privilege; end if;
     perform public.authorization_assert_actor(p_actor_id,'member.manage','central',null);
     if length(trim(coalesce(p_input->>'displayName','')))<1 or length(p_input->>'displayName')>160 then raise invalid_parameter_value; end if;
     update public.profiles set display_name=trim(p_input->>'displayName'),updated_at=now() where id=target;
   elsif p_operation='user.transfer' then
     if p_scope_kind<>'central' then raise insufficient_privilege; end if;
     perform public.authorization_assert_actor(p_actor_id,'member.manage','central',null);
     branch_target:=p_input->>'branchId';
     if branch_target is not null and not exists(select 1 from public.branches where id=branch_target) then raise invalid_parameter_value; end if;
     update public.profiles set branch_id=branch_target,updated_at=now() where id=target;
     if branch_target is not null then
       insert into public.branch_memberships(user_id,branch_id,status,created_by,updated_by) values(target,branch_target,'active',p_actor_id,p_actor_id)
       on conflict(user_id,branch_id) do update set status='active',updated_by=p_actor_id,updated_at=now();
     end if;
     -- A former learner membership ceases directory authority; historic records keep their scope.
     if current_primary is not null and current_primary is distinct from branch_target and not exists(select 1 from public.role_assignments where user_id=target and branch_id=current_primary) then
       delete from public.branch_memberships where user_id=target and branch_id=current_primary;
     end if;
   elsif p_operation='user.account-status' then
     if p_scope_kind<>'central' then raise insufficient_privilege; end if;
     perform public.authorization_assert_actor(p_actor_id,'member.manage','central',null);
     state:=p_input->>'status'; if state not in ('active','suspended') then raise invalid_parameter_value; end if;
     if state='suspended' and exists(select 1 from public.role_assignments where user_id=target and role_definition_id='central_admin' and branch_id is null)
       and not exists(select 1 from public.role_assignments r join public.user_accounts a on a.user_id=r.user_id where r.role_definition_id='central_admin' and r.branch_id is null and a.status='active' and r.user_id<>target)
       then raise exception 'LAST_ADMIN' using errcode='23514'; end if;
     update public.user_accounts set status=state,suspended_at=case when state='suspended' then now() else null end,
       suspended_by=case when state='suspended' then p_actor_id else null end,updated_at=now() where user_id=target;
   elsif p_operation='user.membership-status' then
     branch_target:=p_input->>'branchId';state:=p_input->>'status';
     if state not in ('active','suspended') or branch_target is null then raise invalid_parameter_value; end if;
     if p_scope_kind='branch' and branch_target<>p_branch_id then raise insufficient_privilege; end if;
     perform public.authorization_assert_actor(p_actor_id,'membership.manage','branch',branch_target);
     update public.branch_memberships set status=state,updated_by=p_actor_id,updated_at=now() where user_id=target and branch_id=branch_target;
     if not found then raise no_data_found; end if;
   elsif p_operation='user.role' then
     branch_target:=p_input->>'branchId';role_target:=p_input->>'roleId';
     select * into role_row from public.role_definitions where id=role_target for share;
     if not found then raise no_data_found; end if;
     if (branch_target is null)<>(role_row.scope_kind='central') then raise invalid_parameter_value; end if;
     if p_scope_kind='branch' and branch_target is distinct from p_branch_id then raise insufficient_privilege; end if;
     if branch_target is null then
       perform public.authorization_assert_actor(p_actor_id,'role.assignment.global','central',null);
     else
       perform public.authorization_assert_actor(p_actor_id,'role.assignment.branch','branch',branch_target);
       if not central_manager and (not role_row.school_grantable or role_row.id='school_admin' or target=p_actor_id) then raise insufficient_privilege; end if;
       if not exists(select 1 from public.branch_memberships where user_id=target and branch_id=branch_target) then raise invalid_parameter_value; end if;
       if not central_manager and (p_input->>'enabled')::boolean and role_target<>'teacher'
         and not exists(select 1 from public.role_assignments r join public.role_definitions d on d.id=r.role_definition_id
           where r.user_id=p_actor_id and r.branch_id=branch_target and r.role_definition_id not like 'legacy%'
             and 'role.assignment.branch'=any(d.permissions)) then raise insufficient_privilege; end if;
     end if;
     if (p_input->>'enabled')::boolean then
       if target=p_actor_id and role_target='central_admin' and not exists(select 1 from public.role_assignments where user_id=p_actor_id and role_definition_id='central_admin' and branch_id is null) then raise insufficient_privilege; end if;
       if central_manager and exists(select 1 from unnest(role_row.permissions) permission
         where not public.authorization_has_permission(p_actor_id,permission,case when branch_target is null then 'central' else 'branch' end,branch_target)) then raise insufficient_privilege; end if;
       if role_target like 'legacy_%' or role_target like 'legacy-%' then raise invalid_parameter_value; end if;
       insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by) values(target,role_target,branch_target,p_actor_id)
         on conflict(user_id,role_definition_id,branch_id) do nothing;
     else
       if role_target='central_admin' and branch_target is null and not exists(select 1 from public.role_assignments r join public.user_accounts a on a.user_id=r.user_id
         where r.role_definition_id='central_admin' and r.branch_id is null and a.status='active' and r.user_id<>target)
         then raise exception 'LAST_ADMIN' using errcode='23514'; end if;
       delete from public.role_assignments where user_id=target and role_definition_id=role_target and branch_id is not distinct from branch_target;
     end if;
   else raise invalid_parameter_value; end if;
   result:=public.admin_member_json(target,p_scope_kind,p_branch_id);
   insert into public.audit_log(actor_id,action,target_type,target_id,before,after,branch_id)
     values(p_actor_id,p_operation,'user',target::text,before_value,result,case when p_scope_kind='branch' then p_branch_id else null end);
   if p_scope_kind='central' and branch_target is not null then
     insert into public.audit_log(actor_id,action,target_type,target_id,after,branch_id)
       values(p_actor_id,p_operation,'user',target::text,jsonb_build_object('userId',target,'branchId',branch_target,'roleId',role_target,'status',state),branch_target);
   end if;
   return result;
 elsif p_operation in ('role.create','role.update') then
   if p_scope_kind<>'central' then raise insufficient_privilege; end if;
   perform public.authorization_assert_actor(p_actor_id,'role.definition.manage','central',null);
   scope_kind:=p_input->>'scopeKind';
   select coalesce(array_agg(value),array[]::text[]) into perms from jsonb_array_elements_text(p_input->'permissions');
   if scope_kind not in ('central','branch') or length(trim(coalesce(p_input->>'name','')))=0 or length(p_input->>'name')>100
     or not (perms <@ (select permissions from public.role_definitions where id='central_admin')) then raise invalid_parameter_value; end if;
   if scope_kind='branch' and perms && array['role.definition.manage','role.assignment.global','branch.manage','content.review','content.publish','report.global.read','course.publish','course.delete','bank.publish','resource.publish','opportunity.publish','user.manage.global','analytics.global.read'] then raise invalid_parameter_value; end if;
   if scope_kind='central' and coalesce((p_input->>'grantableBySchool')::boolean,false) then raise invalid_parameter_value; end if;
   if exists(select 1 from unnest(perms) permission where not public.authorization_has_permission(p_actor_id,permission,'central',null)) then raise insufficient_privilege; end if;
   if p_operation='role.create' then
     new_role_id:='custom-'||gen_random_uuid()::text;
     insert into public.role_definitions(id,name,description,scope_kind,permissions,built_in,school_grantable,created_by,updated_by)
       values(new_role_id,trim(p_input->>'name'),coalesce(p_input->>'description',''),scope_kind,perms,false,coalesce((p_input->>'grantableBySchool')::boolean,false),p_actor_id,p_actor_id);
   else
     new_role_id:=p_input->>'roleId';
     select * into role_row from public.role_definitions where id=new_role_id for update;
     if not found then raise no_data_found; end if;
     if role_row.built_in or role_row.id like 'legacy%' then raise insufficient_privilege; end if;
     if role_row.scope_kind<>scope_kind then raise invalid_parameter_value; end if;
     if p_input->>'version' is null or role_row.version<>(p_input->>'version')::integer then raise serialization_failure; end if;
     before_value:=public.admin_role_json(new_role_id,'central',null);
     update public.role_definitions set name=trim(p_input->>'name'),description=coalesce(p_input->>'description',''),permissions=perms,
       school_grantable=coalesce((p_input->>'grantableBySchool')::boolean,false),version=version+1,updated_at=now(),updated_by=p_actor_id where id=new_role_id;
   end if;
   result:=public.admin_role_json(new_role_id,'central',null);
   insert into public.audit_log(actor_id,action,target_type,target_id,before,after) values(p_actor_id,p_operation,'role',new_role_id,before_value,result);
   return result;
 elsif p_operation='invitation.create' then
   branch_target:=p_input->>'branchId';role_target:=p_input->>'roleId';
   if branch_target is null or (p_scope_kind='branch' and branch_target<>p_branch_id) then raise insufficient_privilege; end if;
   perform public.authorization_assert_actor(p_actor_id,'membership.manage','branch',branch_target);
   if role_target is not null then
     select * into role_row from public.role_definitions where id=role_target;
     if not found or role_row.scope_kind<>'branch' or (not central_manager and (not role_row.school_grantable or role_target='school_admin')) or role_target like 'legacy%' then raise insufficient_privilege; end if;
     perform public.authorization_assert_actor(p_actor_id,'role.assignment.branch','branch',branch_target);
     if central_manager and exists(select 1 from unnest(role_row.permissions) permission where not public.authorization_has_permission(p_actor_id,permission,'branch',branch_target)) then raise insufficient_privilege; end if;
   end if;
   if coalesce(p_input->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise invalid_parameter_value; end if;
   insert into public.admin_invitations(email,branch_id,role_definition_id,role_version,token_hash,created_by)
     values(lower(trim(p_input->>'email')),branch_target,role_target,role_row.version,p_input->>'tokenHash',p_actor_id) returning * into invite;
   insert into public.audit_log(actor_id,action,target_type,target_id,after,branch_id)
     values(p_actor_id,p_operation,'invitation',invite.id::text,jsonb_build_object('branchId',branch_target,'roleId',role_target),branch_target);
   return public.admin_invitation_json(invite.id);
 elsif p_operation='invitation.revoke' then
   select * into invite from public.admin_invitations where id=(p_input->>'invitationId')::uuid for update;
   if not found or (p_scope_kind='branch' and invite.branch_id<>p_branch_id) then raise no_data_found; end if;
   perform public.authorization_assert_actor(p_actor_id,'membership.manage','branch',invite.branch_id);
   if invite.accepted_at is not null then raise invalid_parameter_value; end if;
   update public.admin_invitations set revoked_at=coalesce(revoked_at,now()) where id=invite.id;
   insert into public.audit_log(actor_id,action,target_type,target_id,branch_id) values(p_actor_id,p_operation,'invitation',invite.id::text,invite.branch_id);
   return jsonb_build_object('revoked',true);
 else raise invalid_parameter_value;
 end if;
end;
$$;

create or replace function public.admin_accept_invitation(p_user_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare invite public.admin_invitations%rowtype; user_email text; primary_branch text; role_row public.role_definitions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('vfuture.authorization.mutations',0));
 select * into invite from public.admin_invitations where token_hash=p_token_hash for update;
 if not found or invite.accepted_at is not null or invite.revoked_at is not null or invite.expires_at<=now() then raise no_data_found; end if;
 select lower(u.email),p.branch_id into user_email,primary_branch from auth.users u join public.profiles p on p.id=u.id
   join public.user_accounts a on a.user_id=p.id and a.status='active' where u.id=p_user_id for update of p;
 if not found or user_email is distinct from invite.email then raise insufficient_privilege; end if;
 perform public.authorization_assert_actor(invite.created_by,'membership.manage','branch',invite.branch_id);
 if invite.role_definition_id is null or invite.role_definition_id='member' then
   if primary_branch is not null and primary_branch<>invite.branch_id then raise invalid_parameter_value; end if;
 else
   select * into role_row from public.role_definitions where id=invite.role_definition_id for share;
   if not found or role_row.scope_kind<>'branch' or role_row.version is distinct from invite.role_version then raise insufficient_privilege; end if;
   perform public.authorization_assert_actor(invite.created_by,'role.assignment.branch','branch',invite.branch_id);
   if public.authorization_has_permission(invite.created_by,'role.assignment.global','central',null) and exists(select 1 from unnest(role_row.permissions) permission where not public.authorization_has_permission(invite.created_by,permission,'branch',invite.branch_id)) then raise insufficient_privilege; end if;
   if not public.authorization_has_permission(invite.created_by,'role.assignment.global','central',null)
     and (not role_row.school_grantable or role_row.id='school_admin' or p_user_id=invite.created_by) then raise insufficient_privilege; end if;
 end if;
 insert into public.branch_memberships(user_id,branch_id,status,created_by,updated_by) values(p_user_id,invite.branch_id,'active',invite.created_by,invite.created_by)
   on conflict(user_id,branch_id) do update set status='active',updated_at=now(),updated_by=invite.created_by;
 if invite.role_definition_id is null or invite.role_definition_id='member' then
   update public.profiles set branch_id=invite.branch_id,updated_at=now() where id=p_user_id;
 else
   insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by) values(p_user_id,invite.role_definition_id,invite.branch_id,invite.created_by)
     on conflict(user_id,role_definition_id,branch_id) do nothing;
 end if;
 update public.admin_invitations set accepted_at=now(),accepted_by=p_user_id where id=invite.id;
 insert into public.audit_log(actor_id,action,target_type,target_id,after,branch_id)
   values(p_user_id,'invitation.accepted','user',p_user_id::text,jsonb_build_object('invitationId',invite.id,'branchId',invite.branch_id,'roleId',invite.role_definition_id),invite.branch_id);
 return jsonb_build_object('accepted',true,'branchId',invite.branch_id);
end;
$$;

revoke all on function public.admin_member_json(uuid,text,text), public.admin_role_json(text,text,text),public.admin_invitation_json(uuid),
 public.admin_management_read(uuid,text,text,text,jsonb),public.admin_management_write(uuid,text,text,text,jsonb),public.admin_accept_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_management_read(uuid,text,text,text,jsonb),public.admin_management_write(uuid,text,text,text,jsonb),public.admin_accept_invitation(uuid,text) to service_role;

-- Legacy reporting interfaces now retain historical school ownership.
create or replace view public.analytics_branch_daily
with (security_invoker = true)
as
with days as (
  select profile.branch_id, (event.at at time zone 'UTC')::date as day
  from public.analytics_events event
  join lateral (select event.branch_id where event.branch_scope_known) profile on true
  where profile.branch_id is not null
    and (event.at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date
  from public.enrollments enrollment
  join lateral (select enrollment.branch_id where enrollment.branch_scope_known) profile on true
  where profile.branch_id is not null
    and (enrollment.enrolled_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date
  from public.lesson_progress progress
  join public.enrollments profile on profile.user_id = progress.user_id and profile.course_version_id = progress.course_version_id and profile.branch_scope_known
  where profile.branch_id is not null
    and coalesce(progress.completed_at, progress.started_at) is not null
    and (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
  from public.quiz_attempts attempt
  join public.enrollments profile on profile.user_id = attempt.user_id and profile.course_version_id = attempt.course_version_id and profile.branch_scope_known
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
  from public.exam_attempts attempt
  join lateral (select attempt.branch_id where attempt.branch_scope_known) profile on true
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select profile.branch_id, (submission.submitted_at at time zone 'UTC')::date
  from public.assignment_submissions submission
  join lateral (select submission.branch_id where submission.branch_scope_known) profile on true
  where profile.branch_id is not null
    and (submission.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  union
  select branch.id, current_date from public.branches branch
),
user_activity as (
  select distinct profile.branch_id, event.user_id, (event.at at time zone 'UTC')::date as day
  from public.analytics_events event
  join lateral (select event.branch_id where event.branch_scope_known) profile on true
  where profile.branch_id is not null
    and (event.at at time zone 'UTC')::date between current_date - 118 and current_date
),
daily_activity as (
  select branch_id, day, count(*)::bigint as active_learners
  from user_activity
  where day between current_date - 89 and current_date
  group by branch_id, day
),
active_windows as (
  select days.branch_id, days.day,
    count(distinct activity.user_id) filter (where activity.day >= days.day - 6)::bigint as active_learners_7d,
    count(distinct activity.user_id)::bigint as active_learners_30d
  from days
  left join user_activity activity
    on activity.branch_id = days.branch_id
   and activity.day between days.day - 29 and days.day
  group by days.branch_id, days.day
),
daily_enrollments as (
  select profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date as day,
    count(*)::bigint as enrollments
  from public.enrollments enrollment
  join lateral (select enrollment.branch_id where enrollment.branch_scope_known) profile on true
  where profile.branch_id is not null
    and (enrollment.enrolled_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (enrollment.enrolled_at at time zone 'UTC')::date
),
daily_lessons as (
  select profile.branch_id,
    (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date as day,
    count(*)::bigint as lesson_progress_total,
    count(*) filter (where progress.status = 'completed')::bigint as lesson_completions
  from public.lesson_progress progress
  join public.enrollments profile on profile.user_id = progress.user_id and profile.course_version_id = progress.course_version_id and profile.branch_scope_known
  where profile.branch_id is not null
    and coalesce(progress.completed_at, progress.started_at) is not null
    and (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (coalesce(progress.completed_at, progress.started_at) at time zone 'UTC')::date
),
daily_quizzes as (
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as quiz_attempts
  from public.quiz_attempts attempt
  join public.enrollments profile on profile.user_id = attempt.user_id and profile.course_version_id = attempt.course_version_id and profile.branch_scope_known
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
),
daily_exams as (
  select profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as exam_attempts
  from public.exam_attempts attempt
  join lateral (select attempt.branch_id where attempt.branch_scope_known) profile on true
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, (attempt.submitted_at at time zone 'UTC')::date
)
select days.branch_id,
  days.day,
  coalesce(activity.active_learners, 0)::bigint as active_learners,
  coalesce(active.active_learners_7d, 0)::bigint as active_learners_7d,
  coalesce(active.active_learners_30d, 0)::bigint as active_learners_30d,
  coalesce(enrollment.enrollments, 0)::bigint as enrollments,
  coalesce(lesson.lesson_progress_total, 0)::bigint as lesson_progress_total,
  coalesce(lesson.lesson_completions, 0)::bigint as lesson_completions,
  case when coalesce(lesson.lesson_progress_total, 0) = 0 then 0
    else round(100.0 * lesson.lesson_completions / lesson.lesson_progress_total, 2)
  end as lesson_completion_rate,
  coalesce(quiz.quiz_attempts, 0)::bigint as quiz_attempts,
  coalesce(exam.exam_attempts, 0)::bigint as exam_attempts
from days
left join daily_activity activity using (branch_id, day)
left join active_windows active using (branch_id, day)
left join daily_enrollments enrollment using (branch_id, day)
left join daily_lessons lesson using (branch_id, day)
left join daily_quizzes quiz using (branch_id, day)
left join daily_exams exam using (branch_id, day);

create or replace view public.analytics_branch_course_daily
with (security_invoker = true)
as
with quiz as (
  select profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as quiz_attempts,
    sum(attempt.percent) as score_sum,
    count(attempt.percent)::bigint as score_count
  from public.quiz_attempts attempt
  join public.enrollments profile on profile.user_id = attempt.user_id and profile.course_version_id = attempt.course_version_id and profile.branch_scope_known
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date
),
exam as (
  select profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date as day,
    count(*)::bigint as exam_attempts,
    sum(attempt.percent) as score_sum,
    count(attempt.percent)::bigint as score_count
  from public.exam_attempts attempt
  join lateral (select attempt.branch_id where attempt.branch_scope_known) profile on true
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id is not null
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date between current_date - 89 and current_date
  group by profile.branch_id, version.course_id, (attempt.submitted_at at time zone 'UTC')::date
),
keys as (
  select branch_id, course_id, day from quiz
  union
  select branch_id, course_id, day from exam
)
select keys.branch_id,
  keys.course_id,
  keys.day,
  coalesce(quiz.quiz_attempts, 0)::bigint as quiz_attempts,
  coalesce(exam.exam_attempts, 0)::bigint as exam_attempts,
  coalesce(quiz.score_sum, 0) + coalesce(exam.score_sum, 0) as score_sum,
  (coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0))::bigint as score_count,
  case when coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0) = 0 then null
    else round(
      (coalesce(quiz.score_sum, 0) + coalesce(exam.score_sum, 0))
      / (coalesce(quiz.score_count, 0) + coalesce(exam.score_count, 0)),
      2
    )
  end as average_percent
from keys
left join quiz using (branch_id, course_id, day)
left join exam using (branch_id, course_id, day);


-- Count one actionable assignment per learner and exact assignment locator.
-- Older attempts remain immutable history and must not inflate staff workload.
create or replace function public.analytics_pending_grading(p_branch_id text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with latest_assignment as (
    select distinct on (
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id
    )
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id,
      submission.status,
      grade.released
    from public.assignment_submissions submission
    join lateral (select submission.branch_id where submission.branch_scope_known) profile on true
    left join public.grades grade on grade.submission_id = submission.id
    where profile.branch_id = p_branch_id
    order by
      submission.user_id,
      submission.course_version_id,
      submission.item_id,
      submission.block_id,
      submission.attempt_no desc,
      submission.id desc
  )
  select (
    (
      select count(*)
      from latest_assignment
      where (
        status in ('submitted', 'in_review')
        or (status in ('approved', 'changes_requested') and released is not true)
      ) and not exists (
        select 1
        from public.assignment_submissions approved_submission
        join public.grades approved_grade on approved_grade.submission_id = approved_submission.id
        where approved_submission.user_id = latest_assignment.user_id
          and approved_submission.course_version_id = latest_assignment.course_version_id
          and approved_submission.item_id = latest_assignment.item_id
          and approved_submission.block_id is not distinct from latest_assignment.block_id
          and approved_grade.released = true
          and approved_grade.decision = 'approved'
      )
    ) + (
      select count(*)
      from public.exam_attempts pending_exam
      join lateral (select pending_exam.branch_id where pending_exam.branch_scope_known) profile on true
      where profile.branch_id = p_branch_id
        and pending_exam.status = 'pending_manual'
    )
  )::bigint
$$;

revoke all on function public.analytics_pending_grading(text) from public;
revoke all on function public.analytics_pending_grading(text) from anon, authenticated;
grant execute on function public.analytics_pending_grading(text) to service_role;

create or replace function public.top_failed_questions(
  p_branch_id text,
  p_from date,
  p_to date
)
returns table (
  course_id text,
  question_id text,
  failures bigint,
  attempts bigint,
  failure_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select version.course_id,
    answer.question_id,
    count(*) filter (where answer.result ->> 'status' = 'incorrect') as failures,
    count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')) as attempts,
    round(
      100.0 * count(*) filter (where answer.result ->> 'status' = 'incorrect')
      / nullif(count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')), 0),
      2
    ) as failure_rate
  from public.exam_answers answer
  join public.exam_attempts attempt on attempt.id = answer.attempt_id and attempt.user_id = answer.user_id
  join lateral (select attempt.branch_id where attempt.branch_scope_known) profile on true
  join public.course_versions version on version.id = attempt.course_version_id
  where profile.branch_id = p_branch_id
    and attempt.submitted_at is not null
    and (attempt.submitted_at at time zone 'UTC')::date
      between greatest(p_from, current_date - 89) and least(p_to, current_date)
  group by version.course_id, answer.question_id
  having count(*) filter (where answer.result ->> 'status' in ('correct', 'partial', 'incorrect')) >= 5
    and count(*) filter (where answer.result ->> 'status' = 'incorrect') > 0
  order by failures desc, failure_rate desc, answer.question_id
  limit 10
$$;


-- Existing authenticated tokens cannot read protected learner rows after account suspension.
-- This restrictive policy never grants a read that the original ownership/audience policy denied.
create schema if not exists private;
create or replace function private.admin_session_active()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.user_accounts a where a.user_id=(select auth.uid()) and a.status='active');
$$;
revoke all on function private.admin_session_active() from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on function private.admin_session_active() to authenticated,service_role;
do $$
declare protected_table text;
begin
  foreach protected_table in array array['enrollments','lesson_progress','activity_state','quiz_attempts','assignment_submissions','submission_files','course_completions','course_version_outline','course_version_item_renders'] loop
    execute format('create policy active_account_required on public.%I as restrictive for all to authenticated using ((select private.admin_session_active())) with check ((select private.admin_session_active()))',protected_table);
  end loop;
end;
$$;
