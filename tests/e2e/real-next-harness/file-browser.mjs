// Real renderer -> owned API/service/PG -> bounded local external Storage simulator.
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocalManifest } from './manifest.mjs';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
const manifest=readLocalManifest(process.argv[2]);
if(process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Fixture-trusting owned browser required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');
if(!['127.0.0.1','localhost'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Non-loopback browser refused');
const browser=await chromium.connectOverCDP(endpoint.href);
const actor=manifest.actors.learner,events=[],results=[];
const bytes=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const db=createStudioFixtureClient(manifest.postgres);await db.connect();
expect((await db.query('select current_database() name')).rows[0].name).toBe('academy_route_fixture');
const contexts=[];
async function contextFor(name){
 const c=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'Asia/Ho_Chi_Minh',ignoreHTTPSErrors:false});contexts.push(c);
 await c.route('**/*',r=>[manifest.appOrigin,manifest.dataOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 const user=manifest.actors[name];await c.addCookies([{name:user.cookie.name,value:user.cookie.value,url:manifest.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:manifest.appOrigin}]);return c;
}
async function run(kind){
 const quiz=kind==='quiz'?manifest.quizUploadFixture:null;
 if(kind==='quiz'&&!quiz)throw new Error('Compiler-derived quiz fixture missing');
 const c=await contextFor('learner'),page=await c.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{const u=new URL(response.url());if(u.origin===manifest.appOrigin&&/^\/api\/v1\/(uploads|exams|quizzes|media)\//.test(u.pathname))events.push({kind,method:response.request().method(),path:u.pathname,status:response.status()});});
 const courseId=quiz?.courseId??manifest.courseId,itemId=quiz?.itemId??manifest.itemId;
 await page.goto(`${manifest.appOrigin}/app/courses/${courseId}/items/${itemId}`,{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('networkidle',{timeout:30000});
 if(kind==='exam'){
  const start=page.getByRole('button',{name:'Start exam',exact:true});await expect(start).toBeVisible();await start.click();
  await expect(page.getByRole('button',{name:'Submit exam',exact:true})).toBeVisible();
 }
 const input=quiz?page.locator(`fieldset[data-question-id="${quiz.questionId}"] input[type="file"]`):page.locator('fieldset[data-question-id] input[type="file"]').first();
 await expect(input).toBeEnabled();
 const field=input.locator('xpath=ancestor::fieldset[1]');const rootQuestionId=await field.getAttribute('data-question-id');expect(rootQuestionId).toContain('/');
 const name=`${kind}-browser-proof.pdf`;
 const reserveResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/uploads/reserve'&&r.request().method()==='POST');
 const finalizeResponse=page.waitForResponse(r=>/^\/api\/v1\/uploads\/[^/]+\/finalize$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST',{timeout:30000});
 await input.setInputFiles({name,mimeType:'application/pdf',buffer:bytes});
 const reserved=await reserveResponse;expect(reserved.status(),await reserved.text()).toBe(200);
 const request=reserved.request().postDataJSON();
 expect(request.purpose).toBe('submission');expect(request.rootQuestionId).toBe(rootQuestionId);expect(request.questionId).toBe(rootQuestionId);
 if(quiz){expect(request.quizId).toBe(quiz.quizId);expect(request.examAttemptId).toBeUndefined();}
 else{expect(request.examAttemptId).toMatch(/^[a-f0-9-]{36}$/);expect(request.quizId).toBeUndefined();}
 const finalized=await finalizeResponse;expect(finalized.status(),await finalized.text()).toBe(200);
 const link=field.getByRole('link',{name,exact:true});await expect(link).toBeVisible();expect(await link.getAttribute('target')).toBe('_blank');
 const href=await link.getAttribute('href');expect(href).toMatch(/^\/api\/v1\/media\/asset_[A-Za-z0-9]+$/);
 const assetId=href.split('/').at(-1);
 const table=quiz?'quiz_attachment_bindings':'exam_attachment_bindings';
 const binding=(await db.query(`select b.owner_id,b.root_question_id,b.question_id,r.state,r.request,m.size_bytes,m.mime from public.${table} b join public.media_upload_reservations r on r.id=b.reservation_id join public.media_assets m on m.id=b.asset_id where b.asset_id=$1`,[assetId])).rows[0];
 expect(binding).toMatchObject({owner_id:actor.userId,root_question_id:rootQuestionId,question_id:rootQuestionId,state:'ready',mime:'application/pdf'});expect(Number(binding.size_bytes)).toBe(bytes.length);
 if(!quiz)await expect(async()=>{const rows=(await db.query('select answer from public.exam_answers where attempt_id=$1 and question_id=$2',[request.examAttemptId,rootQuestionId])).rows;expect(rows[0]?.answer?.files?.[0]?.assetId).toBe(assetId);}).toPass({timeout:15000});
 else expect((await db.query('select count(*)::int n from public.quiz_attempts where user_id=$1 and course_version_id=$2',[actor.userId,quiz.versionId])).rows[0].n).toBe(0);
 const popupPromise=c.waitForEvent('page');await link.click();const popup=await popupPromise;await popup.waitForURL(u=>u.origin===manifest.dataOrigin,{timeout:15000});await popup.close();
 const download=await c.request.get(manifest.appOrigin+href,{headers:{accept:'application/pdf','accept-encoding':'identity'}});
 expect(download.status()).toBe(200);expect(sha(await download.body())).toBe(sha(bytes));
 const stranger=await contextFor('other');expect((await stranger.request.get(manifest.appOrigin+href)).status()).toBe(404);
 if(quiz){
  const staff=await contextFor('owner');expect((await staff.request.get(manifest.appOrigin+href)).status()).toBe(404);
  const quizRegion=field.locator('xpath=ancestor::section[@role="region"][1]');
  const submitted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/quizzes/submit'&&r.request().method()==='POST');
  await quizRegion.getByRole('button',{name:'Submit',exact:true}).click();const response=await submitted;expect(response.status(),await response.text()).toBe(200);
  const row=(await db.query('select answers from public.quiz_attempts where user_id=$1 and course_version_id=$2 order by attempt_no desc limit 1',[actor.userId,quiz.versionId])).rows[0];expect(row.answers[rootQuestionId].files[0].assetId).toBe(assetId);
 }else{
  const copy=JSON.parse(readFileSync(new URL('../../../src/messages/en.json',import.meta.url))).exam;
  await page.getByRole('button',{name:copy.player.submit,exact:true}).click();const dialog=page.getByRole('dialog',{name:copy.player.dialogTitle,exact:true});
  const submitted=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/submit')&&r.request().method()==='POST');await dialog.getByRole('button',{name:copy.player.confirm,exact:true}).click();const response=await submitted;expect(response.status(),await response.text()).toBe(200);
  const staff=await contextFor('owner');const staffRead=await staff.request.get(manifest.appOrigin+href,{headers:{'accept-encoding':'identity'}});expect(staffRead.status()).toBe(200);expect(sha(await staffRead.body())).toBe(sha(bytes));
 }
 expect(errors).toEqual([]);results.push({kind,rootQuestionId,requestContext:{quizId:request.quizId,examAttemptPresent:typeof request.examAttemptId==='string'},byteLength:bytes.length,sha256:sha(bytes),bindingReady:true,ownerDownload:true,unrelatedOwnerDenied:true,staff:quiz?'denied':'submitted-reference-authorized',errors});
}
try{for(const kind of ['exam','quiz'])await run(kind);writeFileSync(join(manifest.runtime,'file-browser-result.json'),JSON.stringify({mode:manifest.mode,results,events,boundary:'Storage transport is the bounded local simulator; owned APIs/services/auth/PG/PostgREST and real byte verification are not mocked.'},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,receipt:join(manifest.runtime,'file-browser-result.json')}));}
finally{writeFileSync(join(manifest.runtime,'file-browser-observations.json'),JSON.stringify({mode:manifest.mode,results,events},null,2)+'\n',{mode:0o600});await Promise.all(contexts.map(c=>c.close()));await db.end();}
process.exit(0);
