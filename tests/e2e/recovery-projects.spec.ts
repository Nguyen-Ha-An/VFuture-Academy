import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  openRolePage,
  setEnglishLocale,
  unavailableRoleStorageStateMessage,
  type SeededRole,
} from './support/auth';
import { test, expect } from './support/fixtures';
import { assertE2EResetTarget } from './support/reset';

test.describe.configure({ timeout: 180_000 });
test.skip(process.env.HIDE_INTERNAL_CONTENT === '1', 'internal fixtures hidden');

async function authUserIdByEmail(database: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 100; page += 1) {
    const result = await database.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error('Project recovery Auth namespace lookup failed.');
    const user = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (result.data.users.length < 100) return null;
  }
  throw new Error('Project recovery Auth namespace lookup exceeded its bound.');
}

test('@recovery-12 proposes, reviews, approves, participates, and publishes a disposable project', async ({
  browser,
  baseURL,
}) => {
  const roles: SeededRole[] = ['admin', 'learner', 'precompletionLearner'];
  const unavailable = unavailableRoleStorageStateMessage(roles);
  if (unavailable) throw new Error(unavailable);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const learnerEmail = process.env.SEED_E2E_LEARNER_EMAIL?.trim().toLowerCase();
  const participantEmail = process.env.SEED_E2E_PRECOMPLETION_LEARNER_EMAIL?.trim().toLowerCase();
  if (!supabaseUrl || !serviceRoleKey || !learnerEmail || !participantEmail) {
    const reason = 'Project recovery requires guarded staging cleanup credentials and seeded learner emails.';
    throw new Error(reason);
  }
  assertE2EResetTarget(supabaseUrl!, process.env);

  const appURL = baseURL ?? 'http://127.0.0.1:3000';
  const database = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const marker = Date.now().toString(36);
  const projectId = `recovery-project-${marker}`;
  const title = `Recovery project ${marker}`;
  const outputUrl = `https://example.com/recovery-project/${marker}`;
  let expectedOwnerId: string | null = null;
  let proposalAttempted = false;
  let primaryError: unknown;
  const learner = await openRolePage(browser, 'learner', appURL);
  const participant = await openRolePage(browser, 'precompletionLearner', appURL);
  const admin = await openRolePage(browser, 'admin', appURL);

  try {
    await Promise.all([
      setEnglishLocale(learner.context, appURL),
      setEnglishLocale(participant.context, appURL),
      setEnglishLocale(admin.context, appURL),
    ]);

    const existing = await database.from('projects').select('id').eq('id', projectId).maybeSingle();
    if (existing.error || existing.data) throw new Error('Disposable project id precondition failed.');
    expectedOwnerId = await authUserIdByEmail(database, learnerEmail);
    if (!expectedOwnerId) throw new Error('Seeded project owner was not found.');

    // F5: proposals live on /app/projects/new and need only the current (English) language.
    await learner.page.goto('/app/projects');
    await learner.page.getByRole('link', { name: 'Propose a project' }).first().click();
    await expect(learner.page).toHaveURL(/\/app\/projects\/new$/);
    await learner.page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await learner.page.getByRole('textbox', { name: 'Summary', exact: true }).fill('A disposable proposal for the project recovery journey.');
    await learner.page.getByText('Add Vietnamese version (optional)').click();
    await learner.page.getByRole('textbox', { name: 'Title in Vietnamese' }).fill(`Dự án khôi phục ${marker}`);
    await learner.page.getByRole('button', { name: 'Change link' }).click();
    await learner.page.getByRole('textbox', { name: 'Project link' }).fill(projectId);
    await learner.page.getByRole('button', { name: 'Related courses' }).click();
    await learner.page.getByRole('combobox', { name: 'Search courses' }).fill('AI Foundations');
    await learner.page.getByRole('option', { name: 'AI Foundations' }).first().click();
    await learner.page.keyboard.press('Escape');
    await expect(learner.page.getByRole('button', { name: 'Remove AI Foundations' })).toBeVisible();
    const proposalResponse = learner.page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/projects'
    ));
    proposalAttempted = true;
    await learner.page.getByRole('button', { name: 'Submit proposal' }).click();
    const submitted = await proposalResponse;
    if (!submitted.ok()) throw new Error(`Disposable project proposal failed: HTTP ${submitted.status()}.`);

    const created = await database.from('projects')
      .select('id,owner_id,title,approved,status')
      .eq('id', projectId)
      .maybeSingle();
    if (created.error || created.data?.id !== projectId || typeof created.data.owner_id !== 'string') {
      throw new Error('Disposable project creation could not be verified.');
    }
    // The owner was resolved from the authenticated fixture before submission; never infer cleanup authority from the row.
    if (created.data.owner_id !== expectedOwnerId || created.data.approved !== false
      || created.data.status !== 'idea' || created.data.title?.en !== title) {
      throw new Error('Disposable project creation could not be verified.');
    }

    // The form redirects to the new project with a one-time confirmation, then strips ?submitted=1.
    await expect(learner.page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    await expect(learner.page.getByRole('status').filter({ hasText: 'Proposal submitted for review.' })).toBeVisible();
    await expect(learner.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(learner.page.getByText('Pending review', { exact: true }).first()).toBeVisible();
    await learner.page.goto('/app/projects');
    await expect(learner.page.getByRole('heading', { name: 'Your proposals' })).toBeVisible();
    await expect(learner.page.getByRole('link', { name: `Open ${title}` })).toBeVisible();

    const denied = await participant.page.request.get(`/api/v1/projects/${projectId}`);
    expect(denied.status()).toBe(404);
    const publicBefore = await participant.page.request.get(`/api/v1/public/projects/${projectId}?locale=en`);
    expect(publicBefore.status()).toBe(404);

    const users = await database.auth.admin.listUsers({ page: 1, perPage: 1_000 });
    if (users.error) throw new Error('Disposable project participant lookup failed.');
    const participantUser = users.data.users.find((user) => user.email?.toLowerCase() === participantEmail);
    if (!participantUser) throw new Error('Seeded project participant was not found.');
    const participantProfile = await database.from('profiles')
      .select('display_name,handle')
      .eq('id', participantUser.id)
      .maybeSingle();
    if (participantProfile.error || !participantProfile.data) throw new Error('Project participant profile lookup failed.');
    const participantLabel = participantProfile.data.display_name
      || (participantProfile.data.handle ? `@${participantProfile.data.handle}` : participantUser.id);

    await admin.page.goto(`/admin/projects/${projectId}`);
    await admin.page.getByLabel('Project status').selectOption('showcased');
    await admin.page.getByLabel('Audience scope').selectOption('global');
    await admin.page.getByLabel('Output links').fill(`Bản chạy | Live demo | ${outputUrl}`);
    await admin.page.getByLabel('Team members').fill([
      `${expectedOwnerId} | owner`,
      `${participantUser.id} | member`,
    ].join('\n'));
    await admin.page.getByRole('checkbox', { name: 'Approved for the learner showcase' }).check();
    await admin.page.getByRole('button', { name: 'Save project' }).click();
    await expect(admin.page.getByRole('status')).toHaveText('Project saved.');

    await participant.page.goto('/app/projects');
    await expect(participant.page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
    await participant.page.getByRole('link', { name: `Open ${title}` }).click();
    await expect(participant.page.getByText('Member', { exact: true })).toBeVisible();
    await expect(participant.page.getByRole('link', { name: 'Live demo' })).toHaveAttribute('href', outputUrl);
    await expect(participant.page.getByRole('link', { name: 'AI Foundations' })).toHaveAttribute('href', '/app/courses/ai-foundations');
    await participant.page.getByRole('button', { name: "I'm interested" }).click();
    await expect(participant.page.getByRole('button', { name: 'Interested' })).toBeVisible();

    await learner.page.reload();
    await expect(learner.page.getByRole('heading', { name: 'Interested learners' })).toBeVisible();
    await expect(learner.page.getByRole('region', { name: 'Interested learners' }).getByText(participantLabel, { exact: true })).toBeVisible();

    const publicContext = await browser.newContext({ baseURL: appURL });
    try {
      await setEnglishLocale(publicContext, appURL);
      const publicPage = await publicContext.newPage();
      await publicPage.goto(`/projects/${projectId}`);
      await expect(publicPage.getByRole('heading', { name: title })).toBeVisible();
      await expect(publicPage.getByRole('link', { name: 'Live demo' })).toHaveAttribute('href', outputUrl);
      await expect(publicPage.getByRole('link', { name: 'ai-foundations' })).toHaveAttribute('href', '/courses/ai-foundations');
    } finally {
      await publicContext.close();
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: Error[] = [];
    try {
      if (proposalAttempted && expectedOwnerId) {
        const owned = await database.from('projects').select('id,owner_id,title').eq('id', projectId).maybeSingle();
        if (owned.error) throw new Error('Disposable project cleanup lookup failed.');
        if (owned.data) {
          if (owned.data.owner_id !== expectedOwnerId || owned.data.title?.en !== title) {
            throw new Error('Disposable project cleanup ownership verification failed.');
          }
          const removed = await admin.page.request.delete(`/api/v1/studio/projects/${projectId}`);
          if (!removed.ok()) throw new Error(`Disposable project cleanup failed: HTTP ${removed.status()}.`);
          const absent = await database.from('projects').select('id').eq('id', projectId).maybeSingle();
          if (absent.error || absent.data) throw new Error('Disposable project cleanup verification failed.');
          const audit = await database.from('audit_log').delete().eq('target_type', 'project').eq('target_id', projectId);
          const analytics = await database.from('analytics_events').delete().contains('props', { projectId });
          if (audit.error || analytics.error) throw new Error('Disposable project evidence cleanup failed.');
        }
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error('Disposable project cleanup failed.'));
    }
    await Promise.all([learner.context.close(), participant.context.close(), admin.context.close()]);
    if (cleanupErrors.length) {
      if (primaryError) throw new AggregateError([primaryError, ...cleanupErrors], 'Project journey and verified cleanup both failed.');
      throw new AggregateError(cleanupErrors, 'Disposable project cleanup failed.');
    }
  }
});
