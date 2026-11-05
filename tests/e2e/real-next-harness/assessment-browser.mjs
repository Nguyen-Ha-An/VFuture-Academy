// Actual production Next UI and HTTP handlers against disposable PG/PostgREST.
// Fault injection drops transport only AFTER a real local commit; no API DTO is mocked.
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocalManifest } from './manifest.mjs';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
const manifest=readLocalManifest(process.argv[2]);
const copy=JSON.parse(readFileSync(new URL('../../../src/messages/en.json',import.meta.url))).exam;
if(manifest.mode!=='production')throw new Error('Actual production fixture required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');
if(!['127.0.0.1','localhost'].includes(endpoint.hostname)||!endpoint.port||process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Lead-owned fixture-trusting loopback browser required');
const browser=await chromium.connectOverCDP(endpoint.href);
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'Asia/Ho_Chi_Minh',ignoreHTTPSErrors:false});
const events=[];let submitPosts=0,committed=false,blockReconciliation=true,observedReconciliationRead=false;
await context.route('**/*',route=>{const url=new URL(route.request().url());return [manifest.appOrigin,manifest.dataOrigin].includes(url.origin)?route.continue():route.abort();});
await context.route('**/api/v1/exams/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.origin!==manifest.appOrigin)return route.abort();
 if(request.method()==='POST'&&url.pathname.endsWith('/submit')){
  submitPosts+=1;
  if(submitPosts>1){expect(observedReconciliationRead,'Never retry a submit before an authoritative session read').toBe(true);return route.continue();}
  const response=await route.fetch();
  expect(response.status(),'Real local submit must commit before dropping its response').toBe(200);
  committed=true;return route.abort('failed');
 }
 if(committed&&blockReconciliation&&request.method()==='GET')return route.abort('failed');
 if(committed&&!blockReconciliation&&request.method()==='GET'&&url.pathname.endsWith('/attempts'))observedReconciliationRead=true;
 return route.continue();
});
const actor=manifest.actors.learner;
await context.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:manifest.appOrigin,httpOnly:true,secure:true,sameSite:'Lax'},{name:'locale',value:'en',url:manifest.appOrigin,secure:true,sameSite:'Lax'}]);
const page=await context.newPage();const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
page.on('response',async response=>{if(new URL(response.url()).pathname.startsWith('/api/v1/exams/')){const event={method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()};events.push(event);try{const payload=await response.json();event.attemptId=payload?.data?.attemptId??payload?.data?.attempt?.attemptId;event.attemptStatus=payload?.data?.status??payload?.data?.attempt?.status;}catch{/* Transport failure remains recorded without a DTO. */}}});
const db=createStudioFixtureClient(manifest.postgres);await db.connect();
try{
 expect((await db.query('select current_database() name')).rows[0].name).toBe('academy_route_fixture');
 await page.goto(`${manifest.appOrigin}/app/courses/${manifest.courseId}/items/${manifest.itemId}`,{waitUntil:'domcontentloaded'});
 const start=page.getByRole('button',{name:'Start exam',exact:true});
 const startNext=page.getByRole('button',{name:copy.review.startNext,exact:true});
 const submitButton=page.getByRole('button',{name:'Submit exam',exact:true});
 // Existing synthetic in-progress attempts resume through the real session GET.
 const entry=start.or(startNext).or(submitButton);
 await expect(entry).toBeVisible({timeout:15000});
 const action=await entry.innerText();
 if(action!=='Submit exam')await start.or(startNext).click();
 await expect(submitButton).toBeVisible({timeout:30000});
 await page.getByRole('combobox',{name:'pdf → matches',exact:true}).selectOption({label:'A document'});
 await page.getByRole('combobox',{name:'audio → matches',exact:true}).selectOption({label:'A sound file'});
 await page.getByRole('textbox',{name:'What did you build?',exact:true}).fill('Synthetic local browser explanation. '.repeat(140));
 await page.getByRole('textbox',{name:'What would you change next time?',exact:true}).fill('Retain and verify the saved response.');
 await page.getByRole('radio',{name:'Two',exact:true}).check();
 await expect(async()=>{
  const rows=(await db.query('select a.question_id,a.answer from public.exam_answers a join public.exam_attempts t on t.id=a.attempt_id where t.user_id=$1 and t.item_id=$2 and t.status=$3',[actor.userId,manifest.itemId,'in_progress'])).rows;
  expect(rows.find(row=>row.question_id==='main/q-match')?.answer).toEqual([{left:'l-pdf',right:'r-doc'},{left:'l-audio',right:'r-sound'}]);
  const essay=rows.find(row=>row.question_id==='main/q-essay')?.answer;expect(Array.isArray(essay)).toBe(true);expect(essay[0].length).toBeGreaterThan(4000);
  expect(rows.find(row=>row.question_id===manifest.groupId)?.answer).toMatchObject({[`${manifest.groupId}/g-single`]:'two'});
 }).toPass({timeout:15000});
 expect(events.some(event=>event.method==='PUT'&&event.status===400),'Actual renderer autosave must not hit the reported400').toBe(false);
 await page.getByRole('button',{name:'Submit exam',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:copy.player.dialogTitle,exact:true});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:copy.player.confirm,exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Check submission status',exact:true})).toBeVisible({timeout:90000});
 expect(committed).toBe(true);expect(submitPosts).toBe(1);
 await expect(dialog.getByRole('button',{name:copy.player.cancel,exact:true})).toBeDisabled();
 blockReconciliation=false;
 await dialog.getByRole('button',{name:'Check submission status',exact:true}).click();
 await expect(dialog).toBeHidden({timeout:30000});
 await expect(page.getByText(copy.review.pendingRelease, {exact:true})).toBeVisible({timeout:30000});
 expect(submitPosts,'One initial request and one idempotent acknowledged retry after the session read').toBe(2);
 const attempts=(await db.query('select id,status from public.exam_attempts where user_id=$1 and item_id=$2 order by attempt_no desc',[actor.userId,manifest.itemId])).rows;
 expect(attempts[0].status).toBe('graded');
 expect(new Set(events.filter(event=>event.method==='POST'&&event.path.endsWith('/submit')).map(event=>event.path)).size).toBeLessThanOrEqual(1);
 expect(pageErrors).toEqual([]);
 const result={kind:'actual-root-production-assessment-ui',passed:true,events,submitPosts,observedReconciliationRead,transportFault:'Actual submit committed; response and reconciliation reads dropped until explicit status check',checks:['Actual matching pair array saved by renderer/autosave','Actual grouped selection saved','Actual essay response over4000characters saved','No autosave400','Unknown submit outcome retains disabled editing','Authoritative session read precedes idempotent same-attempt acknowledgement and restricted-details review'],boundaries:['Synthetic local actor and disposable database only','No real object-storage file bytes or external SSO are exercised']};
 writeFileSync(join(manifest.runtime,'assessment-browser.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({passed:true,receipt:join(manifest.runtime,'assessment-browser.json')}));
}finally{const attempts=(await db.query('select attempt_no,status from public.exam_attempts where user_id=$1 and item_id=$2 order by attempt_no',[actor.userId,manifest.itemId])).rows;writeFileSync(join(manifest.runtime,'assessment-browser-observations.json'),JSON.stringify({events,attempts,submitPosts,committed,blockReconciliation,pageErrors},null,2)+'\n',{mode:0o600});await db.end();await context.close();}
process.exit(0);
