// Actual practice renderer payloads through the real check endpoint; no request DTO mocks.
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readLocalManifest} from './manifest.mjs';
import {createStudioFixtureClient} from '../../../scripts/lib/studio-postgres-fixture.mjs';
const m=readLocalManifest(process.argv[2]),pr=m.quizUploadFixture?.practiceLocator;
if(!pr||process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Compiled practice fixture and trusted local browser required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Nonlocal browser refused');
const b=await chromium.connectOverCDP(endpoint.href),c=await b.newContext({viewport:{width:1440,height:1000},locale:'en-US',ignoreHTTPSErrors:false});
await c.route('**/*',r=>[m.appOrigin,m.dataOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
const actor=m.actors.learner;await c.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:m.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:m.appOrigin}]);
const p=await c.newPage(),errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));
const db=createStudioFixtureClient(m.postgres);await db.connect();
const finish=process.argv.includes('--finish');
if(finish){const row=(await db.query('select grading from public.course_version_items where version_id=$1 and item_id=$2',[m.quizUploadFixture.versionId,pr.itemId])).rows[0];expect(row.grading.quizzes[pr.quizId]).toMatchObject({mode:'practice',feedback:'per_question',required:true,passPercent:0});}
const attempts=async()=>Number((await db.query('select count(*)::int n from public.quiz_attempts where user_id=$1 and course_version_id=$2',[actor.userId,m.quizUploadFixture.versionId])).rows[0].n);
const before=await attempts();
async function check(id,answer){
 const field=p.locator(`fieldset[data-question-id="${id}"]`);const actions=field.locator('xpath=following-sibling::div[1]');
 const pending=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/quizzes/check'&&r.request().method()==='POST');
 await actions.getByRole('button',{name:'Check answer',exact:true}).click();const response=await pending;
 expect(response.status(),await response.text()).toBe(200);const dto=response.request().postDataJSON();
 expect(dto).toMatchObject({courseId:pr.courseId,itemId:pr.itemId,quizId:pr.quizId,questionId:id});
 expect(Object.hasOwn(dto,'answer')).toBe(true);expect(dto.answer).toEqual(answer);
 await expect(actions.getByRole('button',{name:'Try again',exact:true})).toBeVisible();checks.push({questionId:id,answerType:Array.isArray(dto.answer)?'array':dto.answer===null?'null':typeof dto.answer,answer:dto.answer,status:response.status()});
 return{field,actions,retry:()=>actions.getByRole('button',{name:'Try again',exact:true}).click()};
}
try{
 await p.goto(`${m.appOrigin}/app/courses/${pr.courseId}/items/${pr.itemId}`,{waitUntil:'domcontentloaded'});await p.waitForLoadState('networkidle',{timeout:30000});
 const practiceRegion=p.locator(`fieldset[data-question-id="${pr.questionIds.matching}"]`).locator('xpath=ancestor::section[@role="region"][1]');
 for(let retry=0;retry<30&&await practiceRegion.getByRole('button',{name:'Try again',exact:true}).count();retry++)await practiceRegion.getByRole('button',{name:'Try again',exact:true}).first().click();
 await expect(practiceRegion.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 const matching=p.locator(`fieldset[data-question-id="${pr.questionIds.matching}"]`),pdf=matching.getByRole('combobox',{name:'pdf → matches',exact:true});
 await pdf.selectOption({label:'A document'});const one=await check(pr.questionIds.matching,[{left:'l-pdf',right:'r-doc'}]);await one.retry();
 await pdf.selectOption({label:'A document'});await pdf.selectOption('');const cleared=await check(pr.questionIds.matching,[]);await cleared.retry();
 const multi=p.locator(`fieldset[data-question-id="${pr.questionIds.multipleChoice}"]`).getByRole('checkbox',{name:'Branch map',exact:true});const multiLabel=multi.locator('xpath=ancestor::label[1]');await multiLabel.click();await expect(multi).toBeChecked();await multiLabel.click();await expect(multi).not.toBeChecked();await check(pr.questionIds.multipleChoice,[]);
 const numeric=p.locator(`fieldset[data-question-id="${pr.questionIds.numeric}"]`).getByRole('textbox');await numeric.fill('0');const zero=await check(pr.questionIds.numeric,'0');await zero.retry();await numeric.fill('0');await numeric.fill('');await check(pr.questionIds.numeric,'');
 const no=p.locator(`fieldset[data-question-id="${pr.questionIds.trueFalse}"]`).getByRole('radio',{name:'No',exact:true});await no.locator('xpath=ancestor::label[1]').click();await expect(no).toBeChecked();await check(pr.questionIds.trueFalse,false);
 const child=p.locator(`fieldset[data-question-id="${pr.questionIds.groupChild}"]`),two=child.getByRole('radio',{name:'Two',exact:true});await two.locator('xpath=ancestor::label[1]').click();await expect(two).toBeChecked();await check(pr.questionIds.groupChild,'two');
 const order=p.locator(`fieldset[data-question-id^="${pr.quizId}/"]`).filter({has:p.getByRole('list',{name:'Put the authoring steps in order.',exact:true})});
 const orderId=await order.getAttribute('data-question-id');expect(orderId).toBeTruthy();
 const row=(await db.query('select state from public.activity_state where user_id=$1 and course_version_id=$2 and item_id=$3 and block_id=$4',[actor.userId,m.quizUploadFixture.versionId,pr.itemId,pr.quizId])).rows[0];
 expect(row?.state?.answers?.[orderId]).toBeUndefined();
 await order.getByRole('button',{name:'Move down',exact:true}).first().click();
 // The accepted payload comes from the actual move controls; verify complete
 // unique IDs rather than deriving an answer from visual default order alone.
 const actions=order.locator('xpath=following-sibling::div[1]');const pending=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/quizzes/check'&&r.request().method()==='POST');await actions.getByRole('button',{name:'Check answer',exact:true}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);const moved=response.request().postDataJSON();expect(moved.questionId).toBe(orderId);expect(Array.isArray(moved.answer)).toBe(true);expect(moved.answer).toHaveLength(3);expect(new Set(moved.answer).size).toBe(3);checks.push({questionId:orderId,answer:moved.answer,status:response.status(),defaultOrderWasNotPersisted:true});
 await actions.getByRole('button',{name:'Try again',exact:true}).click();await expect(async()=>{const current=(await db.query('select state from public.activity_state where user_id=$1 and course_version_id=$2 and item_id=$3 and block_id=$4',[actor.userId,m.quizUploadFixture.versionId,pr.itemId,pr.quizId])).rows[0];expect(Object.hasOwn(current.state.answers,orderId)).toBe(false);}).toPass({timeout:15000});
 let finishEvidence;
 if(finish){
  const fileInput=practiceRegion.locator('input[type="file"]'),uploadField=fileInput.locator('xpath=ancestor::fieldset[1]'),uploadId=await uploadField.getAttribute('data-question-id');
  const bytes=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n'),name='practice-check-proof.pdf';
  const finalized=p.waitForResponse(r=>/^\/api\/v1\/uploads\/[^/]+\/finalize$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST');await fileInput.setInputFiles({name,mimeType:'application/pdf',buffer:bytes});const ready=await finalized;expect(ready.status(),await ready.text()).toBe(200);
  const link=uploadField.getByRole('link',{name,exact:true});await expect(link).toBeVisible();const href=await link.getAttribute('href'),assetId=href.split('/').at(-1);
  await check(uploadId,{files:[{assetId,name,size:bytes.length,mime:'application/pdf'}]});
  const read=await c.request.get(m.appOrigin+href,{headers:{'accept-encoding':'identity'}});expect(read.status()).toBe(200);expect(createHash('sha256').update(await read.body()).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
 }
 expect(await attempts()).toBe(before);expect(errors).toEqual([]);
 if(finish){
  const pending=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/quizzes/submit'&&r.request().method()==='POST');await practiceRegion.getByRole('button',{name:'Finish practice',exact:true}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);expect(response.request().postDataJSON().quizId).toBe(pr.quizId);
  await expect(async()=>{const state=(await db.query('select completed from public.activity_state where user_id=$1 and course_version_id=$2 and item_id=$3 and block_id=$4',[actor.userId,m.quizUploadFixture.versionId,pr.itemId,pr.quizId])).rows[0];expect(state.completed).toBe(true);}).toPass({timeout:15000});
  expect(await attempts()).toBe(before+1);finishEvidence={explicitAction:true,actualSubmitStatus:200,formalAttemptDelta:1,practiceActivityCompletedByServer:true,wholeLessonCompletionClaimed:false};
 }
 writeFileSync(join(m.runtime,'partial-browser-result.json'),JSON.stringify({mode:m.mode,checks,errors,noAttemptCreatedByCheck:true,orderingClearIsAbsent:true,finishEvidence},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,receipt:join(m.runtime,'partial-browser-result.json')}));
}finally{writeFileSync(join(m.runtime,'partial-browser-observations.json'),JSON.stringify({mode:m.mode,checks,errors},null,2)+'\n',{mode:0o600});await db.end();await c.close();}process.exit(0);
