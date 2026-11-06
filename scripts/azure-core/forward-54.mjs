import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildAzureSchema} from './schema.mjs';
import {createAzureTargetClient} from './target.mjs';
import {inspectForward53Baseline} from './forward-53.mjs';
const FILE='20261106000000_managed_profile_handles.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
function artifact(){
 const built=buildAzureSchema({through:FILE});
 if(built.receipt.migrations.length!==54||built.receipt.migrations[53].file!==FILE)fail('Unexpected handle migration inventory');
 const identity=readFileSync(new URL('../../src/lib/identity/schema.sql',import.meta.url),'utf8');
 return {entry:built.receipt.migrations[53],sql:built.steps.find(step=>step.id===`supabase/migrations/${FILE}`).sql,identity,identitySha256:hash(identity)};
}
const postcondition=`select (
 not exists(select 1 from public.profiles where handle is null or handle !~ '^(STU|VFU)-[a-z0-9][a-z0-9_-]{2,31}$' or split_part(handle,'-',1)<>handle_category)
 and to_regprocedure('public.profile_initialize(uuid,text)') is not null
 and to_regprocedure('public.profile_guard_handle()') is not null
 and to_regprocedure('public.academy_identity_initialize_staff_profile(text,uuid,text)') is not null
 and exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_guard_handle' and tgfoid=to_regprocedure('public.profile_guard_handle()') and not tgisinternal and tgenabled in ('O','A'))
 and exists(select 1 from pg_class where oid='public.profile_handle_aliases'::regclass and relrowsecurity)
 and exists(select 1 from pg_class where oid='public.public_profile_handles'::regclass and relkind='v' and 'security_invoker=true'=any(reloptions))
 and not has_table_privilege('anon','public.profile_handle_aliases','select,insert,update,delete')
 and not has_table_privilege('authenticated','public.profile_handle_aliases','select,insert,update,delete')
 and not has_table_privilege('anon','public.public_profile_handles','select')
 and not has_table_privilege('authenticated','public.public_profile_handles','select')
 and has_table_privilege('service_role','public.public_profile_handles','select')
 and (select bool_and(not has_function_privilege('anon',signature,'execute') and not has_function_privilege('authenticated',signature,'execute') and has_function_privilege('service_role',signature,'execute')) from unnest(array['public.profile_initialize(uuid,text)','public.profile_change_handle(uuid,text,timestamptz)','public.academy_identity_initialize_staff_profile(text,uuid,text)']) signature)
 and not has_table_privilege('service_role','academy_private.handle_forward_receipt','select,insert,update,delete')
 and not has_table_privilege('anon','academy_private.handle_forward_receipt','select,insert,update,delete')
 and not has_table_privilege('authenticated','academy_private.handle_forward_receipt','select,insert,update,delete')
 ) as postconditions`;
