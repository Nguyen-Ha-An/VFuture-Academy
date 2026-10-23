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
  await page.getByLabel('Handle', { exact: true }).fill('google_builder');
  await page.getByLabel('Display name', { exact: true }).fill('Google Builder');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3191/app?from=google');
  await expect(page.locator('#learner-main h1')).toContainText('Google Builder');
  const state = await (await request.get(`${fixture}/__test/state`)).json();
  expect(state).toMatchObject({ writes: 1, exchanges: 1, profile: { handle: 'google_builder', display_name: 'Google Builder' } });
  await page.goto('/welcome?next=%2Fapp%3Ffrom%3Dreturn');
  await expect(page).toHaveURL('http://127.0.0.1:3191/app?from=return');
  expect((await (await request.get(`${fixture}/__test/state`)).json()).writes).toBe(1);
});

test('a duplicate handle preserves input and a corrected retry reaches the dashboard', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);
  await page.getByLabel('Handle', { exact: true }).fill('taken_handle');
  await page.getByLabel('Display name', { exact: true }).fill('Keep My Name');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That handle is already in use.');
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('taken_handle');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Keep My Name');
  await page.getByLabel('Handle', { exact: true }).fill('available_builder');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3191/app');
  await expect(page.locator('#learner-main h1')).toContainText('Keep My Name');
  expect((await (await request.get(`${fixture}/__test/state`)).json()).writes).toBe(1);
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
    await nativePage.getByLabel('Handle', { exact: true }).fill('taken_handle');
    await nativePage.getByLabel('Display name', { exact: true }).fill('Native Builder');
    await nativePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(nativePage.getByRole('alert')).toHaveText('That handle is already in use.');
    await expect(nativePage.getByLabel('Handle', { exact: true })).toHaveValue('taken_handle');
    await expect(nativePage.getByLabel('Display name', { exact: true })).toHaveValue('Native Builder');
    await nativePage.getByLabel('Handle', { exact: true }).fill('native_builder');
    await nativePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(nativePage).toHaveURL('http://127.0.0.1:3191/app?from=native');
    await expect(nativePage.locator('#learner-main h1')).toContainText('Native Builder');
    expect((await (await request.get(`${fixture}/__test/state`)).json()).writes).toBe(1);
  } finally {
    await nativeContext.close();
  }
});
