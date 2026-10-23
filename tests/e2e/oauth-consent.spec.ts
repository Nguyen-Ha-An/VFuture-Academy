import { expectNoWcagViolations } from './support/accessibility';
import { setLocale } from './support/auth';
import { expect, test } from './support/fixtures';

test.describe('Studio OAuth consent accessibility', () => {
  test.use({ role: 'admin' });

  for (const locale of ['en', 'vi'] as const) {
    test(`missing authorization (${locale}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? 'http://127.0.0.1:3000', locale);
      await rolePage.goto('/studio/connect/authorize');
      await expect(rolePage.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(rolePage.getByRole('button', { name: /allow connection|cho phép kết nối/i })).toHaveCount(0);
      await expectNoWcagViolations(rolePage);
    });
  }
});