async function inspect(db,data,activationSha,source){
 const prior=await inspectForward53Baseline(db,activationSha);
 const workforce=(await db.query(`select count(distinct m.user_id)::integer as workforce_mapped,count(distinct m.user_id) filter(where u.disabled_at is null and u.deleted_at is null and u.email ~* '^[^@[:space:]]+@vfuturelabs[.]org$' and exists(select 1 from public.role_assignments a join public.role_definitions d on d.id=a.role_definition_id cross join lateral unnest(d.permissions) permission(value) where a.user_id=u.id and public.authorization_has_permission(u.id,permission.value,d.scope_kind,a.branch_id)))::integer as workforce_eligible from academy_identity.mappings m join academy_identity.users u on u.id=m.user_id where m.issuer='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0'`)).rows[0];
 if(!workforce||!Number.isSafeInteger(workforce.workforce_mapped)||!Number.isSafeInteger(workforce.workforce_eligible)||workforce.workforce_eligible<0||workforce.workforce_eligible>workforce.workforce_mapped)fail('Invalid workforce category report');
 const state=(await db.query(`select to_regclass('academy_private.handle_forward_receipt') is not null as receipt_exists,to_regclass('public.profile_handle_aliases') is not null as aliases,exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='handle_category') as category,to_regclass('public.public_profile_handles') is not null as projection,to_regprocedure('public.profile_initialize(uuid,text)') is not null as initializer`)).rows[0];
 if(!state)fail('Unable to inspect handle schema');
 let existing;
 if(state.receipt_exists){
  const rows=(await db.query('select filename,source_sha256,azure_sha256,identity_sha256,source_commit,source_tree from academy_private.handle_forward_receipt where singleton')).rows;
  if(rows.length!==1||rows[0].filename!==FILE||rows[0].source_sha256!==data.entry.sourceSha256||rows[0].azure_sha256!==data.entry.azureSha256||rows[0].identity_sha256!==data.identitySha256||!/^[a-f0-9]{40}$/.test(rows[0].source_commit??'')||!/^[a-f0-9]{40}$/.test(rows[0].source_tree??''))fail('Handle receipt mismatch');
  existing=rows[0];
 }
 if(!existing&&[state.receipt_exists,state.aliases,state.category,state.projection,state.initializer].some(Boolean))fail('Unexpected existing handle schema');
 if(existing&&(![state.aliases,state.category,state.projection,state.initializer].every(Boolean)||(await db.query(postcondition)).rows[0]?.postconditions!==true))fail('Handle postcondition failed');
 return {action:existing?'noop':'apply',filename:FILE,sourceSha256:data.entry.sourceSha256,azureSha256:data.entry.azureSha256,identitySha256:data.identitySha256,baseline:prior.baseline,activationSha,priorReceiptDigest:hash(JSON.stringify(prior)),roleCount:prior.roleCount,roleDigest:prior.roleDigest,workforceMappedCount:workforce.workforce_mapped,workforceEligibleCount:workforce.workforce_eligible,workforceExcludedCount:workforce.workforce_mapped-workforce.workforce_eligible,source,...(existing?{receiptSourceCommit:existing.source_commit,receiptSourceTree:existing.source_tree}:{})};
}
function safe(error){const result=new Error('Azure handle migration failed');if(/^[0-9A-Z]{5}$/.test(error?.code??''))result.code=error.code;return result;}
export function createForward54Executor({db,target,expectedActivationSha,source,verifySource}){
 createAzureTargetClient(target);
 if(!/^[a-f0-9]{40}$/.test(expectedActivationSha??''))fail('Expected V1 activation SHA required');
 if(source?.sourceClean!==true||!/^[a-f0-9]{40}$/.test(source.sourceCommit??'')||!/^[a-f0-9]{40}$/.test(source.sourceTree??''))fail('Clean handle source required');
 const data=artifact();
 async function plan(){try{await db.query('begin read only');await db.query("set local statement_timeout='15000ms'");const result=await inspect(db,data,expectedActivationSha,source);await db.query('rollback');return result;}catch(error){try{await db.query('rollback');}catch{}throw safe(error);}}
 async function apply(reviewed){
  if(reviewed?.filename!==FILE)fail('Reviewed handle plan required');
  try{
   await db.query('begin');await db.query("set local lock_timeout='5000ms'");await db.query("set local statement_timeout='120000ms'");
   await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
   await db.query('lock table public.profiles,academy_identity.mappings in share row exclusive mode');
   await db.query('lock table public.role_definitions,academy_private.canvas_forward_receipts,academy_private.assessment_forward_receipt,academy_private.migration_state in share mode');
   if(verifySource&&JSON.stringify(await verifySource())!==JSON.stringify(source))fail('Reviewed handle source changed');
   const current=await inspect(db,data,expectedActivationSha,source);
   if(JSON.stringify(current)!==JSON.stringify(reviewed))fail('Reviewed handle plan changed');
   if(current.action==='noop'){await db.query('commit');return {action:'noop',filename:FILE};}
   // The row values remain inside this transaction; plans and receipts contain metadata only.
   await db.query(`create temporary table handle_release_profiles on commit drop as select id,handle,(to_jsonb(p)-'handle'-'handle_category') as retained from public.profiles p`);
   await db.query(`create table academy_private.handle_forward_receipt(singleton boolean primary key default true check(singleton),filename text not null,source_sha256 text not null,azure_sha256 text not null,identity_sha256 text not null,source_commit text not null,source_tree text not null,applied_at timestamptz not null default now());alter table academy_private.handle_forward_receipt enable row level security;revoke all on academy_private.handle_forward_receipt from public,anon,authenticated,service_role`);
   await db.query(data.sql);await db.query(data.identity);
   const retained=(await db.query(`select not exists(select 1 from handle_release_profiles old full join public.profiles p on p.id=old.id where old.id is null or p.id is null or old.retained is distinct from (to_jsonb(p)-'handle'-'handle_category')) and not exists(select 1 from handle_release_profiles old left join public.profile_handle_aliases a on a.handle=old.handle and a.user_id=old.id where old.handle is not null and a.handle is null) as retained`)).rows[0];
   if(retained?.retained!==true)fail('Handle history preservation failed');
   await db.query('insert into academy_private.handle_forward_receipt(filename,source_sha256,azure_sha256,identity_sha256,source_commit,source_tree) values($1,$2,$3,$4,$5,$6)',[FILE,data.entry.sourceSha256,data.entry.azureSha256,data.identitySha256,source.sourceCommit,source.sourceTree]);
   const after=await inspect(db,data,expectedActivationSha,source);
   if(after.action!=='noop'||after.priorReceiptDigest!==current.priorReceiptDigest||after.roleDigest!==current.roleDigest||after.roleCount!==current.roleCount)fail('Handle postcondition failed');
   if(verifySource&&JSON.stringify(await verifySource())!==JSON.stringify(source))fail('Reviewed handle source changed');
   await db.query("notify pgrst, 'reload schema'");await db.query('commit');return {action:'applied',filename:FILE};
  }catch(error){try{await db.query('rollback');}catch{}throw safe(error);}
 }
 return {plan,apply};
}
