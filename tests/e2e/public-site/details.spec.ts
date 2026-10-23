import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

type Catalog = 'projects' | 'opportunities' | 'resources';

for (const catalog of ['projects', 'opportunities', 'resources'] as const) {
  test(`${catalog} published details retain catalog context, locale, canonical and protected continuation`, async ({ page }, testInfo) => {
    await page.goto(`/${catalog}?page=1&lang=en`);
    await expect(page.locator('.public-loading')).toHaveCount(0);
    await expect(page.locator('[data-public-results]')).toBeVisible();
    const links = page.locator(`main h2 a[href^="/${catalog}/"]`);
    const hrefs = await links.evaluateAll(elements => elements.map(element => element.getAttribute('href')!));
    test.skip(hrefs.length === 0, `No published ${catalog} records; deterministic server-page fixtures cover this detail family.`);
    // All current records (bounded at four) exercise unavailable/open opportunity
    // states without adding or modifying any catalog data.
    for (const href of hrefs.slice(0, 4)) {
      await page.goto(href);
      await expect(page.locator('.public-loading')).toHaveCount(0);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      if (href === hrefs[0]) {
        const accessibility = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        await testInfo.attach(`${catalog}-detail-axe`, { body: JSON.stringify(accessibility.violations, null, 2), contentType: 'application/json' });
        expect(accessibility.violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`${catalog}-detail-en.png`), fullPage: true });
      }
      const detailUrl = new URL(page.url());
      const id = detailUrl.pathname.split('/').at(-1)!;
      expect(detailUrl.searchParams.get('lang')).toBe('en');
      expect(detailUrl.searchParams.get('page')).toBe('1');
      const breadcrumb = page.locator('.public-breadcrumbs');
      await expect(breadcrumb).toBeVisible();
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText((await page.locator('h1').textContent())!);
      const canonical = new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!);
      expect(canonical.pathname).toBe(detailUrl.pathname);
      expect(Object.fromEntries(canonical.searchParams)).toEqual({ lang: 'en' });
      const back = page.locator('.public-back-link');
      const backUrl = new URL((await back.getAttribute('href'))!, page.url());
      expect(backUrl.pathname).toBe(`/${catalog}`);
      expect(Object.fromEntries(backUrl.searchParams)).toEqual({ page: '1', lang: 'en' });
      const privateHref = `/app/${catalog}/${id}`;
      if (catalog === 'opportunities') {
        const primary = page.locator('#opportunity-primary-action');
        if (await primary.count()) {
          await expect(primary).toHaveAttribute('href', `/login?next=${encodeURIComponent(privateHref)}`);
        } else {
          testInfo.annotations.push({ type: 'availability', description: `${id}: application unavailable; no protected application action shown.` });
          await expect(page.locator('.public-sticky-action')).toHaveCount(0);
        }
      } else {
        await expect(page.locator(catalog === 'resources' ? '#resource-continue' : '#project-primary-action')).toHaveAttribute('href', privateHref);
      }
      await page.getByRole('link', { name: 'Tiếng Việt', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
      await expect(page.locator('.public-loading')).toHaveCount(0);
      await expect(page.locator('h1')).toHaveCount(1);
      const localizedUrl = new URL(page.url());
      expect(localizedUrl.pathname).toBe(detailUrl.pathname);
      expect(Object.fromEntries(localizedUrl.searchParams)).toEqual({ page: '1', lang: 'vi' });
      await page.locator('.public-back-link').click();
      await expect(page).toHaveURL(new RegExp(`/${catalog}\\?page=1&lang=vi$`));
      await expect(page.locator('[data-public-results]')).toBeVisible();
    }
  });
}

test('public internal link destinations resolve without broken routes', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const paths = new Set<string>();
  const catalogRoutes: Catalog[] = ['projects', 'opportunities', 'resources'];
  for (const path of ['/', '/academy', '/courses', ...catalogRoutes.map(catalog => `/${catalog}`), '/contact', '/privacy', '/terms']) {
    await page.goto(`${path}?lang=en`);
    await expect(page.locator('.public-loading')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCount(1);
    const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')!));
    for (const href of links) {
      if (!/^\/(?:$|\?|#|academy(?:[/?#]|$)|courses(?:[/?#]|$)|projects(?:[/?#]|$)|opportunities(?:[/?#]|$)|resources(?:[/?#]|$)|privacy(?:[/?#]|$)|terms(?:[/?#]|$)|contact(?:[/?#]|$))/.test(href)) continue;
      const target = new URL(href, page.url());
      target.hash = '';
      paths.add(`${target.pathname}${target.search}`);
    }
  }
  const failures = [];
  for (const path of paths) {
    const response = await request.get(path);
    if (response.status() >= 400) failures.push({ path, status: response.status() });
  }
  await testInfo.attach('public-link-smoke', { body: JSON.stringify({ checked: [...paths], failures }, null, 2), contentType: 'application/json' });
  expect(paths.size).toBeGreaterThan(10);
  expect(failures).toEqual([]);
});
