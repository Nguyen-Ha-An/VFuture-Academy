-- Durable account lifecycle journal. Applied only to the Azure identity backend.
-- Identity/academic rows remain after provider deletion; mappings are tombstones.
alter table academy_identity.users add column if not exists disabled_at timestamptz;
alter table academy_identity.users add column if not exists deleted_at timestamptz;
create table if not exists academy_identity.admin_account_operations (
 id uuid primary key, user_id uuid not null references academy_identity.users(id),
 actor_id uuid not null references academy_identity.users(id),
 action text not null check(action in ('create','edit','disable','enable','delete')),
 payload jsonb not null, subject uuid,
 status text not null default 'pending' check(status in ('pending','complete')),
 lease uuid, lease_until timestamptz, retry_required boolean not null default false,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index if not exists account_one_pending_operation on academy_identity.admin_account_operations(user_id) where status='pending';
revoke all on academy_identity.admin_account_operations from public,anon,authenticated;

create or replace function public.academy_admin_account(p_actor_id uuid,p_phase text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,academy_identity as $$
declare
 op academy_identity.admin_account_operations; target uuid; action_name text;
 operation_id uuid; lease_id uuid; payload_value jsonb; subject_id uuid; subject_count integer;
 customer_issuer constant text := 'https://f3152aa5-61de-40fd-bb76-780b9fbe5428.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0';
 result jsonb; current_user_row academy_identity.users;
begin
 perform public.authorization_assert_actor(p_actor_id,'admin.access','central',null);
 perform public.authorization_assert_actor(p_actor_id,'member.manage','central',null);
 target:=nullif(p_input->>'userId','')::uuid;
 if p_phase='read' then
   select * into current_user_row from academy_identity.users where id=target;
   if not found then raise no_data_found; end if;
   select * into op from academy_identity.admin_account_operations where user_id=target and status='pending';
   return jsonb_build_object('userId',target,'status',case when current_user_row.deleted_at is not null then 'deleted' when current_user_row.disabled_at is not null or exists(select 1 from public.user_accounts where user_id=target and status='suspended') then 'disabled' else 'active' end,
     'operation',case when op.id is null then null else jsonb_build_object('id',op.id,'userId',op.user_id,'action',op.action,'payload',op.payload,'status',op.status,'retryRequired',op.retry_required) end);
 end if;
 operation_id:=(p_input->>'operationId')::uuid; lease_id:=(p_input->>'lease')::uuid;
 if operation_id is null or lease_id is null then raise invalid_parameter_value; end if;
 -- The same global guard used by role mutation protects final-admin accounting.
 perform id from public.authorization_guard where id=true for update;
 select * into op from academy_identity.admin_account_operations where id=operation_id for update;
 if p_phase='begin' then
   action_name:=p_input->>'action';
   payload_value:=p_input-'userId'-'operationId'-'lease'-'action'-'confirmation';
   if op.id is not null then
     if target is not null and target<>op.user_id then raise invalid_parameter_value; end if;
     if action_name<>'retry' and (op.action<>action_name or op.payload<>payload_value) then raise invalid_parameter_value; end if;
     if op.status='pending' and op.lease_until>clock_timestamp() then raise serialization_failure; end if;
   else
     if action_name not in ('create','edit','disable','enable','delete') then raise invalid_parameter_value; end if;
     if action_name='create' then
       if target is not null or payload_value->>'displayName' is null or payload_value->>'email' is null or length(payload_value->>'displayName') not between 1 and 160 or (payload_value->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise invalid_parameter_value; end if;
       target:=gen_random_uuid();
       insert into academy_identity.users(id,email,raw_user_meta_data,disabled_at) values(target,lower(payload_value->>'email'),jsonb_build_object('full_name',payload_value->>'displayName'),now());
       update public.user_accounts set status='suspended',suspended_at=now(),suspended_by=p_actor_id,updated_at=now() where user_id=target;
     else
       select * into current_user_row from academy_identity.users where id=target for update;
       if not found then raise no_data_found; end if;
       if current_user_row.deleted_at is not null then raise check_violation; end if;
       if action_name in ('disable','delete') and target=p_actor_id then raise check_violation; end if;
       if action_name='delete' and p_input->>'confirmation' is distinct from 'DELETE LOGIN' then raise invalid_parameter_value; end if;
       if action_name='edit' and (payload_value->>'displayName' is null or length(payload_value->>'displayName') not between 1 and 160) then raise invalid_parameter_value; end if;
       select count(*),min(subject::text)::uuid into subject_count,subject_id from academy_identity.mappings where user_id=target and issuer=customer_issuer;
       if subject_count>1 then raise check_violation; end if;
       -- Never target a workforce Graph identity. An unlinked account is managed locally.
       if action_name in ('disable','delete') then
         update public.user_accounts set status='suspended',suspended_at=now(),suspended_by=p_actor_id,updated_at=now() where user_id=target;
         update academy_identity.users set disabled_at=coalesce(disabled_at,now()) where id=target;
         delete from academy_identity.sessions where user_id=target;
       end if;
     end if;
     insert into academy_identity.admin_account_operations(id,user_id,actor_id,action,payload,subject) values(operation_id,target,p_actor_id,action_name,payload_value,subject_id) returning * into op;
     insert into public.audit_log(actor_id,action,target_type,target_id,after) values(p_actor_id,'user.account.'||action_name||'.requested','user',target::text,jsonb_build_object('operationId',operation_id));
   end if;
   if op.status='pending' then
     update academy_identity.admin_account_operations set lease=lease_id,lease_until=clock_timestamp()+interval '2 minutes',retry_required=false where id=op.id returning * into op;
   end if;
   return jsonb_build_object('id',op.id,'userId',op.user_id,'action',op.action,'payload',op.payload,'subject',op.subject,'status',op.status);
 end if;
 if op.id is null then raise no_data_found; end if;
 if target is not null and target<>op.user_id then raise invalid_parameter_value; end if;
 if op.status='complete' and p_phase='complete' then return jsonb_build_object('userId',op.user_id,'operationId',op.id,'status','complete'); end if;
 if op.lease is distinct from lease_id or op.lease_until<=clock_timestamp() then raise serialization_failure; end if;
 if p_phase='record' then
   if op.action<>'create' then raise invalid_parameter_value; end if;
   subject_id:=(p_input->>'subject')::uuid;
   if subject_id is null or (op.subject is not null and op.subject<>subject_id) then raise invalid_parameter_value; end if;
   insert into academy_identity.mappings(issuer,subject,user_id) values(customer_issuer,subject_id,op.user_id) on conflict(issuer,subject) do nothing;
   if not exists(select 1 from academy_identity.mappings where issuer=customer_issuer and subject=subject_id and user_id=op.user_id) then raise check_violation; end if;
   update academy_identity.admin_account_operations set subject=subject_id where id=op.id;
 elsif p_phase='fail' then
   update academy_identity.admin_account_operations set lease=null,lease_until=null,retry_required=true where id=op.id;
   insert into public.audit_log(actor_id,action,target_type,target_id,after) values(p_actor_id,'user.account.'||op.action||'.retry_required','user',op.user_id::text,jsonb_build_object('operationId',op.id));
 elsif p_phase='complete' then
   if op.action='create' and op.subject is null then raise check_violation; end if;
   if op.action in ('enable','create') then
     update academy_identity.users set disabled_at=null where id=op.user_id and deleted_at is null;
     update public.user_accounts set status='active',suspended_at=null,suspended_by=null,updated_at=now() where user_id=op.user_id;
   elsif op.action='delete' then
     update academy_identity.users set deleted_at=now(),disabled_at=coalesce(disabled_at,now()) where id=op.user_id;
     delete from academy_identity.sessions where user_id=op.user_id;
   elsif op.action='edit' then
     update public.profiles set display_name=op.payload->>'displayName' where id=op.user_id;
     update academy_identity.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('full_name',op.payload->>'displayName') where id=op.user_id;
   end if;
   update academy_identity.admin_account_operations set status='complete',completed_at=now(),lease=null,lease_until=null,retry_required=false where id=op.id;
   insert into public.audit_log(actor_id,action,target_type,target_id,after) values(p_actor_id,'user.account.'||op.action||'.completed','user',op.user_id::text,jsonb_build_object('operationId',op.id,'academicRecordsRetained',true));
 else raise invalid_parameter_value;
 end if;
 return jsonb_build_object('userId',op.user_id,'operationId',op.id,'status',case when p_phase='complete' then 'complete' else 'pending' end);
end; $$;
revoke all on function public.academy_admin_account(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.academy_admin_account(uuid,text,jsonb) to service_role;
