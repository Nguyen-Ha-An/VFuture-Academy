import { createHash } from 'node:crypto';
import { buildAzureSchema } from './schema.mjs';
import { createAzureTargetClient } from './target.mjs';

// A separate forward-only lane: the existing V1 executor and receipt stay unchanged.
const FILE='20261105030000_exam_attachment_bindings.sql';
const V1=['20261105000000_teaching_canvas.sql','20261105010000_teaching_announcement_revisions.sql','20261105020000_teaching_permissions_activation.sql'];
const SOURCE_BASELINE='fc0a0446189fb0b8b0f9ddbf76c6cf742d026db28e5d15b65e98594fe0e53507';
const IMPORT_BASELINE='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const signatures=[
  'public.exam_pinned_question(jsonb,text,text)',
  'public.exam_attachment_reservation_immutable()',
  'public.exam_attachment_binding_immutable()',
  'public.exam_attachment_asset_immutable()',
  'public.exam_attachment_complete(uuid,uuid,uuid,uuid,jsonb)',
  'public.exam_attachment_ready(uuid,uuid)',
  'public.quiz_pinned_question(uuid,text,text,text,text)',
  'public.quiz_attachment_complete(uuid,uuid,uuid,jsonb)',
  'public.quiz_attachment_ready(uuid,uuid)',
  'public.exam_validate_attachment_tree(uuid,uuid,text,jsonb,jsonb)',
  'public.exam_attachment_fingerprint(jsonb,jsonb)',
  'public.exam_answer_may_reference_asset(jsonb)',
  'public.exam_answer_attachment_guard()',
  'public.quiz_validate_attachment_tree(uuid,uuid,text,text,text,jsonb,jsonb)',
  'public.quiz_answer_attachment_guard()',
  'public.exam_answer_has_asset(jsonb,jsonb,text,text)',
  'public.exam_attachment_gradeable_attempts(text,uuid)',
];
const exposed=[signatures[4],signatures[5],signatures[7],signatures[8],signatures[16]];
const functionNames=signatures.map(signature=>signature.slice('public.'.length,signature.indexOf('(')));
const triggerNames=['exam_attachment_reservation_immutable','exam_attachment_binding_immutable','quiz_attachment_binding_immutable','exam_attachment_asset_immutable','exam_answer_attachment_guard','quiz_answer_attachment_guard'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
function artifact(){
  const built=buildAzureSchema({through:FILE});
  const names=built.receipt.migrations.map(row=>row.file);
  if(names.length!==53 || [...V1,FILE].some((file,index)=>names[49+index]!==file))fail('Unexpected migration set');
  const baseline=built.steps.filter(step=>![...V1,FILE].some(file=>step.id===`supabase/migrations/${file}`));
  if(hash(baseline.map(step=>step.sql).join('\n\n'))!==SOURCE_BASELINE)fail('Baseline source mismatch');
  return {v1:built.receipt.migrations.slice(49,52),entry:built.receipt.migrations[52],sql:built.steps.find(step=>step.id===`supabase/migrations/${FILE}`).sql};
}
function safeFailure(error){
  const safe=new Error('Azure forward 53 migration failed');
  const runtimeCodes=new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);
  if(typeof error?.code==='string' && (/^[0-9A-Z]{5}$/.test(error.code) || runtimeCodes.has(error.code)))safe.code=error.code;
  return safe;
}
function checkSource(source){
  if(!source || (source.sourceClean===false && source.sourceCommit===null && source.sourceTree===null))return {sourceClean:false,sourceCommit:null,sourceTree:null};
  if(source.sourceClean!==true || !/^[a-f0-9]{40}$/.test(source.sourceCommit??'') || !/^[a-f0-9]{40}$/.test(source.sourceTree??''))fail('Invalid source provenance');
  return {sourceClean:true,sourceCommit:source.sourceCommit,sourceTree:source.sourceTree};
}
async function roles(db){
  const trigger=(await db.query("select count(*)::integer as n from pg_trigger where tgrelid='public.role_definitions'::regclass and tgname='role_definitions_protect_built_in' and tgfoid=to_regprocedure('public.protect_built_in_role_definition()') and not tgisinternal and tgenabled in ('O','A')")).rows;
  if(trigger.length!==1 || Number(trigger[0].n)!==1)fail('Built-in role protection unavailable');
  const rows=(await db.query(`select id,permissions,built_in,encode(array_send(permissions),'hex') as permission_bytes from public.role_definitions order by id collate "C"`)).rows;
  if(!Array.isArray(rows) || rows.some(row=>typeof row.id!=='string' || !Array.isArray(row.permissions) || row.permissions.some(value=>typeof value!=='string') || typeof row.permission_bytes!=='string' || !/^[a-f0-9]+$/.test(row.permission_bytes)))fail('Invalid role definitions');
  for(const id of ['teacher','central_admin','school_admin'])if(rows.filter(row=>row.id===id && row.built_in===true).length!==1)fail('Required built-in role missing');
  for(const role of rows)for(const permission of ['teaching.announcement.manage','teaching.schedule.manage']){
    const count=role.permissions.filter(value=>value===permission).length;
    if((role.id==='teacher' || role.id==='central_admin') && count!==1 || role.id==='school_admin' && count!==0)fail('Invalid activated teaching permissions');
  }
  return {roleCount:rows.length,roleDigest:hash(JSON.stringify(rows.map(({id,permission_bytes})=>({id,permission_bytes}))))};
}
async function inspect(db, data, activationSha, source){
  const server=(await db.query("select current_database() as database,current_user as username,current_setting('server_version_num') as version")).rows;
  if(server.length!==1 || server[0].database!=='academy' || server[0].username!=='academy_admin' || !/^17\d{4}$/.test(server[0].version))fail('Unexpected database target');
  const imported=(await db.query('select state,schema_sha256 from academy_private.migration_state where singleton')).rows;
  if(imported.length!==1 || imported[0].state!=='imported' || imported[0].schema_sha256!==IMPORT_BASELINE)fail('Unrecognized imported baseline');
  const prior=(await db.query('select filename,source_sha256,azure_sha256,deployment_sha,applied_at from academy_private.canvas_forward_receipts order by filename')).rows;
  if(prior.length!==3 || prior.some((row,index)=>row.filename!==data.v1[index].file || row.source_sha256!==data.v1[index].sourceSha256 || row.azure_sha256!==data.v1[index].azureSha256 || row.deployment_sha!==(index===2?activationSha:null)))fail('V1 forward receipt mismatch');
  const priorDigest=hash(JSON.stringify(prior));
  const v1=(await db.query(`select (
    to_regclass('public.teaching_announcements') is not null and to_regclass('public.assignment_schedules') is not null
    and (select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('teaching_announcements','assignment_schedules') and c.relkind='r' and c.relrowsecurity
      and has_table_privilege('service_role',c.oid,'select') and has_table_privilege('service_role',c.oid,'insert') and has_table_privilege('service_role',c.oid,'update') and has_table_privilege('service_role',c.oid,'delete')
      and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='due_at_snapshot' and data_type='timestamp with time zone' and is_nullable='YES')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='late' and data_type='boolean' and is_nullable='YES')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='teaching_announcements' and column_name='revision' and data_type='integer' and is_nullable='NO')
    and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.teaching_announcements') and tgname='teaching_announcements_revision' and not tgisinternal and tgenabled in ('O','A'))
    and (select count(*)=4 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled in ('O','A') and (c.relname,t.tgname,t.tgfoid) in (
      ('assignment_submissions','zz_assignment_submissions_snapshot_deadline',to_regprocedure('public.snapshot_assignment_deadline()')),
      ('assignment_submissions','assignment_submissions_protect_deadline',to_regprocedure('public.protect_assignment_deadline_snapshot()')),
      ('teaching_announcements','teaching_announcements_audit',to_regprocedure('public.audit_teaching_change()')),
      ('assignment_schedules','assignment_schedules_audit',to_regprocedure('public.audit_teaching_change()'))))
    and to_regprocedure('public.delete_teaching_announcement(uuid,uuid)') is null
    and to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)') is not null
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)'),'execute'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)'),'execute'),true)
    and not coalesce(has_function_privilege('anon',to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)'),'execute'),true)
  ) as v1_boundaries`)).rows[0];
  if(v1?.v1_boundaries!==true)fail('V1 boundary mismatch');
  const roleState=await roles(db);
  const state=(await db.query(`select to_regclass('academy_private.assessment_forward_receipt') is not null as receipt_exists,
    to_regclass('public.exam_attachment_bindings') is not null as exam_table,
    to_regclass('public.quiz_attachment_bindings') is not null as quiz_table,
    (select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])) as function_count,
    (select count(*)::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgname=any($2::text[])) as trigger_count`,[functionNames,triggerNames])).rows[0];
  if(!state)fail('Unable to inspect assessment schema');
  let existing=null;
  if(state.receipt_exists){
    const found=(await db.query('select filename,source_sha256,azure_sha256,source_commit,source_tree from academy_private.assessment_forward_receipt where singleton')).rows;
    if(found.length!==1 || found[0].filename!==FILE || found[0].source_sha256!==data.entry.sourceSha256 || found[0].azure_sha256!==data.entry.azureSha256
      || !((found[0].source_commit===null && found[0].source_tree===null) || (/^[a-f0-9]{40}$/.test(found[0].source_commit??'') && /^[a-f0-9]{40}$/.test(found[0].source_tree??''))))fail('Assessment receipt mismatch');
    existing=found[0];
  }
  if(!existing && (state.receipt_exists || state.exam_table || state.quiz_table || Number(state.function_count)!==0 || Number(state.trigger_count)!==0))fail('Unexpected existing assessment schema');
  if(existing){
    if(!state.exam_table || !state.quiz_table || Number(state.function_count)!==signatures.length || Number(state.trigger_count)!==triggerNames.length)fail('Assessment schema mismatch');
    const post=(await db.query(`select (
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='academy_private' and c.relname='assessment_forward_receipt' and c.relkind='r' and c.relrowsecurity
        and not has_table_privilege('service_role',c.oid,'select,insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
      and (select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('exam_attachment_bindings','quiz_attachment_bindings') and c.relkind='r' and c.relrowsecurity)
      and (select count(*)=22 from information_schema.columns where table_schema='public' and (table_name,column_name,data_type,is_nullable) in (
        ('exam_attachment_bindings','asset_id','text','NO'),('exam_attachment_bindings','reservation_id','uuid','NO'),('exam_attachment_bindings','owner_id','uuid','NO'),('exam_attachment_bindings','attempt_id','uuid','NO'),('exam_attachment_bindings','root_question_id','text','NO'),('exam_attachment_bindings','question_id','text','NO'),('exam_attachment_bindings','filename','text','NO'),('exam_attachment_bindings','size_bytes','bigint','NO'),('exam_attachment_bindings','mime','text','NO'),
        ('quiz_attachment_bindings','asset_id','text','NO'),('quiz_attachment_bindings','reservation_id','uuid','NO'),('quiz_attachment_bindings','owner_id','uuid','NO'),('quiz_attachment_bindings','course_version_id','uuid','NO'),('quiz_attachment_bindings','item_id','text','NO'),('quiz_attachment_bindings','quiz_id','text','NO'),('quiz_attachment_bindings','branch_id','text','YES'),('quiz_attachment_bindings','branch_scope_known','boolean','NO'),('quiz_attachment_bindings','root_question_id','text','NO'),('quiz_attachment_bindings','question_id','text','NO'),('quiz_attachment_bindings','filename','text','NO'),('quiz_attachment_bindings','size_bytes','bigint','NO'),('quiz_attachment_bindings','mime','text','NO')))
      and (select count(*)=2 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname in ('exam_attachment_bindings','quiz_attachment_bindings') and c.contype='p')
      and (select count(*)=2 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname in ('exam_attachment_bindings','quiz_attachment_bindings') and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (reservation_id)')
      and (select count(*)=6 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_class f on f.oid=c.confrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and c.contype='f' and c.confdeltype='r' and (r.relname,f.relname) in (('exam_attachment_bindings','media_assets'),('exam_attachment_bindings','media_upload_reservations'),('exam_attachment_bindings','exam_attempts'),('quiz_attachment_bindings','media_assets'),('quiz_attachment_bindings','media_upload_reservations'),('quiz_attachment_bindings','course_version_items')))
      and (select bool_and(has_table_privilege('service_role',c.oid,'select') and not has_table_privilege('service_role',c.oid,'insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('exam_attachment_bindings','quiz_attachment_bindings'))
      and (select bool_and(case when to_regprocedure(signature) is null then false else not has_function_privilege('anon',to_regprocedure(signature),'execute') and not has_function_privilege('authenticated',to_regprocedure(signature),'execute') end) from unnest($1::text[]) signature)
      and (select bool_and(case when to_regprocedure(signature) is null then false else has_function_privilege('service_role',to_regprocedure(signature),'execute') end) from unnest($2::text[]) signature)
      and (select count(*)=6 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled in ('O','A') and (c.relname,t.tgname,t.tgfoid) in (
        ('media_upload_reservations','exam_attachment_reservation_immutable',to_regprocedure('public.exam_attachment_reservation_immutable()')),
        ('exam_attachment_bindings','exam_attachment_binding_immutable',to_regprocedure('public.exam_attachment_binding_immutable()')),
        ('quiz_attachment_bindings','quiz_attachment_binding_immutable',to_regprocedure('public.exam_attachment_binding_immutable()')),
        ('media_assets','exam_attachment_asset_immutable',to_regprocedure('public.exam_attachment_asset_immutable()')),
        ('exam_answers','exam_answer_attachment_guard',to_regprocedure('public.exam_answer_attachment_guard()')),
        ('quiz_attempts','quiz_answer_attachment_guard',to_regprocedure('public.quiz_answer_attachment_guard()'))))
    ) as postconditions`,[signatures,exposed])).rows[0];
    if(post?.postconditions!==true)fail('Assessment postcondition failed');
  }
  return {action:existing?'noop':'apply',filename:FILE,sourceSha256:data.entry.sourceSha256,azureSha256:data.entry.azureSha256,
    baseline:IMPORT_BASELINE,activationSha,priorReceiptDigest:priorDigest,...roleState,source,
    ...(existing?{receiptSourceCommit:existing.source_commit,receiptSourceTree:existing.source_tree}:{})};
}
/**
 * Pure transport boundary: source provenance is caller-provided and is not a deployment claim.
 * @typedef {{sourceClean:boolean,sourceCommit:string|null,sourceTree:string|null}} SourceProvenance
 * @param {{db:{query:(sql:string,params?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >},target:Readonly<Record<string,string|undefined>>,expectedActivationSha:string,source?:SourceProvenance,verifySource?:()=>SourceProvenance|Promise<SourceProvenance>}} options
 */
