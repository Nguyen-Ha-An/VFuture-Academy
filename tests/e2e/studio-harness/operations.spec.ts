import {test,expect} from '@playwright/test';

test('account menu opens by keyboard and exposes each authorized workspace at its own home',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/app');
 const trigger=page.getByRole('button',{name:'Nguyễn An'});await trigger.focus();await trigger.press('ArrowDown');
 // Three separate workspaces, three separate homes. Studio must not point into grading.
 await expect(page.getByRole('menuitem',{name:'Mở Studio',exact:true})).toHaveAttribute('href','/studio');
 await expect(page.getByRole('menuitem',{name:'Mở Khảo thí & đánh giá',exact:true})).toHaveAttribute('href','/grading');
 await expect(page.getByRole('menuitem',{name:'Mở Quản trị',exact:true})).toHaveAttribute('href','/admin');
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(page.getByRole('menu')).toBeHidden();
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
