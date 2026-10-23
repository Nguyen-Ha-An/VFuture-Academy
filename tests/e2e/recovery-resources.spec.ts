import { expect, test, type BrowserContext } from '@playwright/test';
import { openRolePage, unavailableRoleStorageStateMessage } from './support/auth';
import { withDisposableResource } from './support/resource-fixture';

test.describe.configure({ timeout: 180_000 });

test('@recovery-10 publishes current resource metadata and attachment, then updates it without unpublishing', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Resource acceptance requires an explicit application origin.');
  const roleError = unavailableRoleStorageStateMessage(['admin', 'learner']);
  if (roleError) throw new Error(roleError);
  const contexts: BrowserContext[] = [];
  try {
    const { context: adminContext, page: admin } = await openRolePage(browser, 'admin', new URL(baseURL).origin);
    contexts.push(adminContext);
    const { context: learnerContext, page: learner } = await openRolePage(browser, 'learner', new URL(baseURL).origin);
    contexts.push(learnerContext);
    await withDisposableResource(async (fixture) => {
      fixture.registerAdminRequest(admin.request);
      const document = { schemaVersion: 1, kind: 'resource', id: fixture.id, languages: ['vi', 'en'], defaultLanguage: 'en', title: { vi: fixture.title, en: fixture.title }, summary: { vi: 'Tóm tắt phục hồi', en: 'Recovery summary' }, resourceType: 'guide', tags: ['recovery-10'], pathways: ['core-future-skills'], branchScope: { scope: 'global' }, body: { en: { blocks: [{ type: 'paragraph', content: [{ text: 'Published current editor body.' }] }] }, vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Nội dung đã xuất bản.' }] }] } }, attachments: [{ src: { assetId: fixture.assetId }, label: { vi: 'Tệp phục hồi', en: 'Recovery attachment' } }] };
      await admin.goto('/admin/resources/new');
      await admin.getByRole('textbox', { name: 'Resource JSON' }).fill(JSON.stringify(document, null, 2));
      await admin.getByRole('button', { name: 'Save draft' }).click();
      await admin.waitForURL(new RegExp(`/admin/resources/${fixture.id}$`));
      await admin.getByRole('button', { name: 'Publish current changes' }).click();
      await expect(admin.getByRole('status')).toContainText('Resource published.');
      const listResponse = await learner.goto(`/app/resources?type=guide&tag=recovery-10&pathway=core-future-skills&search=${encodeURIComponent(fixture.title)}`);
      expect(listResponse?.status(), 'filtered resource list response').toBeLessThan(400);
      const resourceLink = learner.getByRole('link', { name: fixture.title });
      await expect(resourceLink, 'published resource appears in the filtered list').toBeVisible({ timeout: 20_000 });
      await resourceLink.click({ timeout: 20_000 });
      await expect(learner.getByText('Published current editor body.')).toBeVisible();
      const attachment = learner.getByRole('link', { name: 'Recovery attachment' });
      await expect(attachment).toBeVisible();
      expect((await learner.request.get(await attachment.getAttribute('href') as string)).status()).toBeLessThan(400);
      await admin.goto(`/admin/resources/${fixture.id}`);
      await admin.getByLabel('Title (EN)').fill(fixture.updatedTitle);
      await admin.getByRole('button', { name: 'Update published resource' }).click();
      await expect(admin.getByRole('status')).toContainText('Resource published.');
      const updatedListResponse = await learner.goto(`/app/resources?search=${encodeURIComponent(fixture.updatedTitle)}`);
      expect(updatedListResponse?.status(), 'updated resource list response').toBeLessThan(400);
      await expect(learner.getByRole('link', { name: fixture.updatedTitle })).toBeVisible();
    });
  } finally {
    // The helper needs this authenticated request context to unpublish during cleanup.
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
