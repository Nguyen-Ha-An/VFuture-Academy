import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { openRolePage, setEnglishLocale, unavailableRoleStorageStateMessage } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

test.describe.configure({ timeout: 120_000 });

const rich = (text: string) => ({ blocks: [{ type: 'paragraph' as const, content: [{ text }] }] });

test.describe('@recovery-11 opportunities', () => {
  test.skip(process.env.HIDE_INTERNAL_CONTENT === '1', 'internal fixtures hidden');
  test('protects an external application handoff and opens the sanitized destination for a learner', async ({ browser, baseURL }) => {
    const unavailable = unavailableRoleStorageStateMessage(['admin', 'learner']);
    test.skip(Boolean(unavailable), unavailable ?? 'Opportunity role states are unavailable.');
    const appURL = baseURL ?? 'http://127.0.0.1:3000';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      const reason = 'External opportunity acceptance requires scoped Supabase cleanup credentials.';
      if (process.env.CI) throw new Error(reason);
      test.skip(true, reason);
    }
    assertE2EResetTarget(supabaseUrl!, process.env);
    const database = createClient(supabaseUrl!, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const id = `recovery-11-external-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const document = {
      id,
      title: { vi: 'Cơ hội ngoài thử nghiệm', en: `Disposable external opportunity ${id}` },
      organization: 'VFuture', type: 'external_program' as const,
      description: { vi: rich('Mô tả'), en: rich('Description') }, eligibility: {},
      recommendedSkills: [], recommendedCourses: [], requiredCourses: [],
      applicationUrl: 'https://example.com/apply', internalApplication: false,
      openAt: null, closeAt: null, startAt: null, endAt: null,
      location: null, online: true, branchScope: { scope: 'global' as const }, featured: false,
    };
    const admin = await openRolePage(browser, 'admin', appURL);
    const learner = await openRolePage(browser, 'learner', appURL);
    const anonymous = await browser.newContext({ baseURL: appURL });
    let primaryError: unknown;
    let namespaceVerified = false;
    const cleanupErrors: Error[] = [];
    try {
      const existing = await database.from('opportunities').select('id').eq('id', id).maybeSingle();
      if (existing.error || existing.data) throw new Error('Disposable opportunity namespace is not empty.');
      namespaceVerified = true;
      const saved = await admin.page.request.post('/api/v1/studio/opportunities', { data: document });
      if (!saved.ok()) throw new Error(`Opportunity save failed: ${await saved.text()}`);
      const savedBody = await saved.json() as { data?: { updated_at?: string } };
      expect(savedBody.data?.updated_at).toBeTruthy();
      const published = await admin.page.request.post(`/api/v1/studio/opportunities/${id}/publish`, {
        data: { document, expectedUpdatedAt: savedBody.data!.updated_at },
      });
      if (!published.ok()) throw new Error(`Opportunity publish failed: ${await published.text()}`);

      await setEnglishLocale(anonymous, appURL);
      const publicPage = await anonymous.newPage();
      await publicPage.goto(`/opportunities/${id}`);
      await expect(publicPage.getByRole('link', { name: 'Apply now' })).toHaveAttribute(
        'href',
        `/login?next=%2Fapp%2Fopportunities%2F${id}`,
      );

      await learner.page.goto(`/app/opportunities/${id}`);
      const application = learner.page.getByRole('link', { name: 'Apply now' });
      await expect(application).toHaveAttribute('href', 'https://example.com/apply');
      await expect(application).toHaveAttribute('target', '_blank');
      await expect(application).toHaveAttribute('rel', 'noopener noreferrer');
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        if (namespaceVerified) {
        const current = await database.from('opportunities')
          .select('id,title,organization,status,updated_at,application_url')
          .eq('id', id)
          .maybeSingle();
        if (current.error) throw new Error('Disposable opportunity cleanup lookup failed.');
        if (current.data) {
          if (current.data.title?.en !== document.title.en
            || current.data.organization !== document.organization
            || current.data.application_url !== document.applicationUrl) {
            throw new Error('Disposable opportunity cleanup marker verification failed.');
          }
          if (current.data.status === 'published') {
            const unpublish = await admin.page.request.put(`/api/v1/studio/opportunities/${id}`, {
              data: { document, expectedUpdatedAt: current.data.updated_at, unpublish: true },
            });
            if (!unpublish.ok()) throw new Error(`Disposable opportunity unpublish failed: HTTP ${unpublish.status()}.`);
          }
          const interestCleanup = await database.from('opportunity_interest').delete().eq('opportunity_id', id);
          const opportunityCleanup = await database.from('opportunities')
            .delete()
            .eq('id', id)
            .eq('organization', document.organization);
          if (interestCleanup.error || opportunityCleanup.error) throw new Error('Disposable opportunity cleanup failed.');
          const absent = await database.from('opportunities').select('id').eq('id', id).maybeSingle();
          if (absent.error || absent.data) throw new Error('Disposable opportunity cleanup verification failed.');
          const auditCleanup = await database.from('audit_log').delete().eq('target_type', 'opportunity').eq('target_id', id);
          const analyticsCleanup = await database.from('analytics_events').delete().contains('props', { opportunityId: id });
          if (auditCleanup.error || analyticsCleanup.error) throw new Error('Disposable opportunity evidence cleanup failed.');
        }
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error('Disposable opportunity cleanup failed.'));
      } finally {
        await Promise.all([admin.context.close(), learner.context.close(), anonymous.close()]);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, 'Opportunity journey cleanup failed.');
    }
    if (primaryError) throw primaryError;
  });

  test('persists and withdraws internal interest using durable server state', async ({ browser, baseURL }) => {
    const unavailable = unavailableRoleStorageStateMessage(['learner']);
    test.skip(Boolean(unavailable), unavailable ?? 'Learner role state is unavailable.');
    const appURL = baseURL ?? 'http://127.0.0.1:3000';
    const learner = await openRolePage(browser, 'learner', appURL);
    const opportunityId = 'recovery-opportunity-open';
    let initialInterested: boolean | null = null;
    try {
      const initialResponse = await learner.page.request.get(`/api/v1/opportunities/${opportunityId}?locale=en`);
      if (!initialResponse.ok()) throw new Error(`Opportunity read failed: ${await initialResponse.text()}`);
      const initial = await initialResponse.json() as { data: { interested: boolean } };
      initialInterested = initial.data.interested;
      await learner.page.goto(`/app/opportunities/${opportunityId}`);

      const firstAction = initial.data.interested ? 'Remove interest' : "I'm interested";
      await learner.page.getByRole('button', { name: firstAction, exact: true }).click();
      await expect(learner.page.getByRole('status')).toHaveText(initial.data.interested ? 'Interest removed' : 'Interest saved');
      const changed = await learner.page.request.get(`/api/v1/opportunities/${opportunityId}?locale=en`);
      expect((await changed.json()).data.interested).toBe(!initial.data.interested);

      await learner.page.getByRole('button', {
        name: initial.data.interested ? "I'm interested" : 'Remove interest', exact: true,
      }).click();
      await expect(learner.page.getByRole('status')).toHaveText(initial.data.interested ? 'Interest saved' : 'Interest removed');
      const restored = await learner.page.request.get(`/api/v1/opportunities/${opportunityId}?locale=en`);
      expect((await restored.json()).data.interested).toBe(initial.data.interested);
    } finally {
      try {
        if (initialInterested !== null) {
          const restore = await learner.page.request.put(`/api/v1/opportunities/${opportunityId}/interest?locale=en`, {
            data: { interested: initialInterested },
          });
          if (!restore.ok()) throw new Error(`Interest cleanup failed: ${await restore.text()}`);
        }
      } finally {
        await learner.context.close();
      }
    }
  });
});
