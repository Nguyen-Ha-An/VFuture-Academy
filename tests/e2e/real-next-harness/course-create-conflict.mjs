// Actual local route + native RPC constraint producer. No mocked HTTP or service.
import { createHash,randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import { readLocalManifest } from './manifest.mjs';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';

const manifest=readLocalManifest(process.argv[2]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const ensure=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
ensure(manifest.actors.owner.userId==='10000000-0000-4000-8000-000000000001','UNEXPECTED_LOCAL_ACTOR');
const id=`routing-create-conflict-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const input={id,title:{vi:'Khóa học tổng hợp cho kiểm tra xung đột',en:'Synthetic creation conflict regression'},languages:['vi','en'],defaultLanguage:'en',pathway:'core-future-skills',level:'foundation'};
const observations={kind:'actual-local-course-create-conflict',passed:false,events:[],courseIdHash:hash(id)};
let db,stage='preflight';
async function post(value,label){
  const endpoint=new URL('/api/v1/studio/courses',manifest.appOrigin);ensure(endpoint.origin==='https://localhost:4452','NONLOCAL_HTTP_REFUSED');
  const result=await new Promise((resolveResponse,reject)=>{
    const cookie=manifest.actors.owner.cookie;
    const req=request(endpoint,{method:'POST',family:4,ca:readFileSync(manifest.ca),signal:AbortSignal.timeout(90000),headers:{'content-type':'application/json',origin:manifest.appOrigin,cookie:`${cookie.name}=${cookie.value}; locale=en`}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{let json;try{json=JSON.parse(Buffer.concat(chunks).toString());}catch{/* Never invent a JSON success response. */}resolveResponse({status:response.statusCode,json});});});
    req.on('error',reject);req.end(JSON.stringify(value));
  });
  observations.events.push({step:label,method:'POST',path:'/api/v1/studio/courses',status:result.status,code:typeof result.json?.error?.code==='string'?result.json.error.code:null});
  return result;
}
async function snapshot(courseId){
  const courses=(await db.query('select to_jsonb(c) as row from public.courses c where id=$1',[courseId])).rows;
  const drafts=(await db.query('select to_jsonb(d) as row from public.course_drafts d where course_id=$1 order by id',[courseId])).rows;
  return{courseCount:courses.length,draftCount:drafts.length,courseSha256:hash(JSON.stringify(courses)),draftSha256:hash(JSON.stringify(drafts))};
}
try{
  db=createStudioFixtureClient(manifest.postgres);await db.connect();
  ensure((await db.query('select current_database() name')).rows[0].name==='academy_route_fixture','NONFIXTURE_DATABASE');
  ensure((await db.query('show listen_addresses')).rows[0].listen_addresses==='','DATABASE_TCP_NOT_DISABLED');
  ensure(/^17\d{4}$/.test((await db.query("select current_setting('server_version_num') version")).rows[0].version),'NATIVE_PG17_REQUIRED');
  stage='first_create';const first=await post(input,'first_create');ensure(first.status===200&&first.json?.data?.course?.id===id,'FIRST_CREATE_NOT_CONFIRMED');
  const initial=(await db.query('select manifest from public.course_drafts where course_id=$1',[id])).rows[0];ensure(initial?.manifest?.id===id,'CREATED_DRAFT_MISSING');
  const before=await snapshot(id);ensure(before.courseCount===1&&before.draftCount===1,'NONATOMIC_FIRST_CREATE');observations.before=before;
  stage='native_constraint';
  let native;
  try{await db.query('select public.studio_create_course($1,$2,$3)',[id,manifest.actors.owner.userId,initial.manifest]);}
  catch(error){native={code:error.code,schema:error.schema,table:error.table,constraint:error.constraint};}
  ensure(native?.code==='23505'&&native.schema==='public'&&native.table==='courses'&&native.constraint==='courses_pkey','UNEXPECTED_NATIVE_CONFLICT');
  observations.nativeError=native;
  stage='duplicate_api';const duplicate=await post(input,'duplicate_same_id');
  ensure(duplicate.status===409&&duplicate.json?.error?.code==='COURSE_EXISTS','DUPLICATE_NOT_COURSE_EXISTS_409');
  ensure(JSON.stringify(await snapshot(id))===JSON.stringify(before),'DUPLICATE_CHANGED_EXISTING_COURSE_OR_DRAFT');
  stage='new_id_retry';const retry={...input,id:`${id}-retry`};const created=await post(retry,'retained_values_new_id_retry');
  ensure(created.status===200&&created.json?.data?.course?.id===retry.id,'RETRY_CREATE_NOT_CONFIRMED');
  const stored=(await db.query('select manifest from public.course_drafts where course_id=$1',[retry.id])).rows[0]?.manifest;
  ensure(stored?.id===retry.id&&JSON.stringify(stored.title)===JSON.stringify(initial.manifest.title)&&JSON.stringify(stored.languages)===JSON.stringify(input.languages)&&stored.defaultLanguage===input.defaultLanguage&&stored.pathway===input.pathway&&stored.level===input.level,'RETRY_LOST_CREATION_VALUES');
  ensure(JSON.stringify(await snapshot(id))===JSON.stringify(before),'RETRY_CHANGED_ORIGINAL_COURSE');
  observations.passed=true;observations.after=await snapshot(id);observations.retryCourseIdHash=hash(retry.id);observations.retryPreservedBilingualMetadata=true;
  const receipt=join(manifest.runtime,'course-create-conflict-result.json');writeFileSync(receipt,JSON.stringify(observations,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,receipt}));
}catch(error){observations.failedStage=stage;observations.failureCode=typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'COURSE_CREATE_CONFLICT_FAILED';console.error(JSON.stringify({passed:false,stage,code:observations.failureCode}));process.exitCode=1;}
finally{writeFileSync(join(manifest.runtime,'course-create-conflict-observations.json'),JSON.stringify(observations,null,2)+'\n',{mode:0o600});await db?.end();}
