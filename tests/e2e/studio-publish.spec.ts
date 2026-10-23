import { expect, test } from '@playwright/test';
import { openRolePage, unavailableRoleStorageStateMessage } from './support/auth';
import { withDisposableStudioImport } from './support/studio-import-fixture';

test.describe('@main-unique disposable Studio import and publication', () => {
  test('applies JSON locally, previews without writes, saves all and publishes the saved revision through review', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('Studio acceptance requires an application origin.');
    const roleError = unavailableRoleStorageStateMessage(['admin']);
    if (roleError) throw new Error(roleError);
    const { context, page } = await openRolePage(browser, 'admin', new URL(baseURL).origin);
    await page.setViewportSize({ width: 1440, height: 1000 });
    try {
      await withDisposableStudioImport(async ({ courseId, inlineCourse, originalLessonSource }) => {
        const writes: string[] = [];
        page.on('request', request => {
          if (['PUT', 'PATCH', 'DELETE'].includes(request.method()) || (request.method() === 'POST' && !/\/preview|\/validate/.test(request.url()))) writes.push(request.url());
        });
        const workspaceResponse = await page.goto(`/studio/courses/${courseId}`);
        expect(workspaceResponse?.status()).toBeLessThan(400);
        await page.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const imported = page.getByRole('dialog', { name: 'Import course content' });
        await imported.getByLabel('JSON document').fill(JSON.stringify(inlineCourse, null, 2));
        await imported.getByLabel('Replace the current course draft with this document').check();
        await imported.getByRole('button', { name: 'Apply to draft' }).click();
        await expect(imported).not.toBeVisible();
        expect(writes).toEqual([]);
        const outline = page.getByRole('navigation', { name: 'Course outline' });
        await outline.getByRole('button', { name: /^What is AI/ }).click();
        const editor = page.getByRole('textbox', { name: 'JSON editor for what-is-ai' });
        await expect(editor).toBeVisible();
        const preview = page.getByRole('region', { name: 'Preview', exact: true });
        await preview.getByRole('button', { name: 'en', exact: true }).click();
        await expect(preview.getByRole('heading', { name: 'What is AI?' })).toBeVisible();
        await editor.fill('{broken');
        await expect(preview.getByText('Showing the last valid preview.')).toBeVisible();
        await expect(preview.getByRole('heading', { name: 'What is AI?' })).toBeVisible();
        await editor.fill(originalLessonSource);
        await expect(preview.getByText('Showing the last valid preview.')).not.toBeVisible();
        expect(writes).toEqual([]);
        const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/draft/workspace'));
        await page.getByRole('button', { name: 'Save draft', exact: true }).click();
        const saveResponse = await saved;
        expect(saveResponse.status()).toBe(200);
        expect(saveResponse.request().headers()['if-match']).toBeTruthy();
        const savedBody = saveResponse.request().postDataJSON();
        expect(Object.keys(savedBody.items).length).toBeGreaterThan(1);
        await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
        await page.reload();
        await outline.getByRole('button', { name: /^What is AI/ }).click();
        await expect(editor).toBeVisible();
        // Publishing goes through review (PublishDialog is gone): submit the saved revision from the
        // workspace's workflow panel, then approve and publish it from /studio/reviews with the course checklist.
        await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
        await expect(page.getByText('Pending review. Editing is locked so the submitted snapshot remains exact.')).toBeVisible();

        const courseTitle = (inlineCourse as { title?: { en?: string } }).title?.en;
        if (!courseTitle) throw new Error('The disposable course has no English title.');
        await page.goto('/studio/reviews');
        const request = page.getByRole('region', { name: 'Review requests' }).getByRole('listitem').filter({ hasText: courseTitle });
        await request.getByRole('button', { name: 'Read submitted version', exact: true }).first().click();
        const detail = page.getByRole('region', { name: `Read submitted version: ${courseTitle}` });
        await detail.getByRole('button', { name: 'Approve and publish', exact: true }).click();
        const publishDialog = page.getByRole('dialog', { name: 'Approve and publish' });
        await expect(publishDialog).toBeVisible();
        // The dialog names the content id, so a same-titled seeded course can never be published by mistake.
        await expect(publishDialog).toContainText(courseId);
        await publishDialog.getByLabel('Review note (required)').fill('Disposable acceptance publication.');
        const checklist = publishDialog.getByRole('checkbox');
        await expect(checklist).toHaveCount(6);
        for (const checkbox of await checklist.all()) await checkbox.check();
        const published = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/approve-and-publish'));
        await publishDialog.getByRole('button', { name: 'Approve and publish', exact: true }).click();
        const publishResponse = await published;
        expect(publishResponse.status()).toBe(200);
        await expect(publishDialog).toBeHidden();

        await page.goto(`/studio/courses/${courseId}`);
        await page.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('button', { name: 'Versions', exact: true }).click();
        const versions = page.getByRole('dialog', { name: 'Published versions' });
        await expect(versions.getByRole('heading', { name: 'Version 1' })).toBeVisible();
        const download = page.waitForEvent('download');
        await versions.getByRole('link', { name: 'Export bundle' }).click();
        expect((await download).suggestedFilename()).toBe(`${courseId}-v1.zip`);
      });
    } finally { await context.close(); }
  });
});
