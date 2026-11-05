// Actual root navigation/dirty scopes. The only fault is delayed autosave transport.
import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readLocalManifest} from './manifest.mjs';
import {RECOVERY_SIGNED_OUT_KEY} from '../../../src/features/studio/recovery/tab.ts';
const m=readLocalManifest(process.argv[2]);
if(process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Fixture-trusting browser required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Nonlocal browser refused');
const b=await chromium.connectOverCDP(endpoint.href),contexts=[],results=[];
const scopeOnly=true;
const suffix='-sidebar';
async function setup(actorName,width=1440){
 const c=await b.newContext({viewport:{width,height:900},locale:'en-US',colorScheme:'dark',ignoreHTTPSErrors:false});contexts.push(c);
 await c.route('**/*',r=>[m.appOrigin,m.dataOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 const actor=m.actors[actorName];await c.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:m.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:m.appOrigin},{name:'vf-theme',value:'dark',url:m.appOrigin}]);return c;
}
async function openAccount(p){const trigger=p.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-account-tray"]');await trigger.click();const d=p.getByRole('dialog',{name:'Account',exact:true});await expect(d).toBeVisible();return{trigger,dialog:d};}
let releaseWrites;const heldWrites=new Promise(resolve=>{releaseWrites=resolve;});const requests=[],pageErrors=[];let holdWrites=false,lastPage;
try{
 if(!scopeOnly){
 const learner=await setup('learner'),profile=await learner.newPage();await profile.goto(m.appOrigin+'/app/profile',{waitUntil:'domcontentloaded'});await profile.waitForLoadState('networkidle');
 for(const [label,id]of [['Certificates','certificates-heading'],['Account settings','profile-settings-heading'],['Certificates','certificates-heading']]){
  const {dialog}=await openAccount(profile);await dialog.getByRole('link',{name:label,exact:true}).click();await expect(dialog).toBeHidden();
  const target=profile.locator('#'+id);await expect(target).toBeFocused();await expect(target).toBeInViewport({ratio:1});expect(await profile.evaluate(()=>location.hash)).toBe('#'+id);
 }
 results.push({case:'same-page certificates/settings/repeated hash',passed:true});
 }
 const owner=await setup('owner');const courseId='academy-navigation-guard-fixture';
 const existing=await owner.request.get(`${m.appOrigin}/api/v1/studio/courses/${courseId}/draft`);
 if(existing.status()===404){const created=await owner.request.post(m.appOrigin+'/api/v1/studio/courses',{headers:{origin:m.appOrigin},data:{id:courseId,title:{en:'Synthetic navigation guard course',vi:'Khóa học kiểm tra bản nháp'},languages:['en','vi'],defaultLanguage:'en',pathway:'core-future-skills',level:'foundation'}});expect(created.status()).toBe(200);}else{expect(existing.status()).toBe(200);expect((await existing.json()).data.courseId).toBe(courseId);}
 let scopePosts=0,localePatches=0,signoutPosts=0,autosaveHeld=false;
 owner.on('request',r=>{const path=new URL(r.url()).pathname;requests.push({method:r.method(),path});if(r.method()==='POST'&&path==='/api/v1/studio/scope')scopePosts++;if(r.method()==='PATCH'&&path==='/api/v1/profile/locale')localePatches++;if(r.method()==='POST'&&path==='/auth/signout')signoutPosts++;});
 await owner.route(url=>url.origin===m.appOrigin&&url.pathname===`/api/v1/studio/courses/${courseId}/draft/workspace`,async route=>{if(holdWrites&&!['GET','HEAD'].includes(route.request().method())){autosaveHeld=true;await heldWrites;}await route.continue();});
 const editor=await owner.newPage();lastPage=editor;editor.on('pageerror',error=>pageErrors.push(error.message));await editor.goto(m.appOrigin+'/studio/courses/'+courseId,{waitUntil:'domcontentloaded'});
 const title=editor.locator('[data-authoring-field="/title"]').getByRole('textbox',{name:'Title (EN)',exact:true});await expect(title).toBeEnabled({timeout:30000});holdWrites=true;await title.fill(`Pending synthetic guard edit ${Date.now()}`);
 await expect.poll(()=>autosaveHeld).toBe(true);
 const copy=JSON.parse(readFileSync(new URL('../../../src/messages/en.json',import.meta.url))).studioWorkspace;
 const leave=editor.getByRole('dialog',{name:copy.leaveTitle,exact:true});
 if(!scopeOnly){
 const {trigger,dialog}=await openAccount(editor);await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(leave).toBeVisible();expect(await editor.getByRole('dialog').count()).toBe(1);
 await leave.getByRole('button',{name:copy.stay,exact:true}).click();await expect(leave).toBeHidden();await expect(trigger).toBeFocused();
 expect(signoutPosts).toBe(0);expect(await editor.evaluate(key=>localStorage.getItem(key),RECOVERY_SIGNED_OUT_KEY)).toBeNull();
 results.push({case:'dirty signout stays, no POST, visible trigger focus',passed:true});
 await openAccount(editor);const account=editor.getByRole('dialog',{name:'Account',exact:true});await account.getByRole('combobox',{name:'Language',exact:true}).click();await editor.getByRole('option',{name:'Tiếng Việt',exact:true}).click();
 await expect(leave).toBeVisible();expect(await editor.getByRole('dialog').count()).toBe(1);await leave.getByRole('button',{name:copy.stay,exact:true}).click();await expect(leave).toBeHidden();expect(localePatches).toBe(0);
 results.push({case:'dirty locale stays before PATCH',passed:true});
 }
 const retainedTitle=await title.inputValue();
 await editor.setViewportSize({width:390,height:844});
 const nav=editor.locator('header button[data-sidebar="trigger"]');await expect(nav).toHaveAttribute('aria-haspopup','dialog');await nav.click();
 const navigationDialog=editor.getByRole('dialog',{name:'Studio navigation',exact:true});
 await expect(async()=>{const r=await navigationDialog.boundingBox();expect(r).not.toBeNull();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(390);}).toPass({timeout:5000});
 const contextual=editor.locator('.canvas-context-navigation a[href="/studio/library"]');
 const [popup]=await Promise.all([owner.waitForEvent('page'),contextual.click({modifiers:['Meta']})]);await popup.waitForLoadState('domcontentloaded');expect(popup.url()).toBe(m.appOrigin+'/studio/library');await popup.close();expect(await leave.count()).toBe(0);await expect(editor).toHaveURL(m.appOrigin+'/studio/courses/'+courseId);await expect(editor.locator('[data-authoring-field="/title"] input')).toHaveValue(retainedTitle);
 results.push({case:'modified link opens authorized native new tab while original dirty tab remains',passed:true});
 for(const href of ['/studio/library','/app/courses']){
  if(href==='/app/courses'){await nav.click();await expect(async()=>{const r=await navigationDialog.boundingBox();expect(r).not.toBeNull();expect(r.x).toBeGreaterThanOrEqual(0);}).toPass({timeout:5000});}
  await editor.locator(`.canvas-context-navigation a[href="${href}"]`).click();await expect(leave).toBeVisible();await expect(editor.locator('.canvas-staff-overlay-mount [role="dialog"]')).toHaveCount(0);expect(await editor.getByRole('dialog').count()).toBe(1);
  await leave.getByRole('button',{name:copy.stay,exact:true}).click();await expect(leave).toBeHidden();await expect(nav).toBeFocused();await expect(editor).toHaveURL(m.appOrigin+'/studio/courses/'+courseId);
  results.push({case:`ordinary mobile dirty link ${href} Stay after native exit`,passed:true});
 }
 await nav.click();await expect(async()=>{const r=await navigationDialog.boundingBox();expect(r).not.toBeNull();expect(r.x).toBeGreaterThanOrEqual(0);}).toPass({timeout:5000});
 await contextual.click();await expect(leave).toBeVisible();await expect(editor.locator('.canvas-staff-overlay-mount [role="dialog"]')).toHaveCount(0);await leave.getByRole('button',{name:copy.discard,exact:true}).click();await expect(editor).toHaveURL(m.appOrigin+'/studio/library');await expect(editor.locator('main h1')).toBeVisible();await expect(editor.locator('main h1')).toBeFocused();expect(scopePosts).toBe(0);expect(pageErrors).toEqual([]);
 results.push({case:'Discard closes confirmation then navigates once to authorized content library with heading focus',passed:true});
 writeFileSync(join(m.runtime,`navigation-browser${suffix}-result.json`),JSON.stringify({mode:m.mode,results,scopePosts,localePatches,signoutPosts},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,receipt:join(m.runtime,`navigation-browser${suffix}-result.json`)}));
}finally{releaseWrites();const focus=await lastPage?.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,1000),dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{label:e.getAttribute('aria-label'),labelledBy:e.getAttribute('aria-labelledby'),parentClass:e.parentElement.className,hostOpen:document.querySelector('.canvas-staff-overlay-mount')?.getAttribute('data-open'),triggerOpen:document.querySelector('header button[data-sidebar=trigger]')?.getAttribute('aria-expanded'),ariaModal:e.getAttribute('aria-modal'),ariaHidden:e.getAttribute('aria-hidden'),display:s.display,visibility:s.visibility,rect:{x:r.x,y:r.y,w:r.width,h:r.height}};}),account:[...document.querySelectorAll('button[aria-controls="academy-account-tray"]')].map(e=>({html:e.outerHTML.slice(0,300),hiddenAncestor:e.closest('[aria-hidden="true"], [inert], [hidden]')?.outerHTML.slice(0,300)}))})).catch(()=>null);writeFileSync(join(m.runtime,`navigation-browser${suffix}-observations.json`),JSON.stringify({mode:m.mode,results,requests,focus,pageErrors},null,2)+'\n',{mode:0o600});await Promise.all(contexts.map(c=>c.close()));}process.exit(0);
