import { expect, test } from '@playwright/test';
import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';

test('redesigned editor keeps workspace switching available and the editor in the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/v1/studio/content/course/minimal/workflow', route => route.fulfill({json:{data:{content:{contentType:'course',contentId:'minimal',revisionKey:'2026-09-06T00:00:00.000Z',status:'draft',publishedRevisionKey:null},activeReview:null,publication:null,actions:{requestReview:true,withdrawReview:false,approveAndPublish:false,mutate:true}}}}));
  await page.route('**/api/v1/studio/courses/minimal/draft/preview', async route => {
    const body = route.request().postDataJSON();
    const result = await compileCourse({manifest:body.manifest,items:body.items},fixtureResolver,{locales:[body.locale]});
    await route.fulfill({json:{data:{course:result.compiled,item:null,report:result.report}}});
  });
  await page.goto('/studio/courses/minimal?redesigned=1');
  await expect(page.getByRole('navigation', { name: 'Không gian làm việc' }).first()).toBeVisible();
  await expect(page.locator('header').first().getByRole('link', { name: 'Khảo thí & đánh giá', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#studio-preview h3')).toBeVisible();
  expect(await page.locator('#studio-main').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('staff-editor-desktop.png'), fullPage: true });
});

test('redesigned grading has readable identity and a responsive mobile drawer', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/grading/assignments/submission-1?redesigned=1');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'Administration', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('staff-grading-mobile.png'), fullPage: true });
});
