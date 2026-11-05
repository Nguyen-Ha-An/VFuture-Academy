// Hold real Storage completion, then submit at the first enabled UI opportunity.
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readLocalManifest} from './manifest.mjs';
import {createStudioFixtureClient} from '../../../scripts/lib/studio-postgres-fixture.mjs';
const m=readLocalManifest(process.argv[2]),q=m.quizUploadFixture;
if(!q||process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Owned compiled fixture required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Nonlocal browser refused');
const b=await chromium.connectOverCDP(endpoint.href),c=await b.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:false});
await c.route('**/*',r=>[m.appOrigin,m.dataOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
let release,held=false,released=false;const barrier=new Promise(resolve=>{release=resolve;});
await c.route('**/storage/v1/object/upload/sign/**',async route=>{if(route.request().method()==='PUT'){held=true;await barrier;}await route.continue();});
const actor=m.actors.learner;await c.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:m.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:m.appOrigin}]);
const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
const db=createStudioFixtureClient(m.postgres);await db.connect();let result;
try{
 expect((await db.query('select current_database() name')).rows[0].name).toBe('academy_route_fixture');
 await p.goto(`${m.appOrigin}/app/courses/${q.courseId}/items/${q.itemId}`,{waitUntil:'domcontentloaded'});await p.waitForLoadState('networkidle',{timeout:30000});
 const field=p.locator(`fieldset[data-question-id="${q.questionId}"]`),region=field.locator('xpath=ancestor::section[@role="region"][1]');
 if(await region.getByRole('button',{name:'Try again',exact:true}).count())await region.getByRole('button',{name:'Try again',exact:true}).click();
 const submit=region.getByRole('button',{name:'Submit',exact:true});await expect(submit).toBeEnabled();
 const input=field.locator('input[type="file"]');await input.setInputFiles({name:'quiz-pending-commit-proof.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')});
 await expect.poll(()=>held).toBe(true);await expect(submit).toBeDisabled();
 const siblingValue='Sibling retained during upload';
 const sibling=region.getByRole('textbox',{name:'What is the smallest chunk of text a model reads?',exact:true});await sibling.fill(siblingValue);
 await expect(sibling).toHaveValue(siblingValue);
 expect(await field.getByRole('link',{name:'quiz-pending-commit-proof.pdf',exact:true}).count()).toBe(0);
 released=true;release();
 // Deliberately do not wait for filename rendering or an activity-state write.
 // The submission control must not enable before its authoritative answer ref contains the file.
 const submitted=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/quizzes/submit'&&r.request().method()==='POST');
 await submit.click();const response=await submitted;expect(response.status(),await response.text()).toBe(200);
 const payload=response.request().postDataJSON();expect(payload.answers[q.questionId].files).toHaveLength(1);
 const assetId=payload.answers[q.questionId].files[0].assetId;
 const rows=(await db.query('select answers from public.quiz_attempts where user_id=$1 and course_version_id=$2 order by attempt_no desc limit 1',[actor.userId,q.versionId])).rows;
 expect(rows[0].answers[q.questionId].files[0].assetId).toBe(assetId);
 const ownSibling=Object.values(rows[0].answers).includes(siblingValue);expect(ownSibling).toBe(true);
 const binding=(await db.query('select count(*)::int n from public.quiz_attachment_bindings where asset_id=$1 and owner_id=$2',[assetId,actor.userId])).rows[0].n;expect(binding).toBe(1);
 expect(errors).toEqual([]);result={mode:m.mode,heldActualStoragePut:true,submitBlockedWhileHeld:true,immediateEnabledSubmitContainedFile:true,siblingRetained:true,actualCheckOrSubmitStatus:response.status(),nativeBindingCount:binding,errors};
 writeFileSync(join(m.runtime,'pending-upload-browser.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,receipt:join(m.runtime,'pending-upload-browser.json')}));
}finally{if(!released)release();await db.end();await c.close();}process.exit(0);
