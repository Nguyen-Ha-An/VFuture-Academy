import {test,expect} from '@playwright/test';
import {accountButton,openAccountTray,expectNoHorizontalScroll,messages} from './staff-ui-support';
import {RECOVERY_SIGNED_OUT_KEY} from '../../../src/features/studio/recovery/tab';

test('Account opens by keyboard and authorized global workspaces keep their own homes',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/app');
 const navigation=page.getByRole('navigation',{name:'Điều hướng toàn cục',exact:true});
 // Admission destinations remain server-owned global navigation, not Account preferences.
 for(const[label,href]of[['Studio','/studio'],['Giảng dạy','/grading'],['Quản trị','/admin']]as const){const link=navigation.getByRole('link',{name:label,exact:true});await expect(link).toBeVisible();await expect(link).toHaveAttribute('href',href);}
 const trigger=accountButton(page);await trigger.focus();await page.keyboard.press('Enter');
 const account=page.getByRole('dialog',{name:'Tài khoản',exact:true});await expect(account).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
 await expect(account.getByRole('heading',{name:'Nguyễn An',exact:true})).toBeVisible();
 await expect(account.getByRole('link',{name:messages.vi.learner.focus.profile,exact:true})).toHaveAttribute('href','/app/profile');
 await expect(account.getByRole('link',{name:messages.vi.common.accountSettings,exact:true})).toHaveAttribute('href','/app/profile#profile-settings-heading');
 await expect(account.getByRole('combobox',{name:messages.vi.common.language,exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(account).toBeHidden();await expectNoHorizontalScroll(page);
});
test('Account locale pending and failure retain the old locale, then a successful retry persists it',async({page})=>{
 let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});const requests:unknown[]=[];
 await page.route('**/api/v1/profile/locale',async route=>{requests.push({method:route.request().method(),body:route.request().postDataJSON()});if(requests.length===1){await pending;await route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});}else await route.fulfill({json:{data:{locale:'en'}}});});
 await page.setViewportSize({width:1440,height:900});await page.goto('/app');
 const epoch=await page.evaluate(()=>performance.timeOrigin);const account=await openAccountTray(page);
 const language=account.getByRole('combobox',{name:messages.vi.common.language,exact:true});
 try{
   await language.click();await page.getByRole('option',{name:'English',exact:true}).click();
   await expect.poll(()=>requests).toEqual([{method:'PATCH',body:{locale:'en'}}]);
   await expect(account).toBeVisible();await expect(language).toBeDisabled();await expect(language).toHaveValue('English');
   await expect(account.getByRole('status')).toHaveText('Đang lưu ngôn ngữ…');
   release();
   await expect(language).toBeEnabled();await expect(language).toHaveValue('Tiếng Việt');
   await expect(language).toHaveAttribute('aria-invalid','true');await expect(account.getByText(messages.vi.locale.updateError,{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>performance.timeOrigin)).toBe(epoch);expect((await page.context().cookies()).some(cookie=>cookie.name==='locale')).toBe(false);
   const reloaded=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());
   await language.click();await page.getByRole('option',{name:'English',exact:true}).click();await reloaded;
   await expect(page.locator('html')).toHaveAttribute('lang','en');
   expect((await page.context().cookies()).find(cookie=>cookie.name==='locale')?.value).toBe('en');
   expect(requests).toEqual([{method:'PATCH',body:{locale:'en'}},{method:'PATCH',body:{locale:'en'}}]);
   const retried=await openAccountTray(page);await expect(retried.getByRole('combobox',{name:messages.en.common.language,exact:true})).toHaveValue('English');
   await page.keyboard.press('Escape');await expect(retried).toBeHidden();await expect(accountButton(page)).toBeFocused();
 }finally{release();}
});
test('Account sign-out submits the real hidden form only after the native tray exits',async({page})=>{
 const observed:{method:string;trayVisible:boolean;marker:string|null}[]=[];
 const requests:string[]=[];
 await page.exposeFunction('__observeNativeSignOut',(snapshot:{method:string;trayVisible:boolean;marker:string|null})=>{observed.push(snapshot);});
 await page.addInitScript(key=>{
  document.addEventListener('submit',event=>{
   const form=event.target;if(!(form instanceof HTMLFormElement)||form.getAttribute('action')!=='/auth/signout')return;
   const dialog=document.getElementById('academy-account-tray')?.closest('[role="dialog"]');
   const rect=dialog?.getBoundingClientRect();
   const trayVisible=!!dialog&&!!rect&&rect.width>0&&rect.height>0&&getComputedStyle(dialog).visibility!=='hidden'&&getComputedStyle(dialog).display!=='none';
   // Observe the real submit after React's form handler, before native document
   // navigation. Querying page DOM inside its paused route would deadlock it.
   const observer=Reflect.get(window,'__observeNativeSignOut');
   if(typeof observer==='function')void observer({method:form.method.toUpperCase(),trayVisible,marker:localStorage.getItem(key)});
  });
 },RECOVERY_SIGNED_OUT_KEY);
 await page.route('**/auth/signout',async route=>{requests.push(route.request().method());await route.fulfill({contentType:'text/html',body:'<h1>Signed out browser-control fixture</h1>'});});
 await page.goto('/app');const account=await openAccountTray(page);
 const signOut=account.getByRole('button',{name:messages.vi.common.signOut,exact:true});await signOut.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Signed out browser-control fixture',exact:true})).toBeVisible();
 await expect.poll(()=>observed.length).toBe(1);expect(requests).toEqual(['POST']);const submitted=observed[0]!;expect(submitted.method).toBe('POST');expect(submitted.trayVisible).toBe(false);expect(submitted.marker).toMatch(/^\d+$/);
});
// Grading journeys, including mobile, live in grading.spec.ts against the same fixture.
test('reports show current backlog separately from period metrics and remain responsive',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/grading/reports');
 await expect(page.getByRole('heading',{name:'Báo cáo học tập',exact:true})).toBeVisible();
 await expect(page.getByText('66.67%',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('reports-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Khối lượng chấm'}).click();
 await expect(page.getByRole('heading',{name:/Tồn đọng hiện tại/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
