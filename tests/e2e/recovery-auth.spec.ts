import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { setEnglishLocale } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

const destination = '/app/profile?tab=skills';

test.describe('@recovery-03 authentication', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    if (!baseURL) throw new Error('Authentication acceptance requires an explicit application origin.');
    await setEnglishLocale(context, baseURL);
  });

  test('retains the action page across signup/login links and provider cancellation', async ({ page }, testInfo) => {
    await page.goto(`/login?${new URLSearchParams({ next: destination })}`);
    await page.locator('a[href^="/signup"]').click();
    await expect(page).toHaveURL(url => url.pathname === '/signup' && url.searchParams.get('next') === destination);
    expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
    await page.screenshot({ path: testInfo.outputPath('signup-return-link.png'), fullPage: true });
    await page.locator('a[href^="/login"]').click();
    await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('next') === destination);
    expect(new URL(page.url()).searchParams.get('next')).toBe(destination);

    await page.goto(`/auth/callback?${new URLSearchParams({ error: 'access_denied', next: destination })}`);
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('provider-cancelled.png'), fullPage: true });
  });

  test('uses the actual protected deep link instead of a spoofed request-path header', async ({ request }) => {
    for (const target of ['/app/profile?tab=skills', '/studio/resources?status=draft']) {
      const response = await request.get(target, {
        headers: { 'x-vfuture-request-path': '/app/leaderboard?scope=global' },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(307);
      const login = new URL(response.headers().location, response.url());
      expect(login.pathname).toBe('/login');
      expect(login.searchParams.get('next')).toBe(target);
    }
  });

  test('keeps a protected deep link through password login and rejects external returns', async ({ page, baseURL }, testInfo) => {
    const email = process.env.SEED_E2E_LEARNER_EMAIL;
    const password = process.env.SEED_LEARNER_PASSWORD;
    if (!email || !password) throw new Error('Configure the seeded learner credentials for authentication acceptance.');
    await page.goto(destination);
    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/app/profile\\?tab=skills$'));
    await expect(page.locator('#learner-main h1')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('password-return.png'), fullPage: true });

    // Clear this test's session, then use an unsafe return URL on a fresh sign-in.
    await page.context().clearCookies();
    await setEnglishLocale(page.context(), baseURL!);
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2Fcollect');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('continues from public discovery through onboarding and explicitly enrolls', async ({ page }, testInfo) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Configure staging administrative access for isolated onboarding acceptance.');
    assertE2EResetTarget(url, process.env);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const email = `recovery-onboarding-${suffix}@vfuture.example`;
    const password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('Could not create the isolated staging onboarding account.');
    const userId = created.data.user.id;
    try {
      const courseDestination = '/app/courses/ai-foundations';
      let enrollmentRequests = 0;
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/courses/ai-foundations/enroll') enrollmentRequests += 1;
      });
      await page.goto('/courses/ai-foundations');
      await page.locator(`a[href="${courseDestination}"]`).click();
      await expect(page).toHaveURL(/\/login\?/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(courseDestination);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/welcome\?/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(courseDestination);
      await page.locator('input[name="handle"]').fill(`recovery-${suffix}`);
      await page.locator('input[name="displayName"]').fill('Recovery Onboarding Sample');
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/app\/courses\/ai-foundations$/);
      await expect(page.locator('#learner-main h1')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Enroll', exact: true })).toBeVisible();
      expect(enrollmentRequests).toBe(0);
      // Enrollment and the subsequent server-component refresh are separate requests.
      const [enrollmentResponse] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/v1/courses/ai-foundations/enroll'),
        page.getByRole('button', { name: 'Enroll', exact: true }).click(),
      ]);
      expect(enrollmentResponse.ok()).toBe(true);
      await expect(page.getByRole('link', { name: 'Continue learning', exact: true })).toBeVisible({ timeout: 15_000 });
      expect(enrollmentRequests).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('onboarding-return.png'), fullPage: true });
    } finally {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) throw new Error('Could not remove the isolated staging onboarding account.');
    }
  });
});
