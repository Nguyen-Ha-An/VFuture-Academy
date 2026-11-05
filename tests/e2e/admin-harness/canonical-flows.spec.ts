import { expect, test, type Page } from '@playwright/test';
import { withQuery, expectNoHorizontalScroll } from '../studio-harness/staff-ui-support';
import org from '../../../src/messages/staff-ui/admin-org.json';
import en from '../../../src/messages/en.json';

const MEMBER = '00000000-0000-4000-8000-000000000101';
const ACTOR = '00000000-0000-4000-8000-000000000901';
const open = (page: Page, route: string, extra: Record<string, string> = {}) => page.goto(withQuery(route, { lang: 'en', theme: 'light', scenario: 'dense', scope: 'central', ...extra }));

test('school creation failure keeps the draft; retry and edit follow confirmed server responses', async ({ page }) => {
  await open(page, '/admin/branches', { failOnce: 'schools-write' });
  await page.getByRole('button', { name: org.en.org.schools.newSchool, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New school' });
  await sheet.getByRole('textbox', { name: 'Branch ID', exact: true }).fill('qa-school');
  await sheet.getByRole('textbox', { name: 'Name', exact: true }).fill('Learning lab');
  await sheet.getByRole('textbox', { name: 'City', exact: true }).fill('Ho Chi Minh City');
  await sheet.getByRole('button', { name: 'Create branch', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Learning lab');
  await sheet.getByRole('button', { name: 'Create branch', exact: true }).click();
  await expect(sheet).toBeHidden();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Learning lab', exact: true }) });
  await row.getByRole('button', { name: 'Actions for Learning lab', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit school', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit school' });
  await edit.getByRole('textbox', { name: 'Name', exact: true }).fill('Learning laboratory');
  await edit.getByRole('button', { name: 'Save branch', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('link', { name: 'Learning laboratory', exact: true })).toHaveCount(1);
  const writes = await page.evaluate(() => window.__adminFixture.requests.filter((request) => request.path.includes('/studio/branches')));
  expect(writes.map((request) => request.method)).toEqual(['POST', 'POST', 'PUT']);
  expect(writes[2]).toMatchObject({ path: '/api/v1/studio/branches/qa-school', body: { name: 'Learning laboratory', city: 'Ho Chi Minh City' } });
});

test('native role scope popup supports pointer selection, Escape and modal focus return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/admin/roles');
  const trigger = page.getByRole('button', { name: 'New role', exact: true });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Create role' });
  const scope = sheet.getByRole('combobox', { name: 'Scope', exact: true });
  await scope.click();
  const central = page.getByRole('option', { name: 'Central', exact: true });
  await expect(central).toBeVisible();
  const box = (await central.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(391);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(sheet).toBeVisible();
  await scope.click(); await central.click();
  await expect(scope).toHaveValue('Central');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoHorizontalScroll(page);
});

test('role conflict requires loading and reviewing the latest revision before explicit save', async ({ page }) => {
  await open(page, '/admin/roles', { scenario: 'revision-conflict' });
  await page.getByRole('button', { name: 'Actions for Project mentor', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Update role' });
  await sheet.getByRole('textbox', { name: 'Role name', exact: true }).fill('Pending edit');
  await sheet.getByRole('button', { name: 'Update role', exact: true }).click();
  await sheet.getByRole('button', { name: 'Confirm', exact: true }).click();
  const reload = sheet.getByRole('button', { name: org.en.org.roles.discardAndLoadLatest, exact: true });
  await expect(reload).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Role name', exact: true })).toHaveValue('Pending edit');
  await reload.click();
  await expect(sheet.getByRole('textbox', { name: 'Role name', exact: true })).toHaveValue('Project mentor · updated');
  const firstWrites = await page.evaluate(() => window.__adminFixture.requests.filter((request) => request.method === 'PATCH'));
  expect(firstWrites).toHaveLength(1); expect(firstWrites[0].body.version).toBe(3);
  await sheet.getByRole('textbox', { name: 'Role name', exact: true }).fill('Reviewed final role');
  await sheet.getByRole('button', { name: 'Update role', exact: true }).click();
  await sheet.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Reviewed final role' })).toBeVisible();
  const writes = await page.evaluate(() => window.__adminFixture.requests.filter((request) => request.method === 'PATCH'));
  expect(writes).toHaveLength(2);
  expect(writes[0].body.permissions).toEqual(['member.read', 'learning.read']);
  expect(writes[1].body).toMatchObject({ version: 4, scopeKind: 'branch', permissions: ['member.read'] });
});

test('school overview previews real member records and entering school changes request scope', async ({ page }) => {
  await open(page, '/admin/branches/ans', { scenario: 'multi-school' });
  const preview = page.getByRole('region', { name: org.en.org.schoolDetail.previewTitle, exact: true });
  await expect(preview.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true })).toHaveAttribute('href', `/admin/users/${MEMBER}`);
  await expect(page.getByRole('region', { name: org.en.org.schoolDetail.activityTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: en.centralAdmin.enterSchool, exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const scopeChange = await page.evaluate(() => window.__adminFixture.requests.find((request) => request.path.endsWith('/scope')));
  expect(scopeChange?.body).toMatchObject({ scope: 'branch:ans', destination: '/admin', actorId: ACTOR });
  await page.goto(withQuery('/admin/users', { lang: 'en', scenario: 'multi-school', scope: 'branch:ans' }));
  await expect(page.getByRole('link', { name: 'Nguyễn Minh Anh', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trần Gia Bảo', exact: true })).toHaveCount(0);
});

test('school fixture authority rejects foreign-school grants and hides global account tools', async ({ page }) => {
  await open(page, `/admin/users/${MEMBER}`, { scope: 'branch:ans', scenario: 'multi-school' });
  await expect(page.getByRole('heading', { level: 1, name: 'Nguyễn Minh Anh', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable login', exact: true })).toHaveCount(0);
  const result = await page.evaluate(async ({ member, actor }) => {
    const response = await fetch(`/api/v1/admin/users/${member}?scope=branch%3Aans&actorId=${actor}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'role', roleId: 'teacher', branchId: 'dewey', enabled: true }) });
    return { status: response.status, body: await response.json() };
  }, { member: MEMBER, actor: ACTOR });
  expect(result.status).toBe(403); expect(result.body.error.code).toBe('FORBIDDEN');
});

test('migration pending state disables duplicate submission and presents confirmed skipped reasons', async ({ page }) => {
  await open(page, '/admin/enrollment-migration', { busy: 'migration' });
  const course = page.getByRole('combobox', { name: en.adminMigration.course, exact: true });
  await course.click(); await page.getByRole('option', { name: 'Python foundations', exact: true }).click();
  const submit = page.getByRole('button', { name: en.adminMigration.submit, exact: true });
  await submit.click();
  await expect(course).toBeDisabled();
  await expect(page.getByRole('button', { name: en.adminMigration.running, exact: true })).toBeDisabled();
  await page.evaluate(() => window.__adminFixture.releaseBusy());
  await expect(page.getByText('Learning progress conflicts with the latest version.', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__adminFixture.requests.filter((request) => request.path.endsWith('/enrollments/migrate')));
  expect(requests).toHaveLength(1); expect(requests[0].path).toBe('/api/v1/studio/courses/python-foundations/enrollments/migrate');
});

test('Azure backup-account failure retries the same operation and never supplies a password', async ({ page }) => {
  await open(page, '/admin/users', { failOnce: 'accounts-write' });
  await page.getByRole('heading', { name: 'Members', exact: true }).waitFor();
  const azureEnabled = await page.evaluate(async () => (await (await fetch('/api/v1/admin/options?scope=central')).json()).data.azureAccountAdmin);
  test.skip(!azureEnabled, 'Run this actual account-control case with ACADEMY_FIXTURE_BACKEND=azure; legacy backend mode has no Azure account administration.');
  const form = page.getByRole('region', { name: 'Create email backup account', exact: true });
  await form.getByRole('textbox', { name: 'Display name', exact: true }).fill('Backup learner');
  await form.getByRole('textbox', { name: 'Email', exact: true }).fill('backup.learner@example.test');
  await form.getByRole('button', { name: 'Create email backup account', exact: true }).click();
  const retry = form.getByRole('button', { name: 'Retry pending change', exact: true });
  await expect(retry).toBeVisible(); await retry.click();
  await expect(form.getByRole('status')).toContainText('No password is shared');
  const writes = await page.evaluate(() => window.__adminFixture.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/accounts')));
  expect(writes).toHaveLength(2); expect(writes[0].body.operationId).toBe(writes[1].body.operationId);
  expect(writes[1].body.action).toBe('retry'); expect(writes[0].body).not.toHaveProperty('password');
  await expect(page.getByRole('link', { name: 'Backup learner', exact: true })).toBeVisible();
});
