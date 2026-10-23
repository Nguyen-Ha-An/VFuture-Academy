import { expect, test } from '@playwright/test';
import { setLocale } from './support/auth';

const fixtures = [
  { area: 'courses', publicId: 'recovery-course-global', privateIds: ['recovery-course-vinsmc'] },
  { area: 'resources', publicId: 'recovery-resource-project-brief', privateIds: ['recovery-resource-vinsmc-field-guide'] },
  { area: 'opportunities', publicId: 'recovery-opportunity-open', privateIds: ['recovery-opportunity-upcoming'] },
  { area: 'projects', publicId: 'recovery-project-campus-energy', privateIds: ['recovery-project-vinsmc-air', 'recovery-project-water-stories'] },
] as const;

test.describe('@recovery-04 public discovery', () => {
  test.skip(process.env.HIDE_INTERNAL_CONTENT === '1', 'internal fixtures hidden');
  test('loads the published course cover through its authorized media redirect', async ({ page }) => {
    await page.goto('/courses?lang=en');
    const cover = page.locator('img[src*="asset_cover_ai"]').first();
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((element) => {
      const img = element as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    })).toBe(true);
  });

  test('exposes global fixtures and hides restricted or unapproved records in anonymous APIs', async ({ request }) => {
    for (const fixture of fixtures) {
      const listing = await request.get(`/api/v1/public/${fixture.area}?locale=en`);
      expect(listing.status(), fixture.area).toBe(200);
      const listBody = JSON.stringify(await listing.json());
      expect(listBody).toContain(fixture.publicId);
      for (const id of fixture.privateIds) {
        expect(listBody).not.toContain(id);
        const restricted = await request.get(`/api/v1/public/${fixture.area}/${id}?locale=en`);
        expect(restricted.status(), id).toBe(404);
      }
      const detail = await request.get(`/api/v1/public/${fixture.area}/${fixture.publicId}?locale=en`);
      expect(detail.status(), fixture.publicId).toBe(200);
      const body = await detail.json();
      expect(body.data.id).toBe(fixture.publicId);
      for (const privateField of ['members', 'interests', 'interested', 'draft', 'grades', 'grading', 'owner_id', 'created_by']) {
        expect(body.data, fixture.publicId).not.toHaveProperty(privateField);
      }
      expect(detail.headers()['cache-control'] ?? '').not.toMatch(/s-maxage=[1-9]/);
    }
  });

  for (const locale of ['vi', 'en'] as const) {
    test(`offers four working entry points and details in ${locale} on desktop and mobile`, async ({ page, context, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      if (!baseURL) throw new Error('Public discovery requires an explicit application origin.');
      await setLocale(context, baseURL, locale);
      for (const [viewport, size] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
        await page.setViewportSize(size);
        const landing = await page.goto(`/?lang=${locale}`);
        expect(landing?.status()).toBe(200);
        await expect(page.locator('main h1')).toBeVisible();
        const menu = page.locator('button[aria-controls="academy-shell-navigation"]');
        if (await menu.isVisible()) await menu.click();
        for (const fixture of fixtures) {
          await expect(page.locator(`header nav a[href="/${fixture.area}?lang=${locale}"]`).first()).toBeVisible();
        }
        await page.screenshot({ path: testInfo.outputPath(`landing-${locale}-${viewport}.png`), fullPage: true });
        for (const fixture of fixtures) {
          const listing = await page.goto(`/${fixture.area}?lang=${locale}`);
          expect(listing?.status(), fixture.area).toBe(200);
          await expect(page.locator('main h1')).toBeVisible();
          await page.locator(`a[href="/${fixture.area}/${fixture.publicId}"]`).first().click();
          await expect(page).toHaveURL(url => url.pathname === `/${fixture.area}/${fixture.publicId}`);
          await expect(page.locator('main h1')).toBeVisible();
          await expect(page.locator('main [role="alert"]')).toHaveCount(0);
          await page.screenshot({ path: testInfo.outputPath(`${fixture.area}-${locale}-${viewport}.png`), fullPage: true });
        }
      }
    });
  }
});
