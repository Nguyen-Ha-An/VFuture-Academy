import { expect, test } from '@playwright/test';

test('the existing assignment file controls retry and replace a private attachment', async ({ page }) => {
  const operations: string[] = [];
  const names = new Map<string, string>();
  let failTransfers = true;
  await page.route('**/api/v1/uploads/reserve', async route => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ purpose: 'submission', courseId: 'pilot-course', itemId: 'pilot-assignment', blockId: null });
    operations.push(input.uploadId);
    names.set(input.uploadId, input.name);
    await route.fulfill({ json: { data: {
      uploadId: input.uploadId, uploadUrl: `/api/v1/uploads/${input.uploadId}/assignment-file`,
      provider: 'vfuture-files', method: 'PUT',
    } } });
  });
  await page.route('**/api/v1/uploads/*/assignment-file', async route => {
    const operation = new URL(route.request().url()).pathname.split('/').at(-2)!;
    expect(route.request().method()).toBe('PUT');
    if (failTransfers) {
      await route.fulfill({ status: 503, json: { error: { code: 'FILES_UNAVAILABLE', message: 'Retry this upload' } } });
    } else {
      await route.fulfill({ json: { data: {
        assetId: 'asset_' + operation.replaceAll('-', ''), name: names.get(operation),
        size: route.request().postDataBuffer()?.byteLength, mime: 'application/pdf',
      } } });
    }
  });

  await page.goto('/assignment-files.html');
  const input = page.getByLabel('Upload files');
  await input.setInputFiles({ name: 'first.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfirst\n%%EOF\n') });
  await expect(page.getByText('Upload failed for first.pdf')).toBeVisible();
  failTransfers = false;
  await page.getByRole('button', { name: 'Retry first.pdf' }).click();
  const first = page.getByRole('link', { name: 'first.pdf' });
  await expect(first).toHaveAttribute('href', /^\/api\/v1\/media\/asset_/);
  const previous = await first.getAttribute('href');
  expect(new Set(operations).size).toBe(1);
  await page.getByRole('button', { name: 'remove', exact: true }).click();
  await input.setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nreplacement\n%%EOF\n') });
  await expect(page.getByRole('link', { name: 'replacement.pdf' })).not.toHaveAttribute('href', previous!);
  await expect(first).toHaveCount(0);
  expect(new Set(operations).size).toBe(2);
});
