import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, seriousAxeFindings, settle, withQuery } from '../studio-harness/staff-ui-support';
import memberMessages from '../../../src/messages/staff-ui/admin-members.json';
import overviewMessages from '../../../src/messages/staff-ui/admin-overview.json';
import baseEn from '../../../src/messages/en.json';
import baseVi from '../../../src/messages/vi.json';

const USER_ID = '00000000-0000-4000-8000-000000000101';
const routes = ['/admin', '/admin/users', `/admin/users/${USER_ID}`, '/admin/branches', '/admin/branches/ans', '/admin/roles', '/admin/audit', '/admin/mcp', '/admin/enrollment-migration'];

for (const lang of ['en', 'vi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 1024, 768, 390] as const) {
      test(`Canvas Admin ${lang} ${theme} ${width}: readable pages, responsive tables and WCAG AA`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: width <= 768 ? 844 : 900 });
        const browserErrors: string[] = [];
        page.on('pageerror', (error) => browserErrors.push(error.message));
        for (const route of routes) {
          await page.goto(withQuery(route, { lang, theme, userId: USER_ID }));
          await expect(page.locator('.vf-canvas')).toBeVisible();
          await expect(page.locator('main h1')).toBeVisible();
          await expect(page.locator('[data-slot="chart-skeleton"]')).toHaveCount(0);
          await settle(page.locator('main'));
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          await expectNoHorizontalScroll(page);
          expect(await seriousAxeFindings(page), route).toEqual([]);
          if (route === '/admin') {
            const overview = overviewMessages[lang].overview;
            const summary = page.locator('main dl[data-slot="stat-grid"]');
            const expected = [
              { label: overview.kpi.members, href: '/admin/users' },
              { label: overview.kpi.activeLearners, value: '771' },
              { label: overview.kpi.pendingGrading, value: '62', href: '/grading/queue?status=pending' },
              { label: overview.kpi.pendingReview, value: '6', href: '/studio/reviews' },
            ];
            // Waiting counts moved into the compact summary when Work waiting was removed.
            // Check each actual metric and its action, rather than only the number of terms.
            await expect(summary.locator('dt')).toHaveText(expected.map(metric => metric.label));
            for (const metric of expected) {
              const card = summary.locator('[data-slot="stat-card"]').filter({ has: page.getByText(metric.label, { exact: true }) });
              await expect(card).toHaveCount(1);
              await expect(card.locator('dd')).toHaveCount(1);
              const value = card.locator('dd > span').first();
              if (metric.value) await expect(value).toHaveText(metric.value);
              else await expect(value).not.toBeEmpty();
              if (metric.href) await expect(card.getByRole('link', { name: metric.label, exact: true })).toHaveAttribute('href', metric.href);
            }
            await expect(page.getByRole('region', { name: overview.pipeline.title, exact: true })).toHaveCount(0);
            await expect(page.locator('main .admin-work')).toHaveCount(0);
            for (const label of [overview.kpi.pendingGrading, overview.kpi.pendingReview]) {
              await expect(page.locator('main').getByText(label, { exact: true })).toHaveCount(1);
            }
          }
          if (route === '/admin/users') {
            const invite = page.getByRole('button', { name: (lang === 'en' ? baseEn : baseVi).memberAdmin.inviteMember, exact: true });
            expect((await invite.boundingBox())!.height, 'The InstUI icon and label share one compact button row').toBeLessThan(48);
            const table = page.getByRole('table', { name: (lang === 'en' ? baseEn : baseVi).memberAdmin.title, exact: true });
            await expect(table).toBeVisible();
            const box = (await table.boundingBox())!;
            expect(box.x + box.width, 'The real InstUI member table fits its workspace').toBeLessThanOrEqual(width + 1);
          }
          if (['/admin', '/admin/users', '/admin/branches/ans', '/admin/enrollment-migration'].includes(route)) await page.screenshot({ path: info.outputPath(`canvas-${route.split('/').at(-1)}-${lang}-${theme}-${width}.png`) });
        }
        expect(browserErrors).toEqual([]);
      });
    }
  }
}

test('320px invitation actions remain reachable by keyboard and preserve revocation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(withQuery('/admin/users', { lang: 'en', theme: 'dark' }));
  const actions = page.getByRole('button', { name: `${memberMessages.en.members.invitationActions}: thao.nguyen@example.test`, exact: true });
  await expect(actions).toBeVisible();
  await actions.focus();
  await page.keyboard.press('Enter');
  const revoke = page.getByRole('menuitem', { name: baseEn.memberAdmin.revoke, exact: true });
  await expect(revoke).toBeVisible();
  await settle(page.getByRole('menu'));
  expect(await seriousAxeFindings(page)).toEqual([]);
  await revoke.focus();
  await page.keyboard.press('Enter');
  const invitation = page.getByRole('row').filter({ hasText: 'thao.nguyen@example.test' });
  await expect(invitation).not.toContainText('Pending');
  await expect(page.getByRole('menu')).toBeHidden();
  await settle(page.locator('body'));
  await expectNoHorizontalScroll(page);
  expect(await seriousAxeFindings(page)).toEqual([]);
});
