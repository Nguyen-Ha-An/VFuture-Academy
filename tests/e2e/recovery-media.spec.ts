import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { openRolePage, unavailableRoleStorageStateMessage } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

test.describe('@recovery-05 media discovery', () => {
  test('keeps Studio uploads and private media behind authentication', async ({ request }) => {
    const studio = await request.post('/api/v1/studio/media');
    const asset = await request.get('/api/v1/media/asset_missing');

    expect(studio.status()).toBe(401);
    expect(asset.status()).toBe(401);
  });
});

test.describe('@recovery-05 media execution', () => {
  const unavailable = unavailableRoleStorageStateMessage(['admin']);
  test.skip(Boolean(unavailable), unavailable ?? 'Admin role state is available.');

  test('uploads, selects and reuses a private image, then opens an existing usage destination', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Media acceptance requires an explicit application origin.');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Media acceptance requires staging cleanup credentials.');
    assertE2EResetTarget(supabaseUrl, process.env);

    const appURL = new URL(baseURL).origin;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { context, page } = await openRolePage(browser, 'admin', appURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appURL });
    const filename = `recovery-media-${Date.now()}.png`;
    let assetId: string | null = null;

    try {
      const response = await page.goto('/studio/media');
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible();

      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/studio/media') && response.request().method() === 'POST');
      await page.getByLabel('Choose files').setInputFiles({
        name: filename,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      });
      const uploadResponse = await responsePromise;
      expect(uploadResponse.status()).toBe(200);
      const uploadBody = await uploadResponse.json() as { data?: { id?: string } };
      assetId = uploadBody.data?.id ?? null;
      expect(assetId).toMatch(/^asset_/);
      if (!assetId) throw new Error('Upload response did not return an asset id.');

      await expect(page.getByText(filename, { exact: true })).toBeVisible();
      await page.getByRole('checkbox', { name: `Select ${assetId}` }).check();
      await page.getByRole('button', { name: 'Copy selected asset IDs' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(assetId);

      const usage = page.locator('a[href^="/studio/courses/"]').first();
      await expect(usage).toBeVisible();
      await usage.click();
      await expect(page).toHaveURL(/\/studio\/courses\/[^#]+#workspace-editor$/);
    } finally {
      await context.close();
      if (assetId) {
        const record = await admin.from('media_assets').select('bucket,path').eq('id', assetId).maybeSingle();
        if (record.error || !record.data) throw new Error('Uploaded recovery media could not be located for cleanup.');
        const removed = await admin.storage.from(record.data.bucket).remove([record.data.path]);
        if (removed.error) throw new Error('Uploaded recovery media storage cleanup failed.');
        const deleted = await admin.from('media_assets').delete().eq('id', assetId);
        if (deleted.error) throw new Error('Uploaded recovery media database cleanup failed.');
      }
    }
  });
});
