import { expect, test } from '@playwright/test';

import { openRolePage, setEnglishLocale, type SeededRole, unavailableRoleStorageStateMessage } from './support/auth';

const RESOURCE_ID = 'prompting-cheat-sheet';
const OPPORTUNITY_ID = 'ai-build-sprint-01';

test.describe.configure({ timeout: 120_000 });

test.describe('@main-unique ecosystem links and evidence', () => {
  test('connects seeded content to active/completed evidence, public proof, and scoped administration', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Ecosystem acceptance requires an explicit application origin.');
    const roles: SeededRole[] = ['admin', 'completedLearner', 'precompletionLearner', 'branchLead'];
    const roleError = unavailableRoleStorageStateMessage(roles);
    if (roleError) throw new Error(roleError);
    const completedEmail = process.env.SEED_E2E_COMPLETED_LEARNER_EMAIL?.trim().toLowerCase();
    const otherBranchEmail = process.env.SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL?.trim().toLowerCase();
    if (!completedEmail || !otherBranchEmail) {
      throw new Error('Ecosystem acceptance requires the completed and other-branch seeded learner emails.');
    }

    const origin = new URL(baseURL).origin;
    const admin = await openRolePage(browser, 'admin', origin);
    const learner = await openRolePage(browser, 'completedLearner', origin);
    const activeLearner = await openRolePage(browser, 'precompletionLearner', origin);
    const branchLead = await openRolePage(browser, 'branchLead', origin);
    let priorProfilePublic: boolean | null = null;
    let primaryError: unknown;

    try {
      const resource = await learner.page.request.get(`/api/v1/resources/${RESOURCE_ID}?locale=en`);
      expect(resource.ok(), `Seed resource lookup failed with HTTP ${resource.status()}`).toBeTruthy();
      await expect(resource.json()).resolves.toMatchObject({ data: {
        id: RESOURCE_ID, title: 'Prompting cheat sheet', resourceType: 'cheat_sheet',
      } });
      const opportunity = await learner.page.request.get(`/api/v1/opportunities/${OPPORTUNITY_ID}?locale=en`);
      expect(opportunity.ok(), `Seed opportunity lookup failed with HTTP ${opportunity.status()}`).toBeTruthy();
      await expect(opportunity.json()).resolves.toMatchObject({ data: {
        id: OPPORTUNITY_ID, title: 'AI Build Sprint', organization: 'VFuture Academy',
      } });

      const activeCourse = await activeLearner.page.request.get('/api/v1/courses/ai-foundations?locale=en');
      expect(activeCourse.ok(), `Active learner course lookup failed with HTTP ${activeCourse.status()}`).toBeTruthy();
      await expect(activeCourse.json()).resolves.toMatchObject({ data: { enrollment: { status: 'active' } } });
      await activeLearner.page.goto('/app/courses/ai-foundations/items/ml-vs-rules');
      const activeLink = activeLearner.page.getByRole('link', { name: new RegExp(OPPORTUNITY_ID, 'i') });
      await expect(activeLink).toContainText('Recommended next step');
      await activeLink.click();
      const activeCourses = activeLearner.page.getByRole('heading', { name: 'Recommended courses' }).locator('..');
      await expect(activeCourses).toContainText('Active');
      await expect(activeCourses.getByText('Completed', { exact: true })).toHaveCount(0);
      await activeLearner.page.goto('/app/profile');
      await expect(activeLearner.page.getByText('No certificates yet.')).toBeVisible();
      await expect(activeLearner.page.getByRole('link', { name: /Verify certificate/ })).toHaveCount(0);

      const course = await learner.page.request.get('/api/v1/courses/ai-foundations?locale=en');
      expect(course.ok(), `Seed course lookup failed with HTTP ${course.status()}`).toBeTruthy();
      await expect(course.json()).resolves.toMatchObject({ data: { enrollment: { status: 'completed' } } });
      await learner.page.goto('/app/courses/ai-foundations/items/what-is-ai');
      await learner.page.getByRole('link', { name: 'Optional: Prompting cheat sheet' }).click();
      await expect(learner.page).toHaveURL(new RegExp(`/app/resources/${RESOURCE_ID}$`));
      await expect(learner.page.getByRole('heading', { level: 1, name: 'Prompting cheat sheet' })).toBeVisible();

      await learner.page.goto('/app/courses/ai-foundations/items/ml-vs-rules');
      const completedLink = learner.page.getByRole('link', { name: new RegExp(OPPORTUNITY_ID, 'i') });
      await expect(completedLink).toContainText('Recommended next step');
      await completedLink.click();
      await expect(learner.page).toHaveURL(new RegExp(`/app/opportunities/${OPPORTUNITY_ID}$`));
      await expect(learner.page.getByRole('heading', { level: 1, name: 'AI Build Sprint' })).toBeVisible();
      const completedCourses = learner.page.getByRole('heading', { name: 'Recommended courses' }).locator('..');
      await expect(completedCourses.getByRole('link', { name: 'Course ai-foundations' })).toBeVisible();
      await expect(completedCourses).toContainText('Completed');

      await learner.page.goto('/app/profile');
      const skill = learner.page.getByText('ai-literacy', { exact: true });
      await expect(skill).toBeVisible();
      const skillCard = skill.locator('xpath=ancestor::li[1]');
      await skillCard.locator('summary').click();
      await expect(skillCard).toContainText(/course completion|exam passed|assignment approved/i);
      await expect(learner.page.getByRole('link', { name: /Verify certificate/ })).toBeVisible();

      const meResponse = await learner.page.request.get('/api/v1/me');
      expect(meResponse.ok()).toBeTruthy();
      const me = await meResponse.json() as { data?: {
        profile?: { handle?: string | null; profilePublic?: boolean };
        counts?: { completedCourses?: number; certificates?: number; skillEvidence?: number };
      } };
      expect(me.data?.counts?.completedCourses).toBeGreaterThan(0);
      expect(me.data?.counts?.certificates).toBeGreaterThan(0);
      expect(me.data?.counts?.skillEvidence).toBeGreaterThan(0);
      const handle = me.data?.profile?.handle;
      if (!handle || typeof me.data?.profile?.profilePublic !== 'boolean') {
        throw new Error('The completed learner must have a handle and explicit profile visibility.');
      }
      priorProfilePublic = me.data.profile.profilePublic;
      if (!priorProfilePublic) {
        const opened = await learner.page.request.patch('/api/v1/profile/public', { data: { profilePublic: true } });
        expect(opened.ok(), `Opening profile failed with HTTP ${opened.status()}`).toBeTruthy();
      }
      const anonymous = await browser.newContext({ baseURL: origin });
      try {
        await setEnglishLocale(anonymous, origin);
        const publicProfile = await anonymous.newPage();
        await publicProfile.goto(`/u/${encodeURIComponent(handle)}`);
        await expect(publicProfile.getByRole('heading', { name: 'Certificates' })).toBeVisible();
        await expect(publicProfile.getByRole('link', { name: /Verify AI Foundations certificate/i })).toBeVisible();
      } finally {
        await anonymous.close();
      }

      const unscoped = await branchLead.page.request.get(
        `/api/v1/studio/users?query=${encodeURIComponent(completedEmail)}&page=1&pageSize=50`,
      );
      expect(unscoped.status()).toBe(403);
      const scoped = await branchLead.page.request.get(
        `/api/v1/studio/users?query=${encodeURIComponent(completedEmail)}&branchId=vinsmc&page=1&pageSize=50`,
      );
      expect(scoped.ok()).toBeTruthy();
      const scopedBody = await scoped.json() as { data?: { items?: Array<{ displayName: string; branchId: string | null }> } };
      expect(scopedBody.data?.items?.length).toBeGreaterThan(0);
      expect(scopedBody.data?.items?.every((user) => user.branchId === 'vinsmc')).toBe(true);
      const firstUser = scopedBody.data?.items?.[0];
      if (!firstUser) throw new Error('The VinSMC branch must contain the completed learner.');

      const hiddenOther = await branchLead.page.request.get(
        `/api/v1/studio/users?query=${encodeURIComponent(otherBranchEmail)}&branchId=vinsmc&page=1&pageSize=50`,
      );
      expect(hiddenOther.ok()).toBeTruthy();
      expect(((await hiddenOther.json()).data?.items ?? [])).not.toContainEqual(expect.objectContaining({ email: otherBranchEmail }));
      const adminOther = await admin.page.request.get(
        `/api/v1/studio/users?query=${encodeURIComponent(otherBranchEmail)}&page=1&pageSize=50`,
      );
      expect(adminOther.ok()).toBeTruthy();
      expect((await adminOther.json()).data?.items).toContainEqual(expect.objectContaining({
        email: otherBranchEmail, branchId: 'ans',
      }));

      await branchLead.page.goto('/admin/users');
      await expect(branchLead.page.getByLabel('Branch')).toBeDisabled();
      await expect(branchLead.page.getByLabel('Branch')).toHaveValue('vinsmc');
      await branchLead.page.getByLabel('Search by email or handle').fill(completedEmail);
      const search = branchLead.page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/studio/users' && response.request().method() === 'GET');
      await branchLead.page.getByRole('button', { name: 'Search users' }).click();
      expect((await search).ok()).toBeTruthy();
      await expect(branchLead.page.getByRole('heading', { level: 2, name: firstUser.displayName })).toBeVisible();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors: unknown[] = [];
      if (priorProfilePublic !== null) {
        try {
          const restored = await learner.page.request.patch('/api/v1/profile/public', {
            data: { profilePublic: priorProfilePublic },
          });
          if (!restored.ok()) throw new Error(`Profile visibility restore failed with HTTP ${restored.status()}.`);
          const verified = await learner.page.request.get('/api/v1/me');
          if (!verified.ok() || (await verified.json()).data?.profile?.profilePublic !== priorProfilePublic) {
            throw new Error('Profile visibility restore could not be verified.');
          }
        } catch (error) { cleanupErrors.push(error); }
      }
      await Promise.allSettled([admin.context.close(), learner.context.close(), activeLearner.context.close(), branchLead.context.close()]);
      if (cleanupErrors.length) {
        throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, 'Ecosystem journey cleanup failed.');
      }
    }
    if (primaryError) throw primaryError;
  });
});
