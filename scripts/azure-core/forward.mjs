import { createHash } from 'node:crypto';
import { buildAzureSchema } from './schema.mjs';
import { createAzureTargetClient } from './target.mjs';

// The 49-file aggregate reflects reviewed source; the imported digest is the
// separately documented, whitespace-only predecessor. Never rewrite that ledger.
const SOURCE_BASELINE = 'fc0a0446189fb0b8b0f9ddbf76c6cf742d026db28e5d15b65e98594fe0e53507';
const IMPORT_BASELINE = '273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const FILES = [
  '20261105000000_teaching_canvas.sql',
  '20261105010000_teaching_announcement_revisions.sql',
  '20261105020000_teaching_permissions_activation.sql',
];
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
function artifact() {
  const built=buildAzureSchema();
  const names=built.receipt.migrations.map(m=>m.file);
  if(names.length!==52 || FILES.some((name,i)=>names[49+i]!==name)) fail('Unexpected migration set');
  const baseline=built.steps.filter(step=>!FILES.some(file=>step.id===`supabase/migrations/${file}`));
  if(digest(baseline.map(step=>step.sql).join('\n\n'))!==SOURCE_BASELINE) fail('Baseline source mismatch');
  return FILES.map(file=>({ ...built.receipt.migrations.find(row=>row.file===file), sql:built.steps.find(step=>step.id===`supabase/migrations/${file}`).sql }));
}
function validateTarget(target) {
  // This is validation only: no connection is opened. The caller must use the
  // same guarded target to create and connect its transport.
  createAzureTargetClient(target);
}
function safeError(error) {
  const safe = new Error('Azure forward migration failed');
  const runtimeCodes = new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);
  if(typeof error?.code === 'string' && (/^[0-9A-Z]{5}$/.test(error.code) || runtimeCodes.has(error.code))) safe.code=error.code;
  return safe;
}
function stageFiles(stage, files) {
  if(stage==='schema') return files.slice(0,2);
  if(stage==='activate') return files.slice(2);
  return fail('Invalid forward phase');
}
function checkDeployment(evidence) {
  if(!evidence || evidence.verified !== true || !/^[a-f0-9]{40}$/.test(evidence.reviewedSha ?? '') || evidence.verifiedSha !== evidence.reviewedSha) fail('Verified deployment required');
  return evidence.verifiedSha;
}
const TEACHING_PERMISSIONS=['teaching.announcement.manage','teaching.schedule.manage'];
async function inspectRoles(db, activated) {
  const trigger=(await db.query("select count(*)::integer as n from pg_trigger where tgrelid='public.role_definitions'::regclass and tgname='role_definitions_protect_built_in' and tgfoid=to_regprocedure('public.protect_built_in_role_definition()') and not tgisinternal and tgenabled in ('O','A')")).rows;
  if(trigger.length!==1 || Number(trigger[0].n)!==1) fail('Built-in role protection unavailable');
  const rows=(await db.query(`select id,permissions,built_in,encode(array_send(permissions),'hex') as permission_bytes from public.role_definitions order by id collate "C"`)).rows;
  if(!Array.isArray(rows) || rows.some(row=>typeof row.id!=='string' || !Array.isArray(row.permissions) || row.permissions.some(value=>typeof value!=='string') || typeof row.permission_bytes!=='string' || !/^[a-f0-9]+$/.test(row.permission_bytes))) fail('Invalid role definitions');
  for(const id of ['teacher','central_admin','school_admin']) {
    const matches=rows.filter(row=>row.id===id && row.built_in===true);
    if(matches.length!==1) fail('Required built-in role missing');
  }
  for(const role of rows) {
    for(const permission of TEACHING_PERMISSIONS) {
      const count=role.permissions.filter(value=>value===permission).length;
      if(!activated && count!==0) fail('Existing teaching permissions incompatible with old application');
      if(activated && (role.id==='teacher' || role.id==='central_admin') && count!==1) fail('Invalid activated teaching permissions');
      if(activated && role.id==='school_admin' && count!==0) fail('Invalid activated teaching permissions');
    }
  }
  return {roleCount:rows.length,roleDigest:digest(JSON.stringify(rows.map(({id,permission_bytes})=>({id,permission_bytes}))))};
}
async function inspect(db, stage, files) {
  const server=(await db.query("select current_database() as database, current_user as username, current_setting('server_version_num') as version")).rows;
  if(server.length!==1 || server[0].database!=='academy' || server[0].username!=='academy_admin' || !/^17\d{4}$/.test(server[0].version)) fail('Unexpected database target');
  const imported=(await db.query('select state,schema_sha256 from academy_private.migration_state where singleton')).rows;
  if(imported.length!==1 || imported[0].state!=='imported' || imported[0].schema_sha256!==IMPORT_BASELINE) fail('Unrecognized imported baseline');
  const existence=(await db.query("select to_regclass('academy_private.canvas_forward_receipts') is not null as ledger, to_regclass('public.teaching_announcements') is not null as announcements, to_regclass('public.assignment_schedules') is not null as schedules, exists(select 1 from information_schema.columns where table_schema='public' and table_name='teaching_announcements' and column_name='revision') as revision")).rows[0];
  if(!existence) fail('Unable to inspect schema');
  const boundary=(await db.query(`select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='due_at_snapshot') as due_present,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='due_at_snapshot' and data_type='timestamp with time zone' and is_nullable='YES') as due_snapshot,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='late') as late_present,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignment_submissions' and column_name='late' and data_type='boolean' and is_nullable='YES') as late,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='teaching_announcements' and column_name='revision' and data_type='integer' and is_nullable='NO') as revision_column,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.teaching_announcements') and tgname='teaching_announcements_revision' and not tgisinternal and tgenabled in ('O','A')) as revision_trigger,
    to_regprocedure('public.delete_teaching_announcement(uuid,uuid)') is not null as legacy_rpc,
    to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)') is not null as guarded_rpc,
    case when to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)') is null then false else has_function_privilege('service_role','public.delete_teaching_announcement(uuid,uuid,integer)','execute') end as rpc_service,
    case when to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)') is null then false else has_function_privilege('authenticated','public.delete_teaching_announcement(uuid,uuid,integer)','execute') end as rpc_authenticated,
    case when to_regprocedure('public.delete_teaching_announcement(uuid,uuid,integer)') is null then false else has_function_privilege('anon','public.delete_teaching_announcement(uuid,uuid,integer)','execute') end as rpc_anon`)).rows[0];
  if(!boundary) fail('Unable to inspect schema');
  const receipts=existence.ledger ? (await db.query('select filename,source_sha256,azure_sha256,deployment_sha from academy_private.canvas_forward_receipts order by filename')).rows : [];
  if(existence.ledger && ![2,3].includes(receipts.length)) fail('Invalid forward receipt');
  if(receipts.some((row,i)=>row.filename!==files[i].file || row.source_sha256!==files[i].sourceSha256 || row.azure_sha256!==files[i].azureSha256 || (i<2 && row.deployment_sha!==null) || (i===2 && !/^[a-f0-9]{40}$/.test(row.deployment_sha ?? '')))) fail('Forward receipt mismatch');
  const expanded=receipts.length>=2;
  if([existence.announcements,existence.schedules,existence.revision].some(value=>value!==expanded)) fail('Unexpected existing schema');
  if([boundary.due_present,boundary.due_snapshot,boundary.late_present,boundary.late,boundary.revision_column,boundary.revision_trigger,boundary.guarded_rpc,boundary.rpc_service].some(value=>value!==expanded) || boundary.legacy_rpc!==false || boundary.rpc_authenticated!==false || boundary.rpc_anon!==false) fail('Unexpected schema boundary');
  if(stage==='activate' && !expanded) fail('Expansion receipt required');
  const roleState=await inspectRoles(db,receipts.length===3);
  const done=stage==='schema' ? expanded : receipts.length===3;
  return {phase:stage,action:done?'noop':'apply',files:stageFiles(stage,files).map(row=>row.file),sourceHashes:stageFiles(stage,files).map(row=>row.sourceSha256),azureHashes:stageFiles(stage,files).map(row=>row.azureSha256),receiptCount:receipts.length,serverMajor:17,baseline:IMPORT_BASELINE,...roleState,...(receipts.length===3?{deploymentSha:receipts[2].deployment_sha}:{})};
}
/** A caller-owned transport must connect with createAzureTargetClient using `target`.
 * `verified` is an external deployment attestation, not a deployment probe.
 */
