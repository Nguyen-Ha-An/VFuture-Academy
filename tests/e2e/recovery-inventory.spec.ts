import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { hasRoleStorageState, roleStorageStatePath, setLocale, type SeededRole } from './support/auth';

const surfaces = [
  { path: '/', audience: 'public', action: 'Start learning', required: true },
  { path: '/login', audience: 'public', action: 'Sign in', required: true },
  { path: '/signup', audience: 'public', action: 'Create account', required: true },
  { path: '/courses', audience: 'public', action: 'Browse courses', required: true },
  { path: '/courses/ai-foundations', audience: 'public', action: 'View course', required: true },
  { path: '/app', audience: 'learner', action: 'Resume learning', required: true },
  { path: '/app/courses', audience: 'learner', action: 'Browse courses', required: true },
  { path: '/app/courses/ai-foundations', audience: 'learner', action: 'Open course', required: true },
  { path: '/app/courses/ai-foundations/items/what-is-ai', audience: 'learner', action: 'Read lesson', required: true },
  { path: '/app/resources', audience: 'learner', action: 'Search resources', required: true },
  { path: '/app/opportunities', audience: 'learner', action: 'Browse opportunities', required: true },
  { path: '/app/projects', audience: 'learner', action: 'Browse projects', required: true },
  { path: '/app/profile', audience: 'learner', action: 'View profile', required: true },
  { path: '/app/leaderboard', audience: 'learner', action: 'View rankings', required: true },
  { path: '/studio', audience: 'admin', action: 'Open Studio', required: true },
  { path: '/studio/courses', audience: 'admin', action: 'Create course', required: true },
  { path: '/studio/courses/ai-foundations', audience: 'admin', action: 'Edit course', required: true },
  { path: '/studio/media', audience: 'admin', action: 'Upload media', required: true },
  { path: '/admin/bank', audience: 'admin', action: 'Edit questions', required: true },
  { path: '/admin/resources', audience: 'admin', action: 'Publish resources', required: true },
  { path: '/admin/opportunities', audience: 'admin', action: 'Publish opportunity', required: true },
  { path: '/admin/projects', audience: 'admin', action: 'Approve project', required: true },
  { path: '/admin/users', audience: 'admin', action: 'Manage users', required: true },
  { path: '/admin/branches', audience: 'admin', action: 'Manage branches', required: true },
  { path: '/admin/analytics', audience: 'admin', action: 'Review analytics', required: true },
  { path: '/admin/audit', audience: 'admin', action: 'Review audit', required: true },
  { path: '/admin/submissions', audience: 'instructor', action: 'Grade work', required: true },
  { path: '/admin/exams', audience: 'instructor', action: 'Review exam results', required: true },
] as const;

test('@recovery-01 runtime readiness and route inventory', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error('An application origin is required for the inventory.');
  const inventory: Array<Record<string, unknown>> = [];
  try {
    for (const audience of ['public', 'learner', 'admin', 'instructor'] as const) {
      const missingRole = audience !== 'public' && !hasRoleStorageState(audience as SeededRole);
      if (missingRole) {
        for (const surface of surfaces.filter(s => s.audience === audience)) inventory.push({ ...surface, status: 'blocked', httpStatus: null, screenshot: null, observation: 'Role storage state missing; page not tested.', actionVerified: false });
        expect.soft(missingRole, `${audience} account must be configured for Phase 01`).toBe(false);
        continue;
      }
      const context = await browser.newContext({ baseURL, ...(audience === 'public' ? {} : { storageState: roleStorageStatePath(audience) }) });
      try {
        await setLocale(context, baseURL, 'vi');
        if (audience === 'learner') {
          const enrollment = await context.request.post('/api/v1/courses/ai-foundations/enroll');
          expect(enrollment.ok(), 'Inventory learner must be enrolled before protected lesson reads').toBe(true);
        }
        for (const surface of surfaces.filter(s => s.audience === audience)) {
          const page = await context.newPage();
          const filename = `${audience}-${surface.path.replace(/[^a-z0-9]+/gi, '-')}.png`;
          let httpStatus: number | null = null;
          let screenshot: string | null = null;
          let status = 'failed';
          let observation = 'Navigation did not complete.';
          try {
            const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            httpStatus = response?.status() ?? null;
            const heading = page.locator('h1').first();
            await heading.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
            const path = new URL(page.url()).pathname;
            const wrongDestination = surface.path === '/studio' ? !path.startsWith('/studio') : path !== surface.path;
            const rendered = await heading.isVisible();
            // Next's route announcer is an accessibility live region, not an app error.
            const alerts = await page.locator('[role="alert"]:not(#__next-route-announcer__)').count();
            const passed = httpStatus === 200 && !wrongDestination && rendered && alerts === 0;
            status = passed ? 'rendered' : 'failed';
            observation = passed ? 'Page rendered; primary action not exercised.' : `HTTP ${httpStatus}; destination ${path}; heading visible: ${rendered}; app alerts: ${alerts}.`;
            await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true });
            screenshot = filename;
            if (surface.required) expect.soft(passed, `${surface.path} must render for ${audience}`).toBe(true);
          } catch {
            if (surface.required) expect.soft(false, `${surface.path} navigation must complete`).toBe(true);
          } finally {
            inventory.push({ ...surface, status, httpStatus, screenshot, observation, actionVerified: false });
            await page.close();
          }
        }
      } finally { await context.close(); }
    }
  } finally {
    const reportPath = testInfo.outputPath('route-inventory.json');
    await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), inventory }, null, 2));
    await testInfo.attach('route-inventory', { path: reportPath, contentType: 'application/json' });
  }
});
