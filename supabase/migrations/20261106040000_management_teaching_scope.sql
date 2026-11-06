-- Shared report predicate: operation capability and exact historical scope are both required.
create or replace function public.teaching_report_scope(p_actor_id uuid,p_course_id text,p_branch_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.teaching_has_course_permission(p_actor_id,'report.branch.read',p_course_id,p_branch_id)
     or public.teaching_has_course_permission(p_actor_id,'analytics.branch.read',p_course_id,p_branch_id)
     or public.teaching_has_course_permission(p_actor_id,'report.global.read',p_course_id,p_branch_id)
     or public.teaching_has_course_permission(p_actor_id,'analytics.global.read',p_course_id,p_branch_id)
$$;
revoke all on function public.teaching_report_scope(uuid,text,text) from public,anon,authenticated;
grant execute on function public.teaching_report_scope(uuid,text,text) to service_role;

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
         'examAveragePercent',(select round(avg(scoped.score),2) from (
           select case g.policy when 'best' then max(a.percent) when 'first' then (array_agg(a.percent order by a.attempt_no))[1]
             when 'latest' then (array_agg(a.percent order by a.attempt_no desc))[1] when 'average' then round(avg(a.percent),2) end as score
           from public.exam_grades g join public.exam_attempts a on a.user_id=g.user_id and a.course_version_id=g.course_version_id and a.item_id=g.item_id
           where g.user_id=target and g.course_version_id=e.course_version_id and a.status='graded' and a.percent is not null
             and a.branch_scope_known=e.branch_scope_known and a.branch_id is not distinct from e.branch_id
             and public.teaching_has_course_permission(p_actor_id,'learning.read',e.course_id,case when a.branch_scope_known then a.branch_id else null end)
           group by g.item_id,g.policy
         ) scoped),
         'branchId',case when is_global or e.branch_id=p_branch_id then e.branch_id else null end) v
       from public.enrollments e where e.user_id=target and (is_global or (e.branch_scope_known and e.branch_id=p_branch_id))
         and public.teaching_has_course_permission(p_actor_id,'learning.read',e.course_id,case when e.branch_scope_known then e.branch_id else null end)
     )summary),'[]'::jsonb));
   end if;
   if allow_grading then
     result:=result || jsonb_build_object('submissions',coalesce((select jsonb_agg(v order by v->>'submittedAt' desc) from (
       select jsonb_build_object('id',s.id,'courseVersionId',s.course_version_id,'itemId',s.item_id,'status',s.status,'submittedAt',s.submitted_at,
         'branchId',s.branch_id,'percent',case when g.max_points>0 then round(g.total_points/g.max_points*100,2) else null end) v
       from public.assignment_submissions s left join public.grades g on g.submission_id=s.id
       where s.user_id=target and (is_global or (s.branch_scope_known and s.branch_id=p_branch_id)) and public.teaching_has_course_permission(p_actor_id,'grading.read',(select cv.course_id from public.course_versions cv where cv.id=s.course_version_id),case when s.branch_scope_known then s.branch_id else null end)
       order by s.submitted_at desc limit 100
     )submissions),'[]'::jsonb));
   end if;
   if allow_grading then
     result:=result || jsonb_build_object('examResults',coalesce((select jsonb_agg(v order by v->>'submittedAt' desc) from (
       select jsonb_build_object('id',e.id,'courseVersionId',e.course_version_id,'itemId',e.item_id,'status',e.status,'submittedAt',e.submitted_at,'branchId',e.branch_id,'percent',e.percent) v
       from public.exam_attempts e where e.user_id=target and (is_global or (e.branch_scope_known and e.branch_id=p_branch_id)) and public.teaching_has_course_permission(p_actor_id,'grading.read',(select cv.course_id from public.course_versions cv where cv.id=e.course_version_id),case when e.branch_scope_known then e.branch_id else null end)
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
     'enrollments',(select count(*) from public.enrollments e where e.branch_scope_known and e.branch_id=b.id and public.teaching_report_scope(p_actor_id,e.course_id,e.branch_id)),
     'completedEnrollments',(select count(*) from public.enrollments e where e.branch_scope_known and e.branch_id=b.id and public.teaching_report_scope(p_actor_id,e.course_id,e.branch_id) and e.status='completed'),
     'submissions',(select count(*) from public.assignment_submissions s where s.branch_scope_known and s.branch_id=b.id and public.teaching_report_scope(p_actor_id,(select cv.course_id from public.course_versions cv where cv.id=s.course_version_id),s.branch_id)),
     'pendingGrading',(select count(*) from public.assignment_submissions s where s.branch_scope_known and s.branch_id=b.id and public.teaching_report_scope(p_actor_id,(select cv.course_id from public.course_versions cv where cv.id=s.course_version_id),s.branch_id) and s.status in ('submitted','in_review')),
     'averagePercent',(select round(avg(case when g.max_points>0 then g.total_points/g.max_points*100 end),2) from public.grades g join public.assignment_submissions s on s.id=g.submission_id where s.branch_scope_known and s.branch_id=b.id and public.teaching_report_scope(p_actor_id,(select cv.course_id from public.course_versions cv where cv.id=s.course_version_id),s.branch_id)),
     'activeLearners30d',(select count(distinct e.user_id) from public.analytics_events e where e.branch_scope_known and e.branch_id=b.id and public.teaching_report_scope(p_actor_id,e.props->>'courseId',e.branch_id) and e.at>=now()-interval '30 days')
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
     result:=result||jsonb_build_object('enrollments',(select count(*) from public.enrollments e where (is_global or (e.branch_scope_known and e.branch_id=p_branch_id)) and public.teaching_has_course_permission(p_actor_id,'learning.read',e.course_id,case when e.branch_scope_known then e.branch_id else null end)));
   end if;
   if public.authorization_has_permission(p_actor_id,'grading.read',p_scope_kind,p_branch_id) then
     result:=result||jsonb_build_object('pendingGrading',(select count(*) from public.assignment_submissions s where s.status in ('submitted','in_review') and (is_global or (s.branch_scope_known and s.branch_id=p_branch_id)) and public.teaching_has_course_permission(p_actor_id,'grading.read',(select cv.course_id from public.course_versions cv where cv.id=s.course_version_id),case when s.branch_scope_known then s.branch_id else null end)));
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

-- Daily activity is assembled from scoped source rows, never from preaggregated views.
create or replace function public.teaching_analytics_daily(p_actor_id uuid,p_branch_id text,p_from date,p_to date)
returns table(branch_id text,day date,active_learners_7d bigint,active_learners_30d bigint,enrollments bigint,lesson_progress_total bigint,lesson_completions bigint,quiz_attempts bigint,exam_attempts bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise invalid_parameter_value; end if;
 if not (public.authorization_has_permission(p_actor_id,case when p_branch_id is null then 'report.global.read' else 'report.branch.read' end,case when p_branch_id is null then 'central' else 'branch' end,p_branch_id)
   or public.authorization_has_permission(p_actor_id,case when p_branch_id is null then 'analytics.global.read' else 'analytics.branch.read' end,case when p_branch_id is null then 'central' else 'branch' end,p_branch_id)) then raise insufficient_privilege; end if;
 return query
 with days as (select generate_series(p_from,p_to,interval '1 day')::date as d),
 events as (select e.* from public.analytics_events e where e.branch_scope_known and (p_branch_id is null or e.branch_id=p_branch_id) and public.teaching_report_scope(p_actor_id,e.props->>'courseId',e.branch_id)),
 enrolled as (select e.* from public.enrollments e where e.branch_scope_known and (p_branch_id is null or e.branch_id=p_branch_id) and public.teaching_report_scope(p_actor_id,e.course_id,e.branch_id)),
 lessons as (select l.*,e.branch_id from public.lesson_progress l join enrolled e on e.user_id=l.user_id and e.course_version_id=l.course_version_id),
 quizzes as (select a.* from public.quiz_attempts a join public.course_versions v on v.id=a.course_version_id where a.branch_scope_known and (p_branch_id is null or a.branch_id=p_branch_id) and public.teaching_report_scope(p_actor_id,v.course_id,a.branch_id)),
 exams as (select a.* from public.exam_attempts a join public.course_versions v on v.id=a.course_version_id where a.branch_scope_known and (p_branch_id is null or a.branch_id=p_branch_id) and public.teaching_report_scope(p_actor_id,v.course_id,a.branch_id))
 select p_branch_id,d.d,
 (select count(distinct e.user_id) from events e where (e.at at time zone 'UTC')::date between d.d-6 and d.d),
 (select count(distinct e.user_id) from events e where (e.at at time zone 'UTC')::date between d.d-29 and d.d),
 (select count(*) from enrolled e where (e.enrolled_at at time zone 'UTC')::date=d.d),
 (select count(*) from lessons l where (coalesce(l.completed_at,l.started_at) at time zone 'UTC')::date=d.d),
 (select count(*) from lessons l where l.status='completed' and (coalesce(l.completed_at,l.started_at) at time zone 'UTC')::date=d.d),
 (select count(*) from quizzes a where (a.submitted_at at time zone 'UTC')::date=d.d),
 (select count(*) from exams a where (a.submitted_at at time zone 'UTC')::date=d.d)
 from days d order by d.d;
end $$;

create or replace function public.teaching_analytics_course_daily(p_actor_id uuid,p_branch_id text,p_from date,p_to date)
returns table(branch_id text,course_id text,day date,quiz_attempts bigint,exam_attempts bigint,average_percent numeric,score_sum numeric,score_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 -- Reuse the authorization gate without materializing the entire daily series.
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise invalid_parameter_value; end if;
 perform public.teaching_analytics_daily(p_actor_id,p_branch_id,p_from,p_from);
 return query with attempts as (
 select v.course_id,(a.submitted_at at time zone 'UTC')::date as d,'quiz'::text as kind,a.percent::numeric as score
 from public.quiz_attempts a join public.course_versions v on v.id=a.course_version_id
 where a.branch_scope_known and a.branch_id=p_branch_id and public.teaching_report_scope(p_actor_id,v.course_id,a.branch_id)
 union all
 select v.course_id,(a.submitted_at at time zone 'UTC')::date,'exam'::text,a.percent::numeric
 from public.exam_attempts a join public.course_versions v on v.id=a.course_version_id
 where a.branch_scope_known and a.branch_id=p_branch_id and public.teaching_report_scope(p_actor_id,v.course_id,a.branch_id)
 ) select p_branch_id,a.course_id,a.d,count(*) filter(where a.kind='quiz'),count(*) filter(where a.kind='exam'),round(avg(a.score),2),coalesce(sum(a.score),0),count(a.score)
 from attempts a where a.d between p_from and p_to group by a.course_id,a.d order by a.d,a.course_id;
end $$;

create or replace function public.teaching_analytics_pending(p_actor_id uuid,p_branch_id text)
returns bigint language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result bigint;
begin
 perform public.teaching_analytics_daily(p_actor_id,p_branch_id,current_date,current_date);
 with latest as (
 select distinct on (s.user_id,s.course_version_id,s.item_id,s.block_id) s.*,g.released
 from public.assignment_submissions s join public.course_versions v on v.id=s.course_version_id left join public.grades g on g.submission_id=s.id
 where s.branch_scope_known and s.branch_id=p_branch_id and public.teaching_report_scope(p_actor_id,v.course_id,s.branch_id)
 order by s.user_id,s.course_version_id,s.item_id,s.block_id,s.attempt_no desc,s.id desc
 ) select (select count(*) from latest s where (s.status in ('submitted','in_review') or (s.status in ('approved','changes_requested') and s.released is not true))
 and not exists (select 1 from public.assignment_submissions prior join public.grades g on g.submission_id=prior.id where prior.user_id=s.user_id and prior.course_version_id=s.course_version_id and prior.item_id=s.item_id and prior.block_id is not distinct from s.block_id and prior.branch_scope_known and prior.branch_id=s.branch_id and g.released and g.decision='approved'))
 + (select count(*) from public.exam_attempts a join public.course_versions v on v.id=a.course_version_id where a.branch_scope_known and a.branch_id=p_branch_id and a.status='pending_manual' and public.teaching_report_scope(p_actor_id,v.course_id,a.branch_id)) into result;
 return result;
end $$;

create or replace function public.teaching_analytics_failed(p_actor_id uuid,p_branch_id text,p_from date,p_to date)
returns table(course_id text,question_id text,failures bigint,attempts bigint,failure_rate numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise invalid_parameter_value; end if;
 perform public.teaching_analytics_daily(p_actor_id,p_branch_id,p_from,p_from);
 return query select v.course_id,a.question_id,count(*) filter(where a.result->>'status'='incorrect'),count(*) filter(where a.result->>'status' in ('correct','partial','incorrect')),
 round(100.0*count(*) filter(where a.result->>'status'='incorrect')/nullif(count(*) filter(where a.result->>'status' in ('correct','partial','incorrect')),0),2)
 from public.exam_answers a join public.exam_attempts t on t.id=a.attempt_id and t.user_id=a.user_id join public.course_versions v on v.id=t.course_version_id
 where t.branch_scope_known and t.branch_id=p_branch_id and public.teaching_report_scope(p_actor_id,v.course_id,t.branch_id) and (t.submitted_at at time zone 'UTC')::date between p_from and p_to
 group by v.course_id,a.question_id having count(*) filter(where a.result->>'status' in ('correct','partial','incorrect'))>=5 and count(*) filter(where a.result->>'status'='incorrect')>0
 order by 3 desc,5 desc,a.question_id limit 10;
end $$;

revoke all on function public.teaching_analytics_daily(uuid,text,date,date),public.teaching_analytics_course_daily(uuid,text,date,date),public.teaching_analytics_pending(uuid,text),public.teaching_analytics_failed(uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.teaching_analytics_daily(uuid,text,date,date),public.teaching_analytics_course_daily(uuid,text,date,date),public.teaching_analytics_pending(uuid,text),public.teaching_analytics_failed(uuid,text,date,date) to service_role;