export function createForwardExecutor({db,target}) {
  validateTarget(target);
  const files=artifact();
  async function plan(stage) {
    stageFiles(stage,files);
    try {
      await db.query('begin read only');
      await db.query("set local statement_timeout='15000ms'");
      const result=await inspect(db,stage,files);
      await db.query('rollback');
      Object.freeze(result.files); Object.freeze(result.sourceHashes); Object.freeze(result.azureHashes);
      Object.freeze(result); return result;
    } catch(error) {
      try { await db.query('rollback'); } catch {}
      if(error instanceof Error && /^(Invalid forward phase|Unexpected database target|Unrecognized imported baseline|Unable to inspect schema|Invalid forward receipt|Forward receipt mismatch|Unexpected existing schema|Unexpected schema boundary|Expansion receipt required|Existing teaching permissions incompatible with old application|Built-in role protection unavailable|Invalid role definitions|Required built-in role missing|Invalid activated teaching permissions|Role permissions changed during expansion|Forward postcondition failed)$/.test(error.message)) throw error;
      throw safeError(error);
    }
  }
  async function apply(stage, reviewedPlan, evidence) {
    const deploymentSha=stage==='activate' ? checkDeployment(evidence) : null;
    stageFiles(stage,files);
    if(!reviewedPlan || typeof reviewedPlan !== 'object' || reviewedPlan.phase!==stage || !Array.isArray(reviewedPlan.files) || !Array.isArray(reviewedPlan.sourceHashes) || !Array.isArray(reviewedPlan.azureHashes)) fail('Reviewed plan required');
    try {
      await db.query('begin');
      await db.query("set local lock_timeout='5000ms'");
      await db.query("set local statement_timeout='120000ms'");
      await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
      await db.query('lock table public.role_definitions in share mode');
      const current=await inspect(db,stage,files);
      if(JSON.stringify(current)!==JSON.stringify(reviewedPlan)) fail('Reviewed plan changed');
      if(current.action==='noop') {
        if(stage==='activate' && current.deploymentSha!==deploymentSha) fail('Activation deployment mismatch');
        await db.query('commit'); return {phase:stage,action:'noop',receiptCount:current.receiptCount};
      }
      if(stage==='schema') await db.query(`create table academy_private.canvas_forward_receipts (
        filename text primary key, source_sha256 text not null, azure_sha256 text not null,
        deployment_sha text, applied_at timestamptz not null default now()
      ); alter table academy_private.canvas_forward_receipts enable row level security;
      revoke all on academy_private.canvas_forward_receipts from public, anon, authenticated, service_role`);
      for(const file of stageFiles(stage,files)) await db.query(file.sql);
      const afterRoles=await inspectRoles(db,stage==='activate');
      if(stage==='schema' && (afterRoles.roleDigest!==current.roleDigest || afterRoles.roleCount!==current.roleCount)) fail('Role permissions changed during expansion');
      for(const file of stageFiles(stage,files)) {
        await db.query('insert into academy_private.canvas_forward_receipts(filename,source_sha256,azure_sha256,deployment_sha) values($1,$2,$3,$4)',[file.file,file.sourceSha256,file.azureSha256,deploymentSha]);
      }
      const after=await inspect(db,stage,files);
      if(after.action!=='noop' || after.receiptCount!==(stage==='schema'?2:3)) fail('Forward postcondition failed');
      if(stage==='schema' && (after.roleDigest!==current.roleDigest || after.roleCount!==current.roleCount)) fail('Role permissions changed during expansion');
      await db.query("notify pgrst, 'reload schema'");
      await db.query('commit');
      return {phase:stage,action:'applied',receiptCount:stage==='schema'?2:3};
    } catch(error) {
      try { await db.query('rollback'); } catch {}
      if(error instanceof Error && /^(Reviewed plan changed|Activation deployment mismatch|Unexpected database target|Unrecognized imported baseline|Unable to inspect schema|Invalid forward receipt|Forward receipt mismatch|Unexpected existing schema|Unexpected schema boundary|Expansion receipt required|Existing teaching permissions incompatible with old application|Built-in role protection unavailable|Invalid role definitions|Required built-in role missing|Invalid activated teaching permissions|Role permissions changed during expansion|Forward postcondition failed)$/.test(error.message)) throw error;
      throw safeError(error);
    }
  }
  return {plan,apply};
}
