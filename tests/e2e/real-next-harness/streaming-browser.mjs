import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {createStudioFixtureClient} from '../../../scripts/lib/studio-postgres-fixture.mjs';
import {readLocalManifest} from './manifest.mjs';
const m=readLocalManifest(process.argv[2]);
if(process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Explicit synthetic fixture browser trust is required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Nonlocal browser refused');
const db=createStudioFixtureClient(m.postgres);await db.connect();
if((await db.query('select current_database() name')).rows[0].name!=='academy_route_fixture')throw new Error('Nonfixture lock refused');
const b=await chromium.connectOverCDP(endpoint.href);const c=await b.newContext({viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Asia/Ho_Chi_Minh',ignoreHTTPSErrors:false});
await c.route('**/*',r=>[m.appOrigin,m.dataOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
const actor=m.actors.owner;await c.addCookies([{name:actor.cookie.name,value:actor.cookie.value,url:m.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:m.appOrigin}]);
await c.addInitScript(()=>{window.__styles=[];new MutationObserver(rows=>{for(const row of rows)for(const [kind,nodes]of [['add',row.addedNodes],['remove',row.removedNodes]])for(const node of nodes)if(node.nodeType===1){const list=[...(node.matches?.('style[data-emotion]')?[node]:[]),...(node.querySelectorAll?.('style[data-emotion]')??[])];for(const s of list)window.__styles.push({kind,emotion:s.getAttribute('data-emotion'),sourceParent:row.target.tagName,parent:s.parentElement?.tagName,at:performance.now()});}}).observe(document,{subtree:true,childList:true});window.addEventListener('error',()=>{window.__errorStyles=[...document.querySelectorAll('style[data-emotion]')].map(s=>({emotion:s.getAttribute('data-emotion'),parent:s.parentElement?.tagName}));});});
const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push({kind:'pageerror',message:e.message,stack:e.stack}));p.on('console',e=>{if(e.type()==='error')errors.push({kind:'console',message:e.text()});});let released=false;
try{
 await db.query('begin');await db.query('lock table public.exam_attempts in access exclusive mode');
 const response=await p.goto(m.appOrigin+'/app',{waitUntil:'commit',timeout:30000});
 // The shell hydrates while the actual dashboard SQL remains blocked.
 // Exercise only the native rail; opening Account would prewarm Select styles.
 await p.getByRole('button',{name:'Collapse navigation',exact:true}).click();
 await expect(p.locator('.canvas-global-nav:not(.canvas-global-nav-mobile)')).toHaveAttribute('data-minimized','true');
 await p.getByRole('button',{name:'Expand navigation',exact:true}).click();
 await expect(p.locator('.canvas-global-nav:not(.canvas-global-nav-mobile)')).toHaveAttribute('data-minimized','false');
 const beforeRelease=await p.evaluate(()=>({styles:window.__styles,bodyStyles:[...document.body.querySelectorAll('style[data-emotion]')].map(s=>s.getAttribute('data-emotion')),at:performance.now(),main:document.querySelector('main')?.innerText.slice(0,200)}));
 await db.query('commit');released=true;
 const html=await response.text();writeFileSync(m.runtime+'/hydration-barrier-navigation.html',html,{mode:0o600});
 await expect(p.locator('main h1')).toBeVisible({timeout:30000});await p.waitForLoadState('networkidle',{timeout:30000});
 writeFileSync(m.runtime+'/hydration-barrier-observations.json',JSON.stringify({beforeRelease,errors,after:await p.evaluate(()=>({styles:window.__styles,errorStyles:window.__errorStyles,bodyStyles:[...document.body.querySelectorAll('style[data-emotion]')].map(s=>s.getAttribute('data-emotion'))}))},null,2),{mode:0o600});
 expect(errors,'No errors from actual streamed dashboard hydration').toEqual([]);
 expect(await p.locator('.vf-canvas style[data-emotion^="academy-instui"]').count(),'No style siblings inside the hydrated Canvas component subtree').toBe(0);
 const streamedStyles=await p.locator('body style[data-emotion^="academy-instui"]').evaluateAll(nodes=>nodes.map(node=>({directBodyChild:node.parentElement===document.body,insideMain:!!node.closest('main')})));
 expect(streamedStyles.every(node=>node.directBodyChild&&!node.insideMain),'Any late Next insertion must stay outside the hydrated application subtree').toBe(true);
 console.log(JSON.stringify({passed:true,released,errors:errors.length,receipt:m.runtime+'/hydration-barrier-observations.json'}));
}finally{if(!released){writeFileSync(m.runtime+'/hydration-barrier-before-rollback.json',JSON.stringify({errors,state:await p.evaluate(()=>({styles:window.__styles,text:document.querySelector('main')?.innerText.slice(0,300),scripts:[...document.scripts].map(s=>s.src).filter(Boolean)})).catch(()=>null)},null,2));await db.query('rollback');}await db.end();await c.close();}process.exit(0);
