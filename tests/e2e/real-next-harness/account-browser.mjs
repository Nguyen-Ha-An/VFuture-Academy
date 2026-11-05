import { chromium } from '@playwright/test';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {join} from 'node:path';
import {readLocalManifest} from './manifest.mjs';
const m=readLocalManifest(process.argv[2]);if(process.env.ACADEMY_ROUTING_TRUSTED_BROWSER!=='1')throw new Error('Owned fixture browser required');
const endpoint=new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL??'');if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Nonlocal browser refused');
const b=await chromium.connectOverCDP(endpoint.href);const results=[];
for(const width of [1440,390])for(const theme of ['light','dark']){
 const height=width===390?600:900;const c=await b.newContext({viewport:{width,height},colorScheme:theme,ignoreHTTPSErrors:false});
 await c.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const a=m.actors.owner;await c.addCookies([{name:a.cookie.name,value:a.cookie.value,url:m.appOrigin,secure:true,httpOnly:true,sameSite:'Lax'},{name:'locale',value:'en',url:m.appOrigin},{name:'vf-theme',value:theme,url:m.appOrigin}]);
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(m.appOrigin+'/app',{waitUntil:'domcontentloaded'});
 const openAccount=async()=>{ if(width===390){await p.locator('button[aria-controls="learner-mobile-navigation"]').click();await p.locator('.canvas-global-nav-mobile').getByRole('button',{name:'Account',exact:true}).click();}
 else await p.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-account-tray"]').click(); };
 await openAccount();
 const immediate=p.getByRole('dialog',{name:'Account',exact:true});await expect(immediate).toBeVisible();await p.keyboard.press('Escape');await expect(immediate).toBeHidden();
 const returnTarget=width===390?p.locator('button[aria-controls="learner-mobile-navigation"]'):p.locator('.canvas-global-nav:not(.canvas-global-nav-mobile) button[aria-controls="academy-account-tray"]');await expect(returnTarget).toBeFocused();
 await openAccount();
 const d=p.getByRole('dialog',{name:'Account',exact:true});const settle=async()=>{
  await expect(async()=>{const state=await d.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,opacity:getComputedStyle(el).opacity};});expect(Math.round(state.x)).toBe(width===390?0:84);expect(Math.round(state.y)).toBe(0);expect(state.w).toBeGreaterThan(300);expect(state.x+state.w).toBeLessThanOrEqual(width+1);expect(state.h).toBeLessThanOrEqual(height+1);expect(state.opacity).toBe('1');}).toPass({timeout:5000});
  await expect(d.getByRole('heading',{name:'Account',exact:true})).toBeInViewport({ratio:1});await expect(d.getByRole('button',{name:'Close',exact:true})).toBeInViewport({ratio:1});
 };
 try{await settle();}catch(error){writeFileSync('/tmp/academy-routing-tray-dom.json',JSON.stringify(await p.evaluate(()=>['[role="dialog"]','.canvas-account-tray','.canvas-account-panel','.canvas-account-heading'].map(selector=>{const el=document.querySelector(selector);if(!el)return{selector,missing:true};const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{selector,html:el.outerHTML.slice(0,900),rect:{x:r.x,y:r.y,w:r.width,h:r.height},css:{position:s.position,inset:s.inset,left:s.left,transform:s.transform,opacity:s.opacity,padding:s.padding,margin:s.margin}};})),null,2));await p.screenshot({path:'/tmp/academy-routing-account-open-diagnostic.png'});throw error;}const png=join(m.runtime,`account-open-${width}-${theme}.png`);await p.screenshot({path:png});
 await d.getByRole('combobox',{name:'Theme',exact:true}).scrollIntoViewIfNeeded();await expect(d.getByRole('button',{name:'Close',exact:true})).toBeInViewport({ratio:1});await d.getByRole('combobox',{name:'Theme',exact:true}).click();await p.getByRole('option',{name:theme==='light'?'Dark':'Light',exact:true}).waitFor();await p.keyboard.press('Escape');await expect(d.getByRole('combobox',{name:'Theme',exact:true})).toHaveAttribute('aria-expanded','false');await settle();
 const result={width,height,theme,png,errors,afterFirstEscapeDialogCount:await p.getByRole('dialog').count(),box:await d.boundingBox(),scroll:await d.locator('.canvas-account-scroll').evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight})),links:await d.getByRole('link').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')))};
 await p.keyboard.press('Escape');await expect(d).toBeHidden();result.afterSecondEscapeFocus=await p.evaluate(()=>({tag:document.activeElement?.tagName,controls:document.activeElement?.getAttribute('aria-controls')}));expect(errors).toEqual([]);await expect(returnTarget).toBeFocused();results.push(result);await c.close();
}
writeFileSync(join(m.runtime,'account-settled.json'),JSON.stringify(results,null,2));process.exit(0);
