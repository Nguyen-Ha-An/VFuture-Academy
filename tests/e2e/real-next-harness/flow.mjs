// Actual HTTP route handlers + actual TLS/PostgREST/native PG; no HTTP route mocking.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:https';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
import { readLocalManifest } from './manifest.mjs';
const manifest=readLocalManifest(process.argv[2]);
const ca=readFileSync(manifest.ca),events=[];
async function call(actor,path,{method='GET',body}={}){
  const url=new URL(path,manifest.appOrigin);assert.equal(url.origin,manifest.appOrigin);
  const cookie=manifest.actors[actor]?.cookie;
  return new Promise((resolveResponse,reject)=>{
    const req=request(url,{method,family:4,ca,headers:{cookie:cookie?`${cookie.name}=${cookie.value}; locale=en`:'locale=en',...(['GET','HEAD'].includes(method)?{}:{origin:manifest.appOrigin}),...(body===undefined?{}:{'content-type':'application/json'})}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const text=Buffer.concat(chunks).toString();let json;try{json=JSON.parse(text);}catch{/* SSR HTML is intentionally not JSON. */}events.push({actor,path,method,status:response.statusCode,code:json?.error?.code});resolveResponse({status:response.statusCode,headers:response.headers,text,json});});
    });req.on('error',reject);req.setTimeout(90000,()=>req.destroy(new Error('Local actual route timed out')));if(body!==undefined)req.write(JSON.stringify(body));req.end();
  });
}
const db=createStudioFixtureClient(manifest.postgres);await db.connect();
try{
  assert.equal((await db.query('select current_database() as name')).rows[0].name,'academy_route_fixture');
  assert.equal((await db.query('show listen_addresses')).rows[0].listen_addresses,'');
  const session=await call('learner','/api/v1/auth/session');assert.equal(session.status,200,session.text);assert.equal(session.json.userId,manifest.actors.learner.userId);
  const profile=await call('learner','/api/v1/profile',{method:'PATCH',body:{profilePublic:true}});assert.equal(profile.status,200,profile.text);assert.equal(profile.json.data.profilePublic,true);
  const profiles=(await db.query('select id,profile_public from public.profiles where id=any($1::uuid[])',[[manifest.actors.learner.userId,manifest.actors.other.userId]])).rows;
  assert.equal(profiles.find(row=>row.id===manifest.actors.learner.userId).profile_public,true);assert.equal(profiles.find(row=>row.id===manifest.actors.other.userId).profile_public,false);
  const course=await call('learner',`/app/courses/${manifest.courseId}`);assert.equal(course.status,200);
  const headings=[...course.text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match=>match[1].replace(/<[^>]*>/g,''));
  assert.ok(headings.some(heading=>heading.includes('Routing fixture course')),'Actual rendered course h1, not just serialized props');
  assert.ok(course.text.includes(`href="/app/courses/${manifest.courseId}/items/${manifest.itemId}`),'Actual exam navigation link');assert.ok(course.headers['content-security-policy']);
  const startPath=`/api/v1/exams/${manifest.itemId}/attempts`;
  const started=await call('learner',startPath,{method:'POST',body:{courseId:manifest.courseId}});assert.equal(started.status,200,started.text);
  const attempt=started.json.data.attemptId;assert.match(attempt,/^[a-f0-9-]{36}$/);
  const answerPath=`/api/v1/exams/attempts/${attempt}/answers`;
  const saved=await call('learner',answerPath,{method:'PUT',body:{answers:manifest.answers}});assert.equal(saved.status,200,saved.text);
  const rows=Object.fromEntries(saved.json.data.map(row=>[row.questionId,row.answer]));for(const [id,answer] of Object.entries(manifest.answers))assert.deepEqual(rows[id],answer);
  const cleared={'main/q-match':[],'main/q-essay':'','main/q-upload':{links:[]},[manifest.groupId]:{}};
  const clear=await call('learner',answerPath,{method:'PUT',body:{answers:cleared}});assert.equal(clear.status,200,clear.text);
  const clearedRows=Object.fromEntries(clear.json.data.map(row=>[row.questionId,row.answer]));for(const [id,answer] of Object.entries(cleared))assert.deepEqual(clearedRows[id],answer);
  const wrong=await call('other',answerPath,{method:'PUT',body:{answers:manifest.answers}});assert.equal(wrong.status,403,wrong.text);assert.equal(wrong.json.error.code,'FORBIDDEN');
  const suspended=await call('suspended',startPath,{method:'POST',body:{courseId:manifest.courseId}});assert.equal(suspended.status,403,suspended.text);assert.equal(suspended.json.error.code,'MEMBERSHIP_SUSPENDED');
  const expired=await call('expired',startPath,{method:'POST',body:{courseId:manifest.courseId}});assert.equal(expired.status,401,expired.text);assert.equal(expired.json.error.code,'UNAUTHENTICATED');
  await db.query('update public.academy_runtime_limits set new_exam_starts_paused=true where singleton');
  try{const paused=await call('other',startPath,{method:'POST',body:{courseId:manifest.courseId}});assert.equal(paused.status,503,paused.text);assert.equal(paused.json.error.code,'EXAM_STARTS_PAUSED');assert.equal(paused.headers['retry-after'],'60');}finally{await db.query('update public.academy_runtime_limits set new_exam_starts_paused=false where singleton');}
  const retried=await call('other',startPath,{method:'POST',body:{courseId:manifest.courseId}});assert.equal(retried.status,200,retried.text);
  const restored=await call('learner',answerPath,{method:'PUT',body:{answers:manifest.answers}});assert.equal(restored.status,200,restored.text);
  const submitted=await call('learner',`/api/v1/exams/attempts/${attempt}/submit`,{method:'POST'});assert.equal(submitted.status,200,submitted.text);
  const review=await call('learner',`/api/v1/exams/attempts/${attempt}/review`);assert.equal(review.status,200,review.text);assert.equal(review.json.data.attemptId,attempt);for(const [id,answer] of Object.entries(manifest.answers))assert.deepEqual(review.json.data.answers[id],answer);
  const locked=await call('learner',answerPath,{method:'PUT',body:{answers:cleared}});assert.equal(locked.status,409,locked.text);assert.equal(locked.json.error.code,'ATTEMPT_NOT_ACTIVE');
  const stored=(await db.query('select question_id,answer from public.exam_answers where attempt_id=$1',[attempt])).rows;for(const [id,answer] of Object.entries(manifest.answers))assert.deepEqual(stored.find(row=>row.question_id===id).answer,answer);
  const result={kind:'real-next-local-http-flow',events,attemptId:attempt,questionTypes:manifest.questionTypes,checks:['actual server session RPC','actual authenticated AzureDataClient profile write and unchanged other profile','actual root SSR course content and CSP','exam start/save matching,group,link,long-text and explicit clear','wrong owner403','suspended school membership403','expired session401','realSQL pause503+Retry-After+retry','submit/review and immutable submitted answers'],boundaries:manifest.boundaries};
  writeFileSync(join(manifest.runtime,'http-flow-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'local_http_flow_passed',receipt:join(manifest.runtime,'http-flow-result.json')}));
}finally{await db.end();}
