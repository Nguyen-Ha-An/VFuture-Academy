// Connect only to a lead-owned browser that trusts the fixture CA. No certificate bypass or browser launch.
import { chromium,expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { appendFileSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { readLocalManifest } from './manifest.mjs';
import { DENSE_COURSE_ID,SYNTHETIC_DENSE_NAME,verifyDenseDashboard } from './dense-dashboard.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const dynamicId=id=>/^(?:radix-|tab-Tabs_|panel-Tabs_|DrawerLayout_|_R_|«R|:R)/.test(id);
export async function auditProductionRootSsr({manifestFile,browser,denseDashboard=false,editor=false}){
  const manifest=readLocalManifest(manifestFile);
  const env=JSON.parse(readFileSync(join(manifest.runtime,'next-env.json'),'utf8'));
  if(manifest.mode!=='production'||manifest.serverTimezone!=='UTC'||env.NODE_ENV!=='production'||env.TZ!=='UTC')throw new Error('Actual production-mode fixture with serverTZUTC is required');
  if(denseDashboard&&(manifest.denseProfile?.kind!=='synthetic-central-admin-as-learner'||manifest.denseProfile.actor!=='owner'||manifest.denseProfile.courseId!==DENSE_COURSE_ID))throw new Error('Run explicit synthetic dense preparation before dense SSR mode');
  const denseShape=denseDashboard?await verifyDenseDashboard(manifest):null;
  const results=[];
  const basename=editor?'production-ssr-editor':denseDashboard?'production-ssr-dense-dashboard':'production-ssr-browser';
  const log=join(manifest.runtime,basename+'.jsonl');writeFileSync(log,'',{mode:0o600});
  const sanitize=value=>{
    let text=String(value);
    for(const [name,actor] of Object.entries(manifest.actors)){text=text.replaceAll(actor.cookie.value,'[fixture-cookie]').replaceAll(actor.userId,'[fixture-user]').replaceAll(`Routing ${name}`,'[fixture-profile]');}
    return text.replaceAll(SYNTHETIC_DENSE_NAME,'[synthetic-dense-profile]');
  };
  const targets=editor?[{actor:'owner',path:'/studio/courses/academy-navigation-guard-fixture'}]:denseDashboard?[{actor:'owner',path:'/app'}]:[{actor:'learner',path:'/app'},{actor:'learner',path:`/app/courses/${manifest.courseId}`},{actor:'owner',path:'/studio/courses'}];
  // A rejecting local proxy prevents non-loopback browser traffic without request
  // interception (Playwright routing would disable HTTP cache and invalidate warm runs).
  const blocker=createServer(socket=>socket.destroy());
  await new Promise((resolveListen,reject)=>{blocker.once('error',reject);blocker.listen(0,'127.0.0.1',resolveListen);});
  const address=blocker.address();
  if(typeof address!=='object'||!address)throw new Error('Local network guard did not bind');
  try{
  for(const locale of ['en','vi'])for(const target of targets){
    const actor=manifest.actors[target.actor];
    if(actor.cookie.name!=='__Host-academy_session'||actor.cookie.secure!==true)throw new Error('Production host-only secure fixture session required');
    // Fresh context per actor/locale/target; the second visit reuses only this fixture context's warm cache.
    const context=await browser.newContext({locale:locale==='vi'?'vi-VN':'en-US',timezoneId:'Asia/Ho_Chi_Minh',colorScheme:'light',viewport:{width:1440,height:900},ignoreHTTPSErrors:false,proxy:{server:`http://127.0.0.1:${address.port}`,bypass:'localhost,127.0.0.1'}});
    await context.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:manifest.appOrigin,httpOnly:true,secure:true,sameSite:'Lax'},{name:'locale',value:locale,url:manifest.appOrigin,secure:true,sameSite:'Lax'}]);
    const blocked=[];
    context.on('request',request=>{let url;try{url=new URL(request.url());}catch{return;}if(['http:','https:'].includes(url.protocol)&&![manifest.appOrigin,manifest.dataOrigin].includes(url.origin))blocked.push({method:request.method(),origin:url.origin,pathname:url.pathname});});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push({type:'pageerror',message:sanitize(error.message)}));
    page.on('console',message=>{if(message.type()==='error')errors.push({type:'console.error',message:sanitize(message.text())});});
    try{
      for(const temperature of ['cold','warm']){
        const row={profile:{actor:target.actor,locale,browserTimezone:'Asia/Ho_Chi_Minh',serverTimezone:'UTC'},path:target.path,temperature,mode:'actual-root-production',variant:denseDashboard?'synthetic-dense-dashboard':'baseline',...(denseShape?{fixtureShape:denseShape}:{}),passed:false};
        const before=errors.length;
        try{
          const response=temperature==='cold'?await page.goto(manifest.appOrigin+target.path,{waitUntil:'domcontentloaded',timeout:90000}):await page.reload({waitUntil:'domcontentloaded',timeout:90000});
          if(!response)throw new Error('No navigation document response');
          const html=await response.text();
          row.status=response.status();row.serverDocumentSha256=hash(html);row.serverBytes=Buffer.byteLength(html);row.serverH1Count=[...html.matchAll(/<h1\b/gi)].length;
          row.serverDynamicIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]).filter(dynamicId);
          expect(row.status).toBe(200);expect(/<main\b/i.test(html)).toBe(true);expect(row.serverH1Count).toBeGreaterThan(0);
          await expect(page.locator('html')).toHaveAttribute('lang',locale);
          await expect(page.locator('main h1')).toHaveCount(1);await expect(page.locator('main h1')).toBeVisible();
          row.browserResolvedTimezone=await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
          expect(['Asia/Ho_Chi_Minh','Asia/Saigon']).toContain(row.browserResolvedTimezone);
          expect(await page.evaluate(()=>new Date('2026-11-05T12:00:00Z').getTimezoneOffset())).toBe(-420);
          row.hydratedDynamicIds=await page.locator('[id]').evaluateAll(elements=>elements.map(element=>element.id).filter(id=>/^(?:radix-|tab-Tabs_|panel-Tabs_|DrawerLayout_|_R_|«R|:R)/.test(id)));
          if(denseDashboard){
            const navigation=page.getByRole('navigation',{name:locale==='vi'?'Điều hướng toàn cục':'Global navigation',exact:true});
            for(const prefix of ['/studio','/grading','/admin'])await expect(navigation.locator(`a[href^="${prefix}"]`)).toBeVisible();
            await expect(page.locator('.canvas-dashboard-greeting')).toContainText(SYNTHETIC_DENSE_NAME);
            const course=page.locator('.canvas-dashboard-course-row');await expect(course).toHaveCount(1);
            await expect(course.locator(`a.canvas-dashboard-course-open[href="/app/courses/${DENSE_COURSE_ID}"]`)).toBeVisible();
            await expect(course.getByText(locale==='vi'?/^49 mục(?: ·|$)/:/^49 items(?: ·|$)/)).toBeVisible();
            await expect(page.locator('#dashboard-task-list > li')).toHaveCount(10);
            await page.getByRole('button',{name:locale==='vi'?'Xem tất cả 10 hoạt động':'Show all 10 activities',exact:true}).click();
            for(const task of await page.locator('#dashboard-task-list > li').all())await expect(task).toBeVisible();
            await expect(page.locator('.canvas-coursework-count')).toHaveText(locale==='vi'?'10 hoạt động':'10 activities');
            await expect(page.locator('.canvas-dashboard-results > ul')).toHaveCount(0);
            await expect(page.locator('.canvas-dashboard-results .canvas-dashboard-empty')).toHaveText(locale==='vi'?'Kết quả sẽ xuất hiện sau khi bài làm được chấm và công bố.':'Released results will appear here after your work is graded.');
            await expect(page.locator('main').getByRole('heading',{name:locale==='vi'?'Thông báo':'Announcements',exact:true})).toHaveCount(0);
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
          }
          if(editor){await expect(page.locator('[data-authoring-field="/title"]').getByRole('textbox',{name:locale==='vi'?'Tiêu đề (EN)':'Title (EN)',exact:true})).toBeEnabled();await expect(page.locator('main')).not.toContainText('Invalid Date');}
          expect(await page.locator('.vf-canvas style[data-emotion^="academy-instui"]').count(),'No inline style siblings in hydrated Canvas subtree').toBe(0);
          // Real native Account interaction establishes hydration; no custom hydrated flag or sleep.
          const trigger=page.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-account-tray"]');
          await expect(trigger).toHaveCount(1);await trigger.click();
          const dialog=page.getByRole('dialog',{name:locale==='vi'?'Tài khoản':'Account',exact:true});
          await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:locale==='vi'?'Đóng':'Close',exact:true}).click();
          await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
          row.accountInteraction='actual open/close/focus return';
          row.errors=errors.slice(before);row.blockedRequests=[...blocked];
          expect(row.errors,'actual console/page/hydration errors').toEqual([]);expect(row.blockedRequests,'browser egress attempts').toEqual([]);
          row.passed=true;
        }catch(error){row.failure=sanitize(error.message);row.errors=errors.slice(before);row.blockedRequests=[...blocked];}
        results.push(row);appendFileSync(log,JSON.stringify(row)+'\n',{mode:0o600});
      }
    }finally{await context.close();}
  }
  }finally{await new Promise(resolveClose=>blocker.close(resolveClose));}
  const receipt={kind:'actual-root-production-ssr-cold-warm',variant:denseDashboard?'synthetic-dense-dashboard':'baseline',results,boundaries:['Only synthetic fixture actor/locale/timezone metadata and document hashes/IDs are retained, no profile body or session values','Cold means fresh browser context/cache; warm is a reload in that same isolated context, not a process-cold server claim','Actual navigation response is the server document; a separate request is not substituted','No ssr:false, hydration warning suppression, manual IDs, TLS bypass or fake response is used','External SSO/provisioning and Storage file authorization are not established']};
  const output=join(manifest.runtime,basename+'.json');writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return{output,passed:results.every(row=>row.passed),cases:results.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let code=1;
  try{
    const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');
    if(process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1'||!['http:','ws:'].includes(endpoint.protocol)||!['127.0.0.1','localhost'].includes(endpoint.hostname)||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Explicit lead-owned loopback browser with trusted fixture CA is required');
    const browser=await chromium.connectOverCDP(endpoint.href);
    const result=await auditProductionRootSsr({manifestFile:process.argv[2],browser,denseDashboard:process.argv.includes('--dense-dashboard'),editor:process.argv.includes('--editor')});console.log(JSON.stringify(result));code=result.passed?0:1;
    // Do not Browser.close() the lead-owned browser; only our newly created contexts were closed.
  }catch(error){console.error(JSON.stringify({status:'ssr_browser_failed',message:error.message}));}
  process.exit(code); // Disconnect this helper's CDP socket without terminating the owned browser.
}
