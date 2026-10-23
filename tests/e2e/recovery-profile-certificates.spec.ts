import { expect, test } from '@playwright/test';

import { setEnglishLocale } from './support/auth';
import { withDisposableProfileCertificateFixture } from './support/profile-certificate-fixture';

test.describe('@recovery-13 profile certificates', () => {
  test('completes once, issues once, downloads and verifies the certificate, and honors profile privacy', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const required = [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SEED_ADMIN_EMAIL,
      process.env.NEXT_PUBLIC_APP_URL,
    ];
    if (required.some((value) => !value)) {
      const reason = 'Profile certificate acceptance requires guarded Supabase credentials, the seeded admin email, and canonical app URL.';
      if (process.env.CI) throw new Error(reason);
      test.skip(true, reason);
    }
    const appURL = baseURL ?? 'http://127.0.0.1:3000';

    await withDisposableProfileCertificateFixture(async (fixture) => {
      const learner = await browser.newContext({ baseURL: appURL });
      const anonymous = await browser.newContext({ baseURL: appURL });
      try {
        await Promise.all([setEnglishLocale(learner, appURL), setEnglishLocale(anonymous, appURL)]);
        const page = await learner.newPage();
        await page.goto('/login');
        await page.getByLabel('Email').fill(fixture.learner.email);
        await page.getByLabel('Password').fill(fixture.learner.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(/\/(app|welcome)(?:\/|$)/);

        const enrollment = await page.request.post(`/api/v1/courses/${fixture.courseId}/enroll`);
        expect(enrollment.ok(), `Disposable certificate enrollment failed with HTTP ${enrollment.status()}`).toBeTruthy();
        const viewed = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/v1/progress/viewed'
          && response.request().method() === 'POST', { timeout: 60_000 });
        await page.goto(`/app/courses/${fixture.courseId}/items/${fixture.lessonId}`);
        const completedResponse = await viewed;
        expect(completedResponse.ok(), `Viewed completion failed with HTTP ${completedResponse.status()}`).toBeTruthy();
        await expect(page.getByRole('button', { name: 'Completed', exact: true })).toBeVisible();

        await expect.poll(() => fixture.receiptCounts(), { timeout: 45_000 }).toEqual({
          completions: 1,
          certificates: 1,
          xp: 1,
          evidence: 1,
        });
        const repeated = await page.request.post('/api/v1/progress/viewed', {
          data: { courseId: fixture.courseId, itemId: fixture.lessonId },
        });
        expect(repeated.ok(), `Repeated completion request failed with HTTP ${repeated.status()}`).toBeTruthy();
        await expect.poll(() => fixture.receiptCounts()).toEqual({
          completions: 1,
          certificates: 1,
          xp: 1,
          evidence: 1,
        });

        const certificate = await fixture.certificate();
        if (!certificate) throw new Error('The disposable completion did not produce a certificate.');
        await page.goto('/app/profile');
        await expect(page.getByRole('heading', { name: fixture.courseTitle })).toBeVisible();
        await expect(page.getByRole('link', { name: `Verify certificate ${certificate.serial}` })).toHaveAttribute(
          'href',
          `/verify/${certificate.verificationCode}`,
        );

        const download = await page.request.get(`/api/v1/me/certificates/${certificate.id}/download`, { maxRedirects: 0 });
        expect(download.status()).toBe(302);
        expect(download.headers()['cache-control']).toBe('private, no-store');
        const signedUrl = download.headers().location;
        expect(signedUrl).toBeTruthy();
        const artifact = await page.request.get(signedUrl!);
        expect(artifact.ok()).toBeTruthy();
        expect(artifact.headers()['content-type']).toContain('application/pdf');
        const pdf = Buffer.from(await artifact.body());
        expect(pdf.byteLength).toBeGreaterThan(1_000);
        expect(pdf.toString('latin1')).toContain('/FontFile2');
        const verificationUrl = `${fixture.canonicalOrigin}/verify/${certificate.verificationCode}`;
        expect(pdf.toString('latin1')).toContain(`/URI (${verificationUrl})`);

        const verifyApi = await anonymous.request.get(`/api/v1/certificates/verify/${certificate.verificationCode}`);
        expect(verifyApi.ok()).toBeTruthy();
        await expect(verifyApi.json()).resolves.toMatchObject({
          data: {
            learnerDisplayName: fixture.learner.displayName,
            courseTitle: fixture.courseTitle,
            serial: certificate.serial,
          },
        });
        const verificationPage = await anonymous.newPage();
        await verificationPage.goto(`/verify/${certificate.verificationCode}`);
        await expect(verificationPage.getByRole('heading', { name: 'Verified certificate' })).toBeVisible();
        await expect(verificationPage.getByText(fixture.learner.displayName)).toBeVisible();

        const privateResponse = await anonymous.request.get(`/u/${fixture.learner.handle}`);
        expect(privateResponse.status()).toBe(404);
        const visibility = page.getByRole('checkbox', { name: 'Make my profile public' });
        await visibility.check();
        const visibilityForm = visibility.locator('xpath=ancestor::form');
        const [publicSave] = await Promise.all([
          page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/v1/profile/public'),
          visibilityForm.getByRole('button', { name: 'Save', exact: true }).click(),
        ]);
        expect(publicSave.ok()).toBeTruthy();
        await expect(visibility.locator('xpath=ancestor::form').getByRole('status')).toHaveText('Saved.');
        const publicPage = await anonymous.newPage();
        await publicPage.goto(`/u/${fixture.learner.handle}`);
        await expect(publicPage.getByRole('heading', { name: fixture.learner.displayName })).toBeVisible();
        await expect(publicPage.getByRole('link', { name: `Verify ${fixture.courseTitle} certificate` })).toHaveAttribute(
          'href',
          `/verify/${certificate.verificationCode}`,
        );

        await visibility.uncheck();
        const [privateSave] = await Promise.all([
          page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/v1/profile/public'),
          visibilityForm.getByRole('button', { name: 'Save', exact: true }).click(),
        ]);
        expect(privateSave.ok()).toBeTruthy();
        await expect(visibility.locator('xpath=ancestor::form').getByRole('status')).toHaveText('Saved.');
        const privateAgain = await anonymous.request.get(`/u/${fixture.learner.handle}`);
        expect(privateAgain.status()).toBe(404);
      } finally {
        await Promise.all([learner.close(), anonymous.close()]);
      }
    });
  });
});
