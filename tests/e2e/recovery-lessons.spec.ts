import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { compileCourse, InMemoryResolver, parseWorkspace, type CourseWorkspace } from '@/content-engine';
import { setEnglishLocale } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

function lessonWorkspace(courseId: string, suffix: string, revision: 1 | 2): CourseWorkspace {
  const lessonTitle = revision === 1 ? `Resume lesson ${suffix}` : `Replacement lesson ${suffix}`;
  return {
    manifest: {
      schemaVersion: 1,
      kind: 'course',
      id: courseId,
      title: revision === 1 ? `Recovery runtime ${suffix}` : `Recovery runtime ${suffix} v2`,
      summary: 'A dedicated browser acceptance fixture for persisted lesson progress.',
      languages: ['en'],
      defaultLanguage: 'en',
      level: 'foundation',
      difficulty: 'beginner',
      pathway: 'core-future-skills',
      learningOutcomes: ['Save and resume a lesson response.'],
      access: { scope: 'global' },
      completion: { rules: [{ type: 'all_items' }] },
      modules: [{
        id: 'runtime-module',
        title: 'Runtime module',
        items: [
          { type: 'lesson', id: 'resume-lesson' },
          { type: 'lesson', id: 'next-lesson' },
        ],
      }],
    },
    items: {
      'resume-lesson': {
        schemaVersion: 1,
        kind: 'lesson',
        id: 'resume-lesson',
        title: lessonTitle,
        objectives: ['Persist one reflection.'],
        estimatedMinutes: 3,
        completion: { mode: 'activities' },
        blocks: [{
          id: 'resume-reflection',
          type: 'reflection',
          prompt: { blocks: [{ type: 'paragraph', content: [{ text: 'What will you build next?' }] }] },
          required: true,
          minChars: 5,
          maxChars: 400,
        }],
      },
      'next-lesson': {
        schemaVersion: 1,
        kind: 'lesson',
        id: 'next-lesson',
        title: `Next lesson ${suffix}`,
        objectives: ['Reach the next lesson.'],
        estimatedMinutes: 2,
        completion: { mode: 'view' },
        blocks: [{ type: 'paragraph', content: [{ text: 'This is the next lesson.' }] }],
      },
    },
  } as CourseWorkspace;
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw new Error('Lesson fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (result.data.users.length < 1_000) return null;
  }
}

function oneRow(data: Record<string, unknown> | Record<string, unknown>[] | null) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

