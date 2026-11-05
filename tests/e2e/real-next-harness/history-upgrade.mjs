// Explicit local publication + actual owned migration/history/media/finalize HTTP proof.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync } from 'node:fs';
import { request } from 'node:https';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
import { readLocalManifest } from './manifest.mjs';

const manifest=readLocalManifest(process.argv[2]);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const ensure=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
ensure(manifest.courseId==='academy-route-fixture'&&manifest.itemId==='exam-routing'&&manifest.versionId==='20000000-0000-4000-8000-000000000001','UNEXPECTED_BASE_FIXTURE');
ensure(manifest.actors.learner.userId==='10000000-0000-4000-8000-000000000002'&&manifest.actors.owner.userId==='10000000-0000-4000-8000-000000000001','UNEXPECTED_FIXTURE_ACTORS');
ensure(!process.argv.includes('--record-manifest')||resolve(process.argv[2])===join(resolve(manifest.runtime),'manifest.json'),'UNOWNED_MANIFEST_WRITE');
const v2='20000000-0000-4000-8000-000000000002';
const events=[],observations={kind:'real-local-exam-history-upgrade',passed:false,events,boundary:'Existing bounded local Storage simulator; actual root APIs, auth, services, PostgreSQL/PostgREST, migration and byte hashes. Not hosted Storage acceptance.'};
let stage='preflight',db;
function codeOf(json){const value=json?.error?.code;return typeof value==='string'&&/^[A-Z0-9_-]{1,80}$/.test(value)?value:null;}
async function call(actor,url,{method='GET'}={}){
  const endpoint=new URL(url,manifest.appOrigin);
  ensure([manifest.appOrigin,manifest.dataOrigin].includes(endpoint.origin)&&!endpoint.username&&!endpoint.password&&!endpoint.hash,'NONLOCAL_HTTP_REFUSED');
  return new Promise((resolveResponse,reject)=>{
    const cookie=manifest.actors[actor].cookie;
    const req=request(endpoint,{method,family:4,ca:readFileSync(manifest.ca),signal:AbortSignal.timeout(90000),headers:{accept:'application/json','accept-encoding':'identity',...(endpoint.origin===manifest.appOrigin?{cookie:`${cookie.name}=${cookie.value}; locale=en`}:{}),...(method==='POST'?{origin:manifest.appOrigin}:{})}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{const bytes=Buffer.concat(chunks);let json;try{json=JSON.parse(bytes.toString());}catch{/* Real media/HTML bodies are not replaced or persisted. */}resolveResponse({status:response.statusCode,headers:response.headers,bytes,json});});
    });req.on('error',reject);req.end();
  });
}
async function checked(actor,url,status,label,options){
  const result=await call(actor,url,options);events.push({step:label,actor,method:options?.method??'GET',status:result.status,code:codeOf(result.json)});ensure(result.status===status,`HTTP_${label.toUpperCase()}_STATUS`);return result;
}
async function media(actor,path,label,expected){
  let endpoint=new URL(path,manifest.appOrigin);
  for(let redirects=0;redirects<5;redirects++){
    const result=await call(actor,endpoint);
    if(result.status>=300&&result.status<400){ensure(typeof result.headers.location==='string','MEDIA_REDIRECT_MISSING');endpoint=new URL(result.headers.location,endpoint);ensure([manifest.appOrigin,manifest.dataOrigin].includes(endpoint.origin),'NONLOCAL_MEDIA_REDIRECT');continue;}
    const digest=hash(result.bytes);events.push({step:label,actor,method:'GET',status:result.status,byteLength:result.bytes.length,sha256:digest});
    ensure(result.status===200&&digest===expected.checksum&&result.bytes.length===Number(expected.size_bytes),`MEDIA_${label.toUpperCase()}_BYTES`);return{status:200,sha256:digest,byteLength:result.bytes.length};
  }throw Object.assign(new Error('MEDIA_REDIRECT_LIMIT'),{code:'MEDIA_REDIRECT_LIMIT'});
}
function referencesFile(value,assetId){
  if(Array.isArray(value))return value.some(entry=>referencesFile(entry,assetId));
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value.files)&&value.files.some(file=>file&&file.assetId===assetId))return true;
  return Object.entries(value).some(([key,entry])=>key!=='files'&&referencesFile(entry,assetId));
}
async function snapshot(selected){
  const result={};
  for(const [key,sql,args] of [
    ['version','select to_jsonb(t) as row from public.course_versions t where id=$1',[manifest.versionId]],
    ['outline','select to_jsonb(t) as row from public.course_version_outline t where version_id=$1',[manifest.versionId]],
    ['items','select to_jsonb(t) as row from public.course_version_items t where version_id=$1 order by item_id',[manifest.versionId]],
    ['renders','select to_jsonb(t) as row from public.course_version_item_renders t where version_id=$1 order by item_id,locale',[manifest.versionId]],
    ['attempt','select to_jsonb(t) as row from public.exam_attempts t where id=$1',[selected.attempt_id]],
    ['answers','select to_jsonb(t) as row from public.exam_answers t where attempt_id=$1 order by question_id',[selected.attempt_id]],
    ['bindings','select to_jsonb(t) as row from public.exam_attachment_bindings t where attempt_id=$1 order by asset_id',[selected.attempt_id]],
  ])result[key]=hash(JSON.stringify((await db.query(sql,args)).rows));
  result.counts=(await db.query('select (select count(*)::int from public.exam_attempts) as attempts,(select count(*)::int from public.exam_attachment_bindings) as bindings,(select count(*)::int from public.media_upload_reservations) as reservations,(select count(*)::int from public.media_assets) as assets')).rows[0];
  return result;
}
try{
  db=createStudioFixtureClient(manifest.postgres);await db.connect();
  ensure((await db.query('select current_database() name')).rows[0].name==='academy_route_fixture','NONFIXTURE_DATABASE');
  ensure((await db.query('show listen_addresses')).rows[0].listen_addresses==='','DATABASE_TCP_NOT_DISABLED');
  ensure(/^17\d{4}$/.test((await db.query("select current_setting('server_version_num') version")).rows[0].version),'NATIVE_PG17_REQUIRED');
  const proof=JSON.parse(readFileSync(join(manifest.runtime,'file-browser-result.json'),'utf8'));
  const fileProof=proof.results?.find(row=>row.kind==='exam');ensure(fileProof?.ownerDownload===true&&/^[a-f0-9]{64}$/.test(fileProof.sha256),'REAL_FILE_BROWSER_PROOF_REQUIRED');
  const candidates=(await db.query(`select a.id attempt_id,a.course_version_id,a.item_id,a.status,a.branch_id,a.branch_scope_known,b.asset_id,b.reservation_id,b.root_question_id,b.question_id,r.checksum,r.size_bytes,r.request->>'examAttemptId' request_attempt,m.bucket
    from public.exam_attachment_bindings b join public.exam_attempts a on a.id=b.attempt_id
    join public.media_upload_reservations r on r.id=b.reservation_id join public.media_assets m on m.id=b.asset_id
    where a.user_id=$1 and b.owner_id=$1 and r.owner_id=$1 and a.course_version_id=$2 and a.item_id=$3
      and a.status in ('graded','pending_manual','expired') and r.state='ready' and r.filename='exam-browser-proof.pdf' and r.asset_id=b.asset_id
    order by a.submitted_at desc nulls last,r.created_at desc limit 1`,[manifest.actors.learner.userId,manifest.versionId,manifest.itemId])).rows;
  ensure(candidates.length===1,'TERMINAL_BOUND_FILE_REQUIRED');const selected=candidates[0];
  ensure(selected.request_attempt===selected.attempt_id&&selected.bucket==='submissions'&&selected.checksum===fileProof.sha256&&Number(selected.size_bytes)===fileProof.byteLength&&selected.root_question_id===fileProof.rootQuestionId,'BOUND_FILE_PROVENANCE_MISMATCH');
  ensure((await db.query('select count(*)::int n from public.lesson_progress where user_id=$1 and course_version_id=$2',[manifest.actors.learner.userId,manifest.versionId])).rows[0].n===0,'GUARDED_MIGRATION_WOULD_SKIP_REMOVED_PROGRESS');
  const enrollment=(await db.query("select course_version_id,branch_id,branch_scope_known from public.enrollments where user_id=$1 and course_id=$2 and status='active'",[manifest.actors.learner.userId,manifest.courseId])).rows[0];ensure(enrollment?.course_version_id===manifest.versionId,'LEARNER_NOT_ON_V1');
  const before=await snapshot(selected);
  observations.selected={attemptHash:hash(selected.attempt_id),assetHash:hash(selected.asset_id),reservationHash:hash(selected.reservation_id),terminalStatus:selected.status,originalBranchHash:selected.branch_id===null?null:hash(selected.branch_id),originalBranchKnown:selected.branch_scope_known,byteLength:Number(selected.size_bytes),sha256:selected.checksum};
  observations.before=before;
  stage='compile_v2';
  const bundle=join(manifest.runtime,'compiled-upgrade-seed.mjs');await build({entryPoints:[join(root,'tests/e2e/real-next-harness/compile-seed.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',absWorkingDir:root,logLevel:'silent'});
  const {compileRoutingUpgradeSeed}=await import(pathToFileURL(bundle).href);const seed=await compileRoutingUpgradeSeed();const c=seed.compiled;
  ensure(c.courseId===manifest.courseId&&seed.removedItemId===manifest.itemId&&!Object.hasOwn(c.items,manifest.itemId),'INVALID_UPGRADE_COMPILATION');
  stage='publish_local_v2';await db.query('begin');
  try{
    const course=(await db.query('select current_version_id from public.courses where id=$1 for update',[manifest.courseId])).rows[0];ensure(course?.current_version_id===manifest.versionId,'CURRENT_PUBLICATION_NOT_V1');
    ensure((await db.query('select count(*)::int n from public.course_versions where course_id=$1 and version=2',[manifest.courseId])).rows[0].n===0,'V2_ALREADY_EXISTS');
    ensure((await db.query('select count(*)::int n from public.course_versions where id=$1',[v2])).rows[0].n===0,'V2_UUID_ALREADY_EXISTS');
    await db.query('insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,$2,2,$3,$4,$5,$6)',[v2,c.courseId,seed.workspace.manifest,c.checksum,{courseId:c.courseId,checksum:c.checksum,meta:c.meta,outline:c.outline,languages:c.languages,defaultLanguage:c.defaultLanguage},manifest.actors.owner.userId]);
    await db.query('insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[v2,c.courseId,c.outline,c.meta,c.access,c.completion,JSON.stringify(c.skills),c.languages,c.defaultLanguage]);
    for(const item of Object.values(c.items)){
      await db.query('insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values($1,$2,$3,$4,$5,$6)',[v2,item.id,item.kind,seed.workspace.items[item.id],item.grading,item.checksum]);
      for(const [locale,payload]of Object.entries(item.renders))await db.query('insert into public.course_version_item_renders(version_id,item_id,locale,payload) values($1,$2,$3,$4)',[v2,item.id,locale,payload]);
    }
    await db.query('update public.courses set current_version_id=$2 where id=$1',[c.courseId,v2]);await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  stage='owned_bulk_migration';
  const migration=await checked('owner',`/api/v1/studio/courses/${manifest.courseId}/enrollments/migrate`,200,'bulk_migration',{method:'POST'});
  ensure(Array.isArray(migration.json?.data?.migrated)&&Array.isArray(migration.json?.data?.skipped),'INVALID_MIGRATION_ENVELOPE');
  observations.migration={migratedCount:migration.json.data.migrated.length,skippedCount:migration.json.data.skipped.length,skippedReasons:migration.json.data.skipped.map(row=>typeof row.reason==='string'&&/^[A-Z_]+$/.test(row.reason)?row.reason:'UNCLASSIFIED'),learnerMigrated:migration.json.data.migrated.includes(manifest.actors.learner.userId),contract:'Actual course-wide migration API; all eligible active fixture enrollments may migrate.'};
  ensure(observations.migration.learnerMigrated,'LEARNER_MIGRATION_NOT_CONFIRMED');
  const upgraded=(await db.query('select course_version_id,branch_id,branch_scope_known from public.enrollments where user_id=$1 and course_id=$2',[manifest.actors.learner.userId,manifest.courseId])).rows[0];
  ensure(upgraded?.course_version_id===v2&&upgraded.branch_id===enrollment.branch_id&&upgraded.branch_scope_known===enrollment.branch_scope_known,'UPGRADE_PIN_OR_ORIGINAL_BRANCH_CHANGED');
  stage='current_and_historical_routes';
  await checked('learner',`/api/v1/courses/${manifest.courseId}/items/${manifest.itemId}?locale=en`,404,'current_old_item');
  const current=await checked('learner',`/api/v1/courses/${manifest.courseId}/items/${seed.replacementItemId}?locale=en`,200,'current_new_lesson');
  ensure(current.json?.data?.courseVersionId===v2&&current.json.data.item?.kind==='lesson'&&current.json.data.item.id===seed.replacementItemId,'NEW_LESSON_NOT_V2');
  const historyPath=`/api/v1/exams/attempts/${selected.attempt_id}/historical-review?courseId=${encodeURIComponent(manifest.courseId)}&itemId=${encodeURIComponent(manifest.itemId)}`;
  const historical=await checked('learner',historyPath,200,'dedicated_history');
  ensure(historical.json?.data?.learner?.id===manifest.itemId&&historical.json.data.review?.attemptId===selected.attempt_id&&referencesFile(historical.json.data.review.answers,selected.asset_id),'PINNED_HISTORY_OR_FILE_REFERENCE_LOST');
  const ordinary=`/api/v1/media/${selected.asset_id}`;
  const historicalMedia=`${ordinary}?historicalExamAttemptId=${encodeURIComponent(selected.attempt_id)}&courseId=${encodeURIComponent(manifest.courseId)}&itemId=${encodeURIComponent(manifest.itemId)}`;
  observations.ownerHistoricalBytes=await media('learner',historicalMedia,'owner_historical',selected);
  observations.authorizedGraderBytes=await media('owner',ordinary,'authorized_grader',selected);
  await checked('other',ordinary,404,'other_owner_ordinary_media');await checked('other',historicalMedia,404,'other_owner_historical_media');
  stage='bound_ready_replay';
  const replay=await checked('learner',`/api/v1/uploads/${selected.reservation_id}/finalize`,200,'bound_ready_finalize',{method:'POST'});ensure(replay.json?.data?.assetId===selected.asset_id,'READY_REPLAY_CHANGED_ASSET');
  const after=await snapshot(selected);observations.after=after;
  ensure(JSON.stringify(before)===JSON.stringify(after),'IMMUTABLE_HISTORY_OR_BINDING_COUNTS_CHANGED');
  observations.passed=true;observations.currentVersion=2;observations.originalVersion=1;observations.oldItemRemoved=true;observations.readyReplayNoNewBindingOrAttempt=true;
  writeFileSync(join(manifest.runtime,'history-upgrade-result.json'),JSON.stringify(observations,null,2)+'\n',{mode:0o600});
  if(process.argv.includes('--record-manifest')){
    const next={...manifest,historyUpgrade:{kind:'explicit-real-local-history-proof',receipt:join(manifest.runtime,'history-upgrade-result.json'),originalVersion:1,currentVersion:2,removedItemId:manifest.itemId,replacementItemId:seed.replacementItemId,checksum:c.checksum}};
    const file=resolve(process.argv[2]),temp=file+'.history.tmp';writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);
  }
  console.log(JSON.stringify({passed:true,receipt:join(manifest.runtime,'history-upgrade-result.json'),migratedCount:observations.migration.migratedCount,skippedCount:observations.migration.skippedCount}));
}catch(error){observations.failedStage=stage;observations.failureCode=typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'HISTORY_UPGRADE_FAILED';console.error(JSON.stringify({passed:false,stage,code:observations.failureCode}));process.exitCode=1;}
finally{writeFileSync(join(manifest.runtime,'history-upgrade-observations.json'),JSON.stringify(observations,null,2)+'\n',{mode:0o600});await db?.end();}
