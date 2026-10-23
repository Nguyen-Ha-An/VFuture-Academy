import { expect, test, type Page, type Route } from '@playwright/test';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';

const origin = 'http://127.0.0.1:4184';
const values = { handle: 'future_builder', displayName: 'Nguyễn An' };
type Submitted = typeof values & { next: string };
type Copy = typeof en.auth;
const pageErrors = new WeakMap<Page, string[]>();

async function openForm(page: Page, locale: string, copy: Copy, next?: string) {
  const query = new URLSearchParams({ lang: locale });
  if (next !== undefined) query.set('next', next);
  await page.goto(`/welcome?${query}`);
  await expect(page.getByRole('heading', { name: copy.welcomeTitle })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await page.getByLabel(copy.handle, { exact: true }).fill(values.handle);
  await page.getByLabel(copy.displayName, { exact: true }).fill(values.displayName);
}

async function expectValues(page: Page, copy: Copy) {
  await expect(page.getByLabel(copy.handle, { exact: true })).toHaveValue(values.handle);
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(values.displayName);
}

async function expectDestination(page: Page, submit: () => Promise<unknown>, destination: string) {
  const documentLoaded = page.waitForResponse(response =>
    response.request().isNavigationRequest()
    && response.request().resourceType() === 'document'
    && response.url() === new URL(destination.split('#')[0], origin).href,
  );
  await submit();
  expect((await documentLoaded).ok()).toBe(true);
  await expect(page).toHaveURL(origin + destination);
  await expect(page.getByRole('heading', { name: 'Onboarding destination fixture' })).toBeVisible();
  await expect(page.getByLabel('Destination path')).toHaveText(destination);
  await expect(page.locator('form')).toHaveCount(0);
}

test.beforeEach(async ({ context, page }) => {
  // No remote writes or reads, including if an application import regresses.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue()
    : route.abort('blockedbyclient'));
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

for (const [locale, copy] of [['en', en.auth], ['vi', vi.auth]] as const) {
  test.describe(locale, () => {
    test('successful save leaves welcome and renders a new destination document', async ({ page }) => {
      const submitted: Submitted[] = [];
      await page.route('**/__onboarding/submit', async route => {
        submitted.push(route.request().postDataJSON());
        await route.fulfill({ json: { outcome: 'success' } });
      });
      await openForm(page, locale, copy);
      await expectDestination(page, () => page.getByRole('button', { name: copy.continue, exact: true }).click(), '/app');
      expect(submitted).toHaveLength(1);
      expect(submitted[0]).toMatchObject(values);
    });

    test('duplicate handle preserves both values and a corrected retry navigates', async ({ page }, testInfo) => {
      const submitted: Submitted[] = [];
      await page.route('**/__onboarding/submit', async route => {
        submitted.push(route.request().postDataJSON());
        await route.fulfill({ json: submitted.length === 1
          ? { outcome: 'recoverable', fieldErrors: { handle: 'handleTaken' } }
          : { outcome: 'success' } });
      });
      await openForm(page, locale, copy);
      await page.getByRole('button', { name: copy.continue, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText(copy.handleTaken);
      await expectValues(page, copy);
      await expect(page.getByLabel(copy.handle, { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel(copy.handle, { exact: true })).toBeFocused();
      await expect(page).toHaveURL(/\/welcome\?/);
      await page.screenshot({ path: testInfo.outputPath('duplicate-values-preserved.png'), fullPage: true });
      await page.getByLabel(copy.handle, { exact: true }).fill('future_builder_2');
      await expectDestination(page, () => page.getByRole('button', { name: copy.continue, exact: true }).click(), '/app');
      expect(submitted).toHaveLength(2);
      expect(submitted[1]).toMatchObject({ ...values, handle: 'future_builder_2' });
    });

    for (const error of ['profileUpdateError', 'profileLoadError'] as const) {
      test(`${error} preserves input and permits retry`, async ({ page }) => {
        let attempts = 0;
        await page.route('**/__onboarding/submit', route => {
          attempts++;
          return route.fulfill({ json: attempts === 1
            ? { outcome: 'recoverable', error }
            : { outcome: 'success' } });
        });
        await openForm(page, locale, copy);
        await page.getByRole('button', { name: copy.continue, exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText(copy[error]);
        await expectValues(page, copy);
        await expect(page).toHaveURL(/\/welcome\?/);
        await expect(page.getByRole('button', { name: copy.continue, exact: true })).toBeEnabled();
        await expectDestination(page, () => page.getByRole('button', { name: copy.continue, exact: true }).click(), '/app');
        expect(attempts).toBe(2);
      });
    }

    test('pending disables duplicate submit until the controlled response resolves', async ({ page }, testInfo) => {
      let attempts = 0;
      let resolveRequest!: (route: Route) => void;
      const requestStarted = new Promise<Route>(resolve => { resolveRequest = resolve; });
      await page.route('**/__onboarding/submit', route => {
        attempts++;
        resolveRequest(route);
      });
      await openForm(page, locale, copy);
      await page.getByRole('button', { name: copy.continue, exact: true }).click();
      const request = await requestStarted;
      const pendingButton = page.getByRole('button', { name: copy.continuing, exact: true });
      await expect(pendingButton).toBeDisabled();
      await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByLabel(copy.handle, { exact: true })).toBeDisabled();
      await expect(page.getByLabel(copy.displayName, { exact: true })).toBeDisabled();
      await expectValues(page, copy);
      // A real pointer click and Enter while the network response is held open.
      await pendingButton.click({ force: true });
      await page.keyboard.press('Enter');
      await expect(pendingButton).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('pending.png'), fullPage: true });
      await request.fulfill({ json: { outcome: 'recoverable', error: 'profileUpdateError' } });
      await expect(page.getByRole('alert')).toHaveText(copy.profileUpdateError);
      await expect(page.getByRole('button', { name: copy.continue, exact: true })).toBeEnabled();
      await expectValues(page, copy);
      expect(attempts).toBe(1);
    });

    test('safe deep link retains its path, query, and hash through submit and navigation', async ({ page }) => {
      const next = '/app/courses/ai-basics/items/lesson-1?mode=practice&from=google#exercise';
      let submitted: Submitted | undefined;
      await page.route('**/__onboarding/submit', route => {
        submitted = route.request().postDataJSON();
        return route.fulfill({ json: { outcome: 'success' } });
      });
      await openForm(page, locale, copy, next);
      await expectDestination(page, () => page.getByRole('button', { name: copy.continue, exact: true }).click(), next);
      expect(submitted).toEqual({ ...values, next });
    });

    for (const next of ['https://example.invalid/steal', '//example.invalid/steal', '/welcome?loop=1']) {
      test(`unsafe destination ${next} falls back to the local dashboard fixture`, async ({ page }) => {
        let submitted: Submitted | undefined;
        await page.route('**/__onboarding/submit', route => {
          submitted = route.request().postDataJSON();
          return route.fulfill({ json: { outcome: 'success' } });
        });
        await openForm(page, locale, copy, next);
        await expectDestination(page, () => page.getByRole('button', { name: copy.continue, exact: true }).click(), '/app');
        expect(submitted).toEqual({ ...values, next: '/app' });
      });
    }
  });
}