test.describe('@recovery-07 persisted lesson journey', () => {
  test('resumes saved work after sign-in and stays pinned when a new version is published', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('Lesson runtime acceptance requires an explicit application origin.');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
    if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
      throw new Error('Lesson runtime acceptance requires staging cleanup credentials and the seeded admin email.');
    }
    assertE2EResetTarget(supabaseUrl, process.env);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const courseId = `recovery-lessons-${suffix}`;
    const learnerEmail = `${courseId}@vfuture.example`;
    const learnerPassword = `${randomUUID()}${randomUUID()}`;
    const learnerName = `Recovery Lesson ${suffix}`;
    const marker = `recovery-lesson:${suffix}`;
    if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${learnerPassword}\n`);
    const responseText = `Persistent reflection ${suffix}`;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [adminUser, existingLearner, existingCourse] = await Promise.all([
      findUserByEmail(admin, adminEmail),
      findUserByEmail(admin, learnerEmail),
      admin.from('courses').select('id').eq('id', courseId).maybeSingle(),
    ]);
    if (!adminUser) throw new Error('The seeded admin fixture does not exist.');
    if (existingLearner || existingCourse.error || existingCourse.data) throw new Error('Disposable lesson namespace is not empty.');
    let learnerId: string | null = null;
    let courseCreated = false;

    const publish = async (workspace: CourseWorkspace) => {
      const compilation = await compileCourse(workspace, new InMemoryResolver({}), { publish: true, locales: ['en'] });
      if (!compilation.ok || !compilation.compiled) {
        throw new Error(`Lesson fixture did not compile: ${JSON.stringify(compilation.diagnostics)}`);
      }
      const parsed = parseWorkspace(workspace).parsed;
      if (!parsed) throw new Error('Lesson fixture source could not be parsed.');
      const compiled = {
        ...compilation.compiled,
        items: Object.fromEntries(Object.entries(compilation.compiled.items).map(([id, item]) => [id, {
          ...item, source: parsed.items[id],
        }])),
      };
      const published = await admin.rpc('studio_publish_version', {
        course_id: courseId,
        manifest: parsed.manifest,
        compiled,
        checklist: {},
        report: { summary: compilation.report.summary },
        actor_id: adminUser.id,
        notes: 'Recovery 07 lesson runtime fixture',
        audit_row: {
          actor_id: adminUser.id,
          action: 'course.publish',
          target_type: 'course',
          target_id: courseId,
          before: null,
          after: { checksum: compilation.compiled.checksum },
        },
      });
      if (published.error) throw new Error(`Could not publish ${courseId}: ${published.error.message}`);
      const value = oneRow(published.data as Record<string, unknown> | Record<string, unknown>[] | null);
      if (typeof value?.id !== 'string') throw new Error(`Publication for ${courseId} did not return a version id.`);
      return value.id;
    };

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    let primaryError: unknown;
    try {
      await setEnglishLocale(context, baseURL);
      const createdLearner = await admin.auth.admin.createUser({
        email: learnerEmail,
        password: learnerPassword,
        email_confirm: true,
        user_metadata: { full_name: learnerName },
        app_metadata: { recovery_fixture: true, recovery_namespace: marker },
      });
      if (createdLearner.error || !createdLearner.data.user) throw new Error('Could not create the disposable lesson learner.');
      learnerId = createdLearner.data.user.id;
      const verified = await admin.auth.admin.getUserById(learnerId);
      if (verified.error || verified.data.user?.email !== learnerEmail
        || verified.data.user.app_metadata?.recovery_fixture !== true
        || verified.data.user.app_metadata?.recovery_namespace !== marker) {
        throw new Error('Disposable lesson learner ownership verification failed.');
      }
      const profile = await admin.from('profiles').update({
        branch_id: 'vinsmc',
        locale: 'en',
        display_name: learnerName,
        handle: `rlesson_${suffix}`.slice(0, 32),
      }).eq('id', learnerId).select('id,branch_id').single();
      if (profile.error || profile.data?.id !== learnerId || profile.data.branch_id !== 'vinsmc') {
        throw new Error('Disposable lesson learner profile setup failed.');
      }
      const inserted = await admin.from('courses').insert({
        id: courseId,
        slug: courseId,
        owner_id: adminUser.id,
        status: 'draft',
      }).select('id,slug,owner_id').single();
      courseCreated = inserted.data?.id === courseId;
      if (inserted.error || inserted.data?.id !== courseId || inserted.data.slug !== courseId
        || inserted.data.owner_id !== adminUser.id) throw new Error(`Could not create ${courseId}.`);
      const versionOneId = await publish(lessonWorkspace(courseId, suffix, 1));
      await page.goto('/login');
      await page.getByLabel('Email').fill(learnerEmail);
      await page.getByLabel('Password').fill(learnerPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/);
      const enroll = await page.request.post(`/api/v1/courses/${courseId}/enroll`);
      expect(enroll.ok(), `Unable to enroll in ${courseId}: HTTP ${enroll.status()}`).toBeTruthy();

      await page.goto(`/app/courses/${courseId}/items/resume-lesson`);
      await expect(page.getByRole('heading', { name: `Resume lesson ${suffix}`, exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Course outline', exact: true }).click();
      const outline = page.getByRole('dialog', { name: 'Course outline', exact: true });
      await expect(outline).toBeVisible();
      await expect(outline.getByRole('link', { name: `Resume lesson ${suffix} Current item`, exact: true })).toHaveAttribute('aria-current', 'page');
      await outline.getByRole('button', { name: 'Close course outline', exact: true }).click();
      await expect(outline).toBeHidden();
      await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '0');

      const reflection = page.getByRole('textbox', { name: 'What will you build next?' });
      await reflection.fill(responseText);
      const persisted = page.waitForResponse((response) => response.url().includes('/api/v1/progress/blocks/resume-reflection') && response.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await persisted).ok()).toBeTruthy();

      await page.reload();
      await expect(page.getByRole('textbox', { name: 'What will you build next?' })).toHaveValue(responseText);
      await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '1');

      await page.goto('/app');
      await page.getByRole('button', { name: learnerName, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(/\/login(?:\?|$)/);
      await page.getByLabel('Email').fill(learnerEmail);
      await page.getByLabel('Password').fill(learnerPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(/\/(?:app|home|welcome)(?:\/|$)/);
      await page.goto(`/app/courses/${courseId}/items/resume-lesson`);
      await expect(page.getByRole('textbox', { name: 'What will you build next?' })).toHaveValue(responseText);

      const versionTwoId = await publish(lessonWorkspace(courseId, suffix, 2));
      expect(versionTwoId).not.toBe(versionOneId);
      const courseResponse = await page.request.get(`/api/v1/courses/${courseId}?locale=en`);
      expect(courseResponse.ok()).toBeTruthy();
      const courseBody = await courseResponse.json() as { data: { versionId: string } };
      expect(courseBody.data.versionId).toBe(versionOneId);

      await page.reload();
      await expect(page.getByRole('heading', { name: `Resume lesson ${suffix}`, exact: true }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: `Replacement lesson ${suffix}`, exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'What will you build next?' })).toHaveValue(responseText);
    } catch (error) {
      primaryError = error;
    } finally {
      await context.close();
      const cleanupErrors: Error[] = [];
      if (learnerId) {
        try {
          const current = await admin.auth.admin.getUserById(learnerId);
          if (current.error || current.data.user?.email !== learnerEmail
            || current.data.user.app_metadata?.recovery_fixture !== true
            || current.data.user.app_metadata?.recovery_namespace !== marker) {
            throw new Error('Lesson learner cleanup ownership verification failed.');
          }
          const removed = await admin.auth.admin.deleteUser(learnerId);
          if (removed.error) throw new Error('Lesson learner cleanup failed.');
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error('Lesson learner cleanup failed.'));
        }
      }
      if (courseCreated) {
        try {
          const current = await admin.from('courses').select('id,slug,owner_id').eq('id', courseId).maybeSingle();
          if (current.error || !current.data || current.data.id !== courseId || current.data.slug !== courseId
            || current.data.owner_id !== adminUser.id) throw new Error('Lesson course cleanup ownership verification failed.');
          const detached = await admin.from('courses').update({ current_version_id: null })
            .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
          if (detached.error || detached.data?.id !== courseId) throw new Error(`Course cleanup precondition failed for ${courseId}.`);
          const removed = await admin.from('courses').delete()
            .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
          if (removed.error || removed.data?.id !== courseId) throw new Error(`Course cleanup failed for ${courseId}.`);
          const publishCleanup = await admin.from('publish_events').delete().eq('course_id', courseId);
          if (publishCleanup.error) throw new Error(`Publication cleanup failed for ${courseId}.`);
          const auditCleanup = await admin.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
          if (auditCleanup.error) throw new Error(`Audit cleanup failed for ${courseId}.`);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error('Lesson course cleanup failed.'));
        }
      }
      if (cleanupErrors.length) {
        if (primaryError) throw new AggregateError([primaryError, ...cleanupErrors], 'Lesson journey and verified cleanup failed.');
        throw new AggregateError(cleanupErrors, 'Disposable lesson cleanup failed.');
      }
    }
    if (primaryError) throw primaryError;
  });
});