export function createForward53Executor({db,target,expectedActivationSha,source,verifySource}){
  createAzureTargetClient(target);
  if(typeof expectedActivationSha!=='string' || !/^[a-f0-9]{40}$/.test(expectedActivationSha))fail('Expected V1 activation SHA required');
  const data=artifact();const provenance=Object.freeze(checkSource(source));
  async function plan(){
    try{await db.query('begin read only');await db.query("set local statement_timeout='15000ms'");const result=await inspect(db,data,expectedActivationSha,provenance);await db.query('rollback');return result;}
    catch(error){try{await db.query('rollback');}catch{}if(error instanceof Error && /^(Unexpected database target|Unrecognized imported baseline|V1 forward receipt mismatch|V1 boundary mismatch|Built-in role protection unavailable|Invalid role definitions|Required built-in role missing|Invalid activated teaching permissions|Unable to inspect assessment schema|Assessment receipt mismatch|Unexpected existing assessment schema|Assessment schema mismatch|Assessment postcondition failed)$/.test(error.message))throw error;throw safeFailure(error);}
  }
  async function apply(reviewed){
    if(!reviewed || reviewed.filename!==FILE)fail('Reviewed plan required');
    try{
      await db.query('begin');await db.query("set local lock_timeout='5000ms'");await db.query("set local statement_timeout='120000ms'");
      await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
      await db.query('lock table public.role_definitions, academy_private.canvas_forward_receipts, academy_private.migration_state in share mode');
      if(verifySource && JSON.stringify(await verifySource())!==JSON.stringify(provenance))fail('Reviewed source changed');
      const current=await inspect(db,data,expectedActivationSha,provenance);
      if(JSON.stringify(current)!==JSON.stringify(reviewed))fail('Reviewed plan changed');
      if(current.action==='noop'){await db.query('commit');return {action:'noop',filename:FILE};}
      await db.query(`create table academy_private.assessment_forward_receipt(singleton boolean primary key default true check(singleton),filename text not null,source_sha256 text not null,azure_sha256 text not null,source_commit text,source_tree text,applied_at timestamptz not null default now());
        alter table academy_private.assessment_forward_receipt enable row level security;
        revoke all on academy_private.assessment_forward_receipt from public,anon,authenticated,service_role`);
      await db.query(data.sql);
      const afterRoles=await roles(db);
      if(afterRoles.roleCount!==current.roleCount || afterRoles.roleDigest!==current.roleDigest)fail('Role permissions changed during assessment expansion');
      await db.query('insert into academy_private.assessment_forward_receipt(filename,source_sha256,azure_sha256,source_commit,source_tree) values($1,$2,$3,$4,$5)',[FILE,data.entry.sourceSha256,data.entry.azureSha256,provenance.sourceCommit,provenance.sourceTree]);
      const after=await inspect(db,data,expectedActivationSha,provenance);
      if(after.action!=='noop' || after.roleDigest!==current.roleDigest || after.roleCount!==current.roleCount || after.priorReceiptDigest!==current.priorReceiptDigest
        || after.receiptSourceCommit!==provenance.sourceCommit || after.receiptSourceTree!==provenance.sourceTree)fail('Assessment postcondition failed');
      if(verifySource && JSON.stringify(await verifySource())!==JSON.stringify(provenance))fail('Reviewed source changed');
      await db.query("notify pgrst, 'reload schema'");await db.query('commit');
      return {action:'applied',filename:FILE};
    }catch(error){try{await db.query('rollback');}catch{}if(error instanceof Error && /^(Reviewed plan changed|Reviewed source changed|Role permissions changed during assessment expansion|Assessment postcondition failed|Unexpected database target|Unrecognized imported baseline|V1 forward receipt mismatch|V1 boundary mismatch|Built-in role protection unavailable|Invalid role definitions|Required built-in role missing|Invalid activated teaching permissions|Unable to inspect assessment schema|Assessment receipt mismatch|Unexpected existing assessment schema|Assessment schema mismatch)$/.test(error.message))throw error;throw safeFailure(error);}
  }
  return {plan,apply};
}
