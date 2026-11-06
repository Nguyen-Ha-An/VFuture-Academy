import { expect, test } from '@playwright/test';
const fixture = 'http://127.0.0.1:3192';

test.beforeEach(async ({ request, context }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:3191' }]);
});

test('PKCE callback → onboarding action → real authenticated dashboard, without refreshing', async ({ page, request }) => {
  await page.goto('/login?next=%2Fapp%3Ffrom%3Dgoogle');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);
  await expect(page.getByLabel('Handle', { exact: true })).toHaveCount(0);
  await page.getByLabel('Display name', { exact: true }).fill('Google Builder');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3191/app?from=google');
  await expect(page.locator('#learner-main h1')).toHaveText('Dashboard');
  const state = await (await request.get(`${fixture}/__test/state`)).json();
  expect(state).toMatchObject({ writes: 1, exchanges: 1, profile: { handle: 'STU-google_learner', display_name: 'Google Builder' } });
  await page.goto('/welcome?next=%2Fapp%3Ffrom%3Dreturn');
  await expect(page).toHaveURL('http://127.0.0.1:3191/app?from=return');
  expect((await (await request.get(`${fixture}/__test/state`)).json()).writes).toBe(1);
});

test('a missing name preserves the form and a corrected retry reaches the dashboard', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a display name up to 120 characters.');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('');
  await page.getByLabel('Display name', { exact: true }).fill('Keep My Name');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3191/app');
  await expect(page.locator('#learner-main h1')).toHaveText('Dashboard');
  expect(await (await request.get(`${fixture}/__test/state`)).json()).toMatchObject({ writes: 1, profile: { display_name: 'Keep My Name', handle: 'STU-google_learner' } });
});

test('native form submission retains errors and completes when browser JavaScript is unavailable', async ({ page, browser, request }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);
  // Reuse only this test's local fixture session to exercise progressive enhancement.
  const nativeContext = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const nativePage = await nativeContext.newPage();
    await nativePage.goto('http://127.0.0.1:3191/welcome?next=%2Fapp%3Ffrom%3Dnative');
    await nativePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(nativePage.getByRole('alert')).toHaveText('Enter a display name up to 120 characters.');
    await expect(nativePage.getByLabel('Display name', { exact: true })).toHaveValue('');
    await nativePage.getByLabel('Display name', { exact: true }).fill('Native Builder');
    await nativePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(nativePage).toHaveURL('http://127.0.0.1:3191/app?from=native');
    await expect(nativePage.locator('#learner-main h1')).toHaveText('Dashboard');
    expect(await (await request.get(`${fixture}/__test/state`)).json()).toMatchObject({ writes: 1, profile: { display_name: 'Native Builder', handle: 'STU-google_learner' } });
  } finally {
    await nativeContext.close();
  }
});
