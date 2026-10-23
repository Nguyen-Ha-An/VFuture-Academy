import { test, expect } from './fixtures';

const preferenceCookie = 'vf_analytics_consent';

test('unknown and denied consent send no analytics, rejection persists, preferences restore focus', async ({ page, context, publicTraffic }) => {
  await page.goto('/resources?lang=en');
  await expect(page.getByRole('heading', { name: 'Your cookie choice' })).toBeVisible();
  await page.locator('#academy-shell-navigation').getByRole('link', { name: 'Courses', exact: true }).click();
  // The analytics flush delay is 200ms. This bounded window verifies absence.
  await page.waitForTimeout(350);
  expect(publicTraffic.analyticsPosts).toEqual([]);
  await page.getByRole('button', { name: 'Reject analytics', exact: true }).click();
  await expect(page.locator('[data-consent-open="true"]')).toHaveCount(0);
  expect((await context.cookies()).find(cookie => cookie.name === preferenceCookie)?.value).toBe('v1.denied');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your cookie choice' })).toHaveCount(0);
  const preferences = page.getByRole('button', { name: 'Cookie preferences', exact: true });
  await preferences.click();
  const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Optional first-party analytics' })).not.toBeChecked();
  await expect(dialog).toContainText('verified account');
  await page.keyboard.press('Escape');
  await expect(preferences).toBeFocused();
  await page.waitForTimeout(350);
  expect(publicTraffic.analyticsPosts).toEqual([]);
});

test('grant sends only future bounded events, withdrawal persists and synchronizes across tabs', async ({ page, context, publicTraffic }) => {
  await page.goto('/resources?lang=en&search=must-not-replay-this');
  await expect(page.getByRole('button', { name: 'Accept analytics' })).toBeVisible();
  await page.waitForTimeout(350);
  expect(publicTraffic.analyticsPosts).toEqual([]);
  await page.getByRole('button', { name: 'Accept analytics', exact: true }).click();
  await page.waitForTimeout(350);
  expect(publicTraffic.analyticsPosts).toEqual([]);
  await page.locator('#academy-shell-navigation').getByRole('link', { name: 'Courses', exact: true }).click();
  await expect.poll(() => publicTraffic.analyticsPosts.length).toBeGreaterThan(0);
  const events = publicTraffic.analyticsPosts.flatMap(body => JSON.parse(body).events);
  expect(events.some(event => event.name === 'public.page_viewed' && event.props.route === 'courses')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('must-not-replay-this');
  expect((await context.cookies()).find(cookie => cookie.name === preferenceCookie)?.value).toBe('v1.granted');
  const other = await context.newPage();
  await other.goto('/academy?lang=en');
  await expect.poll(() => publicTraffic.analyticsPosts.length).toBeGreaterThan(1);
  await other.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
  await expect(other.getByRole('checkbox', { name: 'Optional first-party analytics' })).toBeChecked();
  await page.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reject analytics', exact: true }).click();
  await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === preferenceCookie)?.value).toBe('v1.denied');
  // Close/reopen reads the current shared preference, not the old draft toggle.
  await other.keyboard.press('Escape');
  await other.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
  await expect(other.getByRole('checkbox', { name: 'Optional first-party analytics' })).not.toBeChecked();
  await other.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const count = publicTraffic.analyticsPosts.length;
  await other.locator('#academy-shell-navigation').getByRole('link', { name: 'Resources', exact: true }).click();
  await other.reload();
  await page.waitForTimeout(350);
  expect(publicTraffic.analyticsPosts).toHaveLength(count);
  await other.close();
});
