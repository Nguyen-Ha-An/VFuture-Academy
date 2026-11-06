import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildAzureSchema} from './schema.mjs';
import {createAzureTargetClient} from './target.mjs';
import {teacherCutoverInventory} from './forward-55-inventory.mjs';
import {inspectForward53Baseline} from './forward-53.mjs';
import {canonical55,forward55Evidence,FORWARD55_FILE,FORWARD55_FILES,FORWARD55_BOUNDARY} from './forward-55-artifact.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
const BASELINE='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const added=['teaching.assignment.manage','teaching.scope.all'];
function artifact(){
 const built=buildAzureSchema({through:FORWARD55_BOUNDARY});
 if(built.receipt.migrations.length!==59||FORWARD55_FILES.some((file,index)=>built.receipt.migrations[54+index]?.file!==file))fail('Unexpected teacher assignment migration inventory');
 const identity=readFileSync(new URL('../../src/lib/identity/schema.sql',import.meta.url),'utf8');
 return {identity,identitySha256:hash(identity),entry:built.receipt.migrations[54],migrations:built.receipt.migrations.slice(54),prior:built.receipt.migrations.slice(49,54),steps:FORWARD55_FILES.map(file=>built.steps.find(step=>step.id===`supabase/migrations/${file}`))};
}
function clean(source){
 if(source?.sourceClean!==true||!/^[a-f0-9]{40}$/.test(source.sourceCommit??'')||!/^[a-f0-9]{40}$/.test(source.sourceTree??''))fail('Clean teacher assignment source required');
 return {sourceClean:true,sourceCommit:source.sourceCommit,sourceTree:source.sourceTree};
}
async function roles(db,applied){
 const protectedRole=(await db.query("select count(*)::integer as n from pg_trigger where tgrelid='public.role_definitions'::regclass and tgname='role_definitions_protect_built_in' and tgfoid=to_regprocedure('public.protect_built_in_role_definition()') and not tgisinternal and tgenabled in ('O','A')")).rows;
 if(protectedRole.length!==1||protectedRole[0].n!==1)fail('Built-in role protection unavailable');
 const rows=(await db.query(`select id,permissions,built_in,scope_kind from public.role_definitions order by id collate "C"`)).rows;
 if(!Array.isArray(rows)||rows.some(row=>typeof row.id!=='string'||!Array.isArray(row.permissions)||row.permissions.some(value=>typeof value!=='string')||typeof row.built_in!=='boolean'||!['central','branch'].includes(row.scope_kind)))fail('Invalid role definitions');
 for(const id of ['teacher','central_admin','school_admin'])if(rows.filter(row=>row.id===id&&row.built_in).length!==1)fail('Required built-in role missing');
 for(const role of rows)for(const permission of added){
  const count=role.permissions.filter(value=>value===permission).length;
  if(count!==(applied&&['central_admin','school_admin'].includes(role.id)?1:0))fail('Teacher assignment grant mismatch');
 }
 const retained=rows.map(row=>({...row,permissions:row.permissions.filter(permission=>!added.includes(permission))}));
 return {roleCount:rows.length,roleDigest:hash(canonical55(rows)),retainedRoleDigest:hash(canonical55(retained))};
}
async function predecessor(db,data,evidence){
 const server=(await db.query("select current_database() as database,current_user as username,current_setting('server_version_num') as version")).rows;
 if(server.length!==1||server[0].database!=='academy'||server[0].username!=='academy_admin'||!/^17\d{4}$/.test(server[0].version))fail('Unexpected database target');
 const imported=(await db.query('select state,schema_sha256 from academy_private.migration_state where singleton')).rows;
 if(imported.length!==1||imported[0].state!=='imported'||imported[0].schema_sha256!==BASELINE)fail('Unrecognized imported baseline');
 const v1=(await db.query('select filename,source_sha256,azure_sha256,deployment_sha,applied_at from academy_private.canvas_forward_receipts order by filename')).rows;
 if(v1.length!==3||v1.some((row,index)=>row.filename!==data.prior[index].file||row.source_sha256!==data.prior[index].sourceSha256||row.azure_sha256!==data.prior[index].azureSha256||row.deployment_sha!==(index===2?evidence.activationSha:null)))fail('V1 receipt mismatch');
 const assessment=(await db.query('select filename,source_sha256,azure_sha256,source_commit,source_tree,applied_at from academy_private.assessment_forward_receipt where singleton')).rows;
 const expected=data.prior[3];
 if(assessment.length!==1||assessment[0].filename!==expected.file||assessment[0].source_sha256!==expected.sourceSha256||assessment[0].azure_sha256!==expected.azureSha256||!/^[a-f0-9]{40}$/.test(assessment[0].source_commit??'')||!/^[a-f0-9]{40}$/.test(assessment[0].source_tree??''))fail('Assessment receipt mismatch');
 const handles=(await db.query('select filename,source_sha256,azure_sha256,identity_sha256,source_commit,source_tree from academy_private.handle_forward_receipt where singleton')).rows;
 if(handles.length!==1||canonical55(handles[0])!==canonical55(evidence.predecessor))fail('Exact post54 predecessor required');
 const boundary=(await db.query(`select (
  not exists(select 1 from public.profiles where handle is null or handle !~ '^(STU|VFU)-[a-z0-9][a-z0-9_-]{2,31}$' or split_part(handle,'-',1)<>handle_category)
  and exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_guard_handle' and tgfoid=to_regprocedure('public.profile_guard_handle()') and not tgisinternal and tgenabled in ('O','A'))
  and exists(select 1 from pg_class where oid='public.profile_handle_aliases'::regclass and relrowsecurity)
  and exists(select 1 from pg_class where oid='public.public_profile_handles'::regclass and relkind='v' and 'security_invoker=true'=any(reloptions))
  and not has_table_privilege('anon','public.profile_handle_aliases','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.profile_handle_aliases','select,insert,update,delete')
  and not has_table_privilege('anon','public.public_profile_handles','select') and not has_table_privilege('authenticated','public.public_profile_handles','select')
  and has_table_privilege('service_role','public.public_profile_handles','select')
  and (select bool_and(not has_function_privilege('anon',signature,'execute') and not has_function_privilege('authenticated',signature,'execute') and has_function_privilege('service_role',signature,'execute')) from unnest(array['public.profile_initialize(uuid,text)','public.profile_change_handle(uuid,text,timestamptz)','public.academy_identity_initialize_staff_profile(text,uuid,text)']) signature)
  and (select bool_and(c.relrowsecurity and not has_table_privilege('service_role',c.oid,'select,insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete')) from pg_class c where c.oid in ('academy_private.handle_forward_receipt'::regclass,'academy_private.assessment_forward_receipt'::regclass))
 ) as handle_boundaries`)).rows[0];
 if(boundary?.handle_boundaries!==true)fail('Post54 boundary mismatch');
 return hash(canonical55({v1,assessment,handles}));
}
const assignmentFunctions=[
 'public.teaching_course_accessible(text,text)','public.teaching_candidate(uuid,text)',
 'public.teaching_has_course_permission(uuid,text,text,text)','public.teaching_course_scope(uuid,text)',
 'public.teaching_teacher_options(uuid,text,integer,integer)','public.teaching_course_teachers(uuid,text,text)',
 'public.replace_course_teachers(uuid,text,text,integer,jsonb)','public.teaching_assigned_courses(uuid,text)',
];
const examFunctions=[
 'public.exam_save_manual_draft(uuid,jsonb,uuid)',
 'public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb,uuid)',
 'public.exam_release_attempt(uuid,timestamptz,uuid)',
];
const examInternal=[
 'public.exam_assert_teaching_scope(uuid,text,uuid)',
 'public.exam_save_manual_draft(uuid,jsonb)',
 'public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb)',
 'public.exam_release_attempt(uuid,timestamptz)',
];
const grading=['public.grade_assignment_submission_guarded(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb)'];
const gradingPrivate=['public.grade_assignment_submission_before_teaching_scope(uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb,text,boolean,timestamptz,boolean,jsonb,jsonb)','public.guard_teaching_course_write()'];
const analytics=['public.teaching_report_scope(uuid,text,text)','public.teaching_analytics_daily(uuid,text,date,date)','public.teaching_analytics_course_daily(uuid,text,date,date)','public.teaching_analytics_pending(uuid,text)','public.teaching_analytics_failed(uuid,text,date,date)'];
const reports=['public.studio_learning_report(uuid,text,text,date,date,text,boolean)','public.admin_management_read(uuid,text,text,text,jsonb)'];
const serviceFunctions=[...assignmentFunctions.slice(2),...examFunctions,...grading,...reports,...analytics];
const privateFunctions=[...assignmentFunctions.slice(0,2),...examInternal,...gradingPrivate];
async function postconditions(db){
 const found=(await db.query(`select (
  (select count(*)=2 from pg_class c where c.oid in (to_regclass('public.course_teaching_groups'),to_regclass('public.course_teaching_assignments')) and c.relkind='r' and c.relrowsecurity
    and has_table_privilege('service_role',c.oid,'select') and not has_table_privilege('service_role',c.oid,'insert,update,delete')
    and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
  and not exists(select 1 from pg_policy where polrelid in ('public.course_teaching_groups'::regclass,'public.course_teaching_assignments'::regclass))
  and exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.course_teaching_one_primary') and i.indrelid='public.course_teaching_assignments'::regclass and i.indisunique and i.indisvalid and pg_get_indexdef(i.indexrelid) like '%(course_id, branch_id)%' and pg_get_expr(i.indpred,i.indrelid)='(role = ''primary''::text)')
  and (select count(*)=2 from pg_constraint where contype='p' and conrelid in ('public.course_teaching_groups'::regclass,'public.course_teaching_assignments'::regclass))
  and (select count(*)=2 from pg_constraint where contype='f' and conrelid='public.course_teaching_assignments'::regclass and confdeltype='c')
  and exists(select 1 from pg_constraint where contype='c' and conrelid='public.course_teaching_groups'::regclass and pg_get_constraintdef(oid)='CHECK ((revision >= 0))')
  and (select count(*)=2 from public.permission_registry where permission in ('teaching.assignment.manage','teaching.scope.all') and scope_kind='any')
  and (select bool_and(case when to_regprocedure(signature) is null then false else has_function_privilege('service_role',to_regprocedure(signature),'execute') and not has_function_privilege('anon',to_regprocedure(signature),'execute') and not has_function_privilege('authenticated',to_regprocedure(signature),'execute') end) from unnest($1::text[]) signature)
  and (select bool_and(case when to_regprocedure(signature) is null then false else not has_function_privilege('service_role',to_regprocedure(signature),'execute') and not has_function_privilege('anon',to_regprocedure(signature),'execute') and not has_function_privilege('authenticated',to_regprocedure(signature),'execute') end) from unnest($2::text[]) signature)
  and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']) from pg_proc p where p.oid=any(array(select to_regprocedure(signature)::oid from unnest($1::text[]||$2::text[]) signature)))
  and (select count(*)=2 from pg_trigger t where (t.tgrelid,t.tgname) in (('public.teaching_announcements'::regclass,'teaching_announcement_course_guard'),('public.assignment_schedules'::regclass,'assignment_schedule_course_guard')) and t.tgfoid=to_regprocedure('public.guard_teaching_course_write()') and not t.tgisinternal and t.tgenabled in ('O','A'))
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.academy_identity_create_session(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text)') and position('30 days 1 minute' in p.prosrc)>0 and position('24 hours 1 minute' in p.prosrc)=0 and p.prosecdef
    and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute'))
  and has_function_privilege('service_role','public.delete_teaching_announcement(uuid,uuid,integer)','execute')
  and not has_function_privilege('anon','public.delete_teaching_announcement(uuid,uuid,integer)','execute') and not has_function_privilege('authenticated','public.delete_teaching_announcement(uuid,uuid,integer)','execute')
  and exists(select 1 from pg_class c where c.oid='academy_private.teaching_forward_receipt'::regclass and c.relrowsecurity
    and not has_table_privilege('service_role',c.oid,'select,insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
 ) as teaching_postconditions`,[serviceFunctions,privateFunctions])).rows[0];
 if(found?.teaching_postconditions!==true)fail('Teacher assignment postcondition failed');
}
async function inspect(db,data,evidence,source){
 const priorReceiptDigest=await predecessor(db,data,evidence);
 const state=(await db.query(`select
  exists(select 1 from public.permission_registry where permission in ('teaching.assignment.manage','teaching.scope.all')) or exists(select 1 from unnest($2::text[]) signature where to_regprocedure(signature) is not null) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['studio_learning_report','admin_management_read','admin_analytics']) and (position('teaching_has_course_permission' in p.prosrc)>0 or position('teaching_report_scope' in p.prosrc)>0)) as partial_suffix,
  to_regclass('academy_private.teaching_forward_receipt') is not null as receipt_exists,
  to_regclass('public.course_teaching_groups') is not null as groups,to_regclass('public.course_teaching_assignments') is not null as assignments,
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])) as function_count`,[assignmentFunctions.map(signature=>signature.slice(7,signature.indexOf('('))),[...examFunctions,examInternal[0],...gradingPrivate,...analytics]])).rows[0];
 if(!state)fail('Unable to inspect teacher assignment schema');
 let receipt;
 if(state.receipt_exists){
  const rows=(await db.query('select filename,migrations,identity_sha256,prior_receipt_digest,baseline_role_digest,applied_role_digest,source_commit,source_tree from academy_private.teaching_forward_receipt where singleton')).rows;
  if(rows.length!==1||rows[0].filename!==FORWARD55_FILE||rows[0].identity_sha256!==data.identitySha256||canonical55(rows[0].migrations)!==canonical55(data.migrations)||rows[0].prior_receipt_digest!==priorReceiptDigest
   ||!/^[a-f0-9]{64}$/.test(rows[0].baseline_role_digest??'')||!/^[a-f0-9]{64}$/.test(rows[0].applied_role_digest??'')
   ||!/^[a-f0-9]{40}$/.test(rows[0].source_commit??'')||!/^[a-f0-9]{40}$/.test(rows[0].source_tree??''))fail('Teacher assignment receipt mismatch');
  receipt=rows[0];
 }
 if(!receipt&&(state.groups||state.assignments||state.partial_suffix||Number(state.function_count)!==0))fail('Unexpected existing teacher assignment schema');
 const roleState=await roles(db,Boolean(receipt));
 if(receipt){
  if(!state.groups||!state.assignments||Number(state.function_count)!==assignmentFunctions.length||roleState.roleDigest!==receipt.applied_role_digest||roleState.retainedRoleDigest!==receipt.baseline_role_digest)fail('Teacher assignment role/schema drift');
  await postconditions(db);
 }else{
  // Full immutable53 adjudication is valid only before the successor mutates roles.
  // Never replay54 or run its executor against post55 permission state.
  await inspectForward53Baseline(db,evidence.activationSha);
  if((await db.query("select exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.academy_identity_create_session(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text)') and position('24 hours 1 minute' in p.prosrc)>0 and position('30 days 1 minute' in p.prosrc)=0) as frozen_identity")).rows[0]?.frozen_identity!==true)fail('Post54 identity boundary mismatch');
 }
 return {action:receipt?'noop':'apply',filename:FORWARD55_FILE,sourceSha256:data.entry.sourceSha256,azureSha256:data.entry.azureSha256,identitySha256:data.identitySha256,migrations:data.migrations,
  baseline:BASELINE,activationSha:evidence.activationSha,predecessor:evidence.predecessor,priorReceiptDigest,teacherCutoverInventory:await teacherCutoverInventory(db),roleCount:roleState.roleCount,roleDigest:roleState.roleDigest,source,
  ...(receipt?{receiptSourceCommit:receipt.source_commit,receiptSourceTree:receipt.source_tree}:{})};
}
function safe(error){
 const result=new Error('Azure teacher assignment migration failed');
 if(/^[0-9A-Z]{5}$/.test(error?.code??''))result.code=error.code;
 return result;
}
export function createForward55Executor({db,target,expectedActivationSha,expectedPredecessor,source,verifySource}){
 createAzureTargetClient(target);
 const evidence=forward55Evidence({verified:true,activationSha:expectedActivationSha,predecessor:expectedPredecessor});
 const provenance=Object.freeze(clean(source)),data=artifact();
 async function plan(){
  try{await db.query('begin read only');await db.query("set local statement_timeout='15000ms'");const result=await inspect(db,data,evidence,provenance);await db.query('rollback');return result;}
  catch(error){try{await db.query('rollback');}catch{}throw safe(error);}
 }
 async function apply(reviewed){
  if(reviewed?.filename!==FORWARD55_FILE)fail('Reviewed teacher assignment plan required');
  try{
   await db.query('begin');await db.query("set local lock_timeout='5000ms'");await db.query("set local statement_timeout='120000ms'");
   await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
   await db.query('lock table public.authorization_guard,public.role_definitions in share row exclusive mode');
   await db.query('select id from public.authorization_guard where id=true for update');
   // Keep the reviewed counts stable while applying, including direct enrollment writes.
   await db.query('lock table public.user_accounts,public.branch_memberships,public.role_assignments,public.branches,public.enrollments in share mode');
   await db.query('lock table academy_private.canvas_forward_receipts,academy_private.assessment_forward_receipt,academy_private.handle_forward_receipt,academy_private.migration_state in share mode');
   if(verifySource&&canonical55(await verifySource())!==canonical55(provenance))fail('Reviewed teacher assignment source changed');
   const current=await inspect(db,data,evidence,provenance);
   if(canonical55(current)!==canonical55(reviewed))fail('Reviewed teacher assignment plan changed');
   if(current.action==='noop'){await db.query('commit');return {action:'noop',filename:FORWARD55_FILE};}
   await db.query(`create table academy_private.teaching_forward_receipt(singleton boolean primary key default true check(singleton),filename text not null,migrations jsonb not null,identity_sha256 text not null,prior_receipt_digest text not null,baseline_role_digest text not null,applied_role_digest text not null,source_commit text not null,source_tree text not null,applied_at timestamptz not null default now());
    alter table academy_private.teaching_forward_receipt enable row level security;revoke all on academy_private.teaching_forward_receipt from public,anon,authenticated,service_role`);
   for(const step of data.steps)await db.query(step.sql);
   await db.query(data.identity);
   const afterRoles=await roles(db,true);
   if(afterRoles.retainedRoleDigest!==current.roleDigest||afterRoles.roleCount!==current.roleCount)fail('Existing role permissions changed');
   if((await db.query('select (select count(*) from public.course_teaching_groups)=0 and (select count(*) from public.course_teaching_assignments)=0 as unassigned')).rows[0]?.unassigned!==true)fail('Initial assignments must be empty');
   await db.query('insert into academy_private.teaching_forward_receipt(filename,migrations,identity_sha256,prior_receipt_digest,baseline_role_digest,applied_role_digest,source_commit,source_tree) values($1,$2::jsonb,$3,$4,$5,$6,$7,$8)',[FORWARD55_FILE,JSON.stringify(data.migrations),data.identitySha256,current.priorReceiptDigest,current.roleDigest,afterRoles.roleDigest,provenance.sourceCommit,provenance.sourceTree]);
   const after=await inspect(db,data,evidence,provenance);
   if(after.action!=='noop'||after.priorReceiptDigest!==current.priorReceiptDigest||canonical55(after.teacherCutoverInventory)!==canonical55(current.teacherCutoverInventory)||after.roleCount!==current.roleCount||after.receiptSourceCommit!==provenance.sourceCommit||after.receiptSourceTree!==provenance.sourceTree)fail('Teacher assignment postcondition failed');
   if(verifySource&&canonical55(await verifySource())!==canonical55(provenance))fail('Reviewed teacher assignment source changed');
   await db.query("notify pgrst, 'reload schema'");await db.query('commit');return {action:'applied',filename:FORWARD55_FILE};
  }catch(error){try{await db.query('rollback');}catch{}throw safe(error);}
 }
 return {plan,apply};
}
