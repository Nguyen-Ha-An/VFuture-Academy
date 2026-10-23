import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { openRolePage, unavailableRoleStorageStateMessage } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

test.describe('@recovery-05 question bank discovery', () => {
  test('keeps bank data and validation behind Studio authentication', async ({ request }) => {
    const listing = await request.get('/api/v1/studio/bank');
    const validation = await request.post('/api/v1/studio/bank/validate', {
      data: { id: 'anonymous-question', type: 'true_false', correctAnswer: true },
    });

    expect(listing.status()).toBe(401);
    expect(validation.status()).toBe(401);
  });
});

test.describe('@recovery-05 question bank execution', () => {
  test.describe.configure({ timeout: 120_000 });
  const unavailable = unavailableRoleStorageStateMessage(['admin']);
  test.skip(Boolean(unavailable), unavailable ?? 'Admin role state is available.');

  test('filters, validates and previews a seeded question, reports an invalid import, and opens its usage', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Question bank acceptance requires an explicit application origin.');
    const { context, page } = await openRolePage(browser, 'admin', new URL(baseURL).origin);
    try {
      const response = await page.goto('/admin/bank');
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Question Bank' })).toBeVisible();

      await page.getByLabel('Filter by tag').fill('ai-basics');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(/\/studio\/bank\?.*tags=ai-basics/);
      const questionRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'ai-basics-001', exact: true }) });
      await expect(questionRow).toBeVisible();
      const usage = questionRow.getByRole('link', { name: /Open ai-foundations \/ exam-m1/ }).first();
      await expect(usage).toBeVisible();
      await usage.click();
      await expect(page).toHaveURL(/\/studio\/courses\/ai-foundations#workspace-editor$/, { timeout: 20_000 });

      await page.goto('/admin/bank/ai-basics-001');
      const editor = page.locator('.cm-content[contenteditable="true"][aria-label="Question JSON editor"]');
      // CodeMirror virtualizes its document; DOM text contains only visible lines.
      const sourceResponse = await context.request.get('/api/v1/studio/bank/ai-basics-001');
      expect(sourceResponse.status()).toBe(200);
      const source = await sourceResponse.json() as { data: { latestVersion: { payload: Record<string, unknown> } } };
      const changedQuestion = { ...source.data.latestVersion.payload, tags: ['ai-basics', 'preview-check'] };
      const validationResponse = page.waitForResponse((candidate) => candidate.url().endsWith('/api/v1/studio/bank/validate'));
      await editor.click();
      await editor.press('ControlOrMeta+A');
      await editor.press('Backspace');
      await editor.fill(JSON.stringify(changedQuestion, null, 2));
      expect((await validationResponse).status()).toBe(200);
      await expect(page.getByText('Question is valid.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
      await page.getByRole('region', { name: 'Preview', exact: true }).getByLabel('Language').selectOption('en');
      await expect(page.getByRole('region', { name: 'Preview', exact: true }).locator('span.whitespace-pre-wrap').filter({ hasText: /^Bank question 1: which statement about AI is true\?$/ })).toBeVisible();

      await page.goto('/admin/bank');
      await page.getByRole('button', { name: 'Import bundle' }).click();
      const importDialog = page.getByRole('dialog', { name: 'Import question bundle' });
      const invalidBundle = {
        schemaVersion: 1,
        kind: 'question_bundle',
        id: 'recovery-invalid-bank-import',
        languages: ['en'],
        defaultLanguage: 'en',
        questions: [{
          id: 'recovery-invalid-question',
          type: 'single_choice',
          content: { blocks: [{ type: 'paragraph', content: [{ text: 'Choose one.' }] }] },
          options: [
            { id: 'a', content: { blocks: [{ type: 'paragraph', content: [{ text: 'A' }] }] } },
            { id: 'b', content: { blocks: [{ type: 'paragraph', content: [{ text: 'B' }] }] } },
          ],
          correctAnswer: 'missing',
        }],
      };
      const importEditor = importDialog.getByLabel('Question bundle JSON');
      await importEditor.fill(JSON.stringify(invalidBundle));
      const importResponse = page.waitForResponse((candidate) => candidate.url().endsWith('/api/v1/studio/bank') && candidate.request().method() === 'POST');
      await importDialog.getByRole('button', { name: 'Import questions' }).click();
      expect((await importResponse).status()).toBe(400);
      await expect(importDialog.locator('[aria-live="polite"] li').first()).toBeVisible();
      await expect(importEditor).toHaveValue(JSON.stringify(invalidBundle));

    } finally {
      await context.close();
    }
  });

  test('imports and publishes version 1, then saves and explicitly publishes version 2', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Question bank acceptance requires an explicit application origin.');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Question bank acceptance requires development cleanup credentials.');
    assertE2EResetTarget(supabaseUrl, process.env);

    const questionId = `recovery-bank-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { context, page } = await openRolePage(browser, 'admin', new URL(baseURL).origin);
    let createdQuestion = false;
    try {
      const existing = await admin.from('bank_questions').select('id').eq('id', questionId).maybeSingle();
      if (existing.error) throw new Error(`Question bank precondition check failed for ${questionId}.`);
      expect(existing.data).toBeNull();

      const bundle = {
        schemaVersion: 1,
        kind: 'question_bundle',
        id: `${questionId}-bundle`,
        languages: ['en'],
        defaultLanguage: 'en',
        questions: [{
          id: questionId,
          type: 'true_false',
          tags: ['recovery-bank'],
          difficulty: 'easy',
          content: { blocks: [{ type: 'paragraph', content: [{ text: 'Version one is current.' }] }] },
          correctAnswer: true,
          explanation: { blocks: [{ type: 'paragraph', content: [{ text: 'The published version remains pinned until replacement.' }] }] },
        }],
      };

      await page.goto('/admin/bank');
      await page.getByRole('button', { name: 'Import bundle' }).click();
      const importDialog = page.getByRole('dialog', { name: 'Import question bundle' });
      await importDialog.getByLabel('Question bundle JSON').fill(JSON.stringify(bundle));
      const importResponse = page.waitForResponse((candidate) => candidate.url().endsWith('/api/v1/studio/bank') && candidate.request().method() === 'POST');
      await importDialog.getByRole('button', { name: 'Import questions' }).click();
      const imported = await importResponse;
      expect(imported.status()).toBe(201);
      createdQuestion = true;
      await expect(importDialog.getByText('Question bundle imported.')).toBeVisible();
      await importDialog.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('link', { name: questionId, exact: true }).click();
      await page.getByRole('button', { name: 'Publish' }).click();
      const publishDialog = page.getByRole('dialog', { name: 'Publish this question?' });
      const firstPublishResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/${questionId}/publish`) && candidate.request().method() === 'POST');
      await publishDialog.getByRole('button', { name: 'Publish question' }).click();
      expect((await firstPublishResponse).status()).toBe(200);
      await expect(page.getByText('Question published.')).toBeVisible();

      const versionOneResponse = await context.request.get(`/api/v1/studio/bank/${questionId}`);
      expect(versionOneResponse.status()).toBe(200);
      const versionOne = await versionOneResponse.json() as {
        data: { currentVersionId: string | null; latestVersion: { id: string; version: number; payload: unknown } };
      };
      expect(versionOne.data.latestVersion.version).toBe(1);
      expect(versionOne.data.currentVersionId).toBe(versionOne.data.latestVersion.id);
      const versionOneId = versionOne.data.latestVersion.id;

      const editor = page.locator('.cm-content[contenteditable="true"][aria-label="Question JSON editor"]');
      const versionTwoPayload = {
        ...(versionOne.data.latestVersion.payload as Record<string, unknown>),
        tags: ['recovery-bank', 'version-two'],
      };
      const validationResponse = page.waitForResponse((candidate) => candidate.url().endsWith('/api/v1/studio/bank/validate'));
      await editor.click();
      await editor.press('ControlOrMeta+A');
      await editor.press('Backspace');
      await editor.fill(JSON.stringify(versionTwoPayload, null, 2));
      expect((await validationResponse).status()).toBe(200);
      await expect(page.getByText('Question is valid.')).toBeVisible();

      const saveResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/api/v1/studio/bank/${questionId}`) && candidate.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save new version' }).click();
      expect((await saveResponse).status()).toBe(200);
      await expect(page.getByText('Valid and saved.')).toBeVisible();

      const pendingVersionResponse = await context.request.get(`/api/v1/studio/bank/${questionId}`);
      expect(pendingVersionResponse.status()).toBe(200);
      const pendingVersion = await pendingVersionResponse.json() as {
        data: { status: string; currentVersionId: string | null; latestVersion: { id: string; version: number; payload: unknown } };
      };
      expect(pendingVersion.data.status).toBe('published');
      expect(pendingVersion.data.currentVersionId).toBe(versionOneId);
      expect(pendingVersion.data.latestVersion.version).toBe(2);
      expect(pendingVersion.data.latestVersion.id).not.toBe(versionOneId);
      expect(pendingVersion.data.latestVersion.payload).toMatchObject({ tags: ['recovery-bank', 'version-two'] });

      await page.getByRole('button', { name: 'Publish' }).click();
      const secondPublishResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/${questionId}/publish`) && candidate.request().method() === 'POST');
      await page.getByRole('dialog', { name: 'Publish this question?' }).getByRole('button', { name: 'Publish question' }).click();
      expect((await secondPublishResponse).status()).toBe(200);
      await expect(page.getByText('Question published.')).toBeVisible();

      const versionTwoResponse = await context.request.get(`/api/v1/studio/bank/${questionId}`);
      expect(versionTwoResponse.status()).toBe(200);
      const versionTwo = await versionTwoResponse.json() as {
        data: { currentVersionId: string | null; latestVersion: { id: string; version: number } };
      };
      expect(versionTwo.data.latestVersion.version).toBe(2);
      expect(versionTwo.data.currentVersionId).toBe(versionTwo.data.latestVersion.id);
    } finally {
      await context.close();
      if (createdQuestion) {
        const removedQuestion = await admin.from('bank_questions').delete().eq('id', questionId);
        if (removedQuestion.error) throw new Error(`Question bank cleanup failed for ${questionId}.`);
        const removedAudit = await admin.from('audit_log').delete().eq('target_type', 'bank_question').eq('target_id', questionId);
        if (removedAudit.error) throw new Error(`Question bank audit cleanup failed for ${questionId}.`);
      }
    }
  });
});
