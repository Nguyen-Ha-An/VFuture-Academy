import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { openRolePage, unavailableRoleStorageStateMessage } from './support/auth';
import { assertE2EResetTarget } from './support/reset';

test.describe.configure({ timeout: 180_000 });

function guardedDatabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Administration acceptance requires guarded Supabase credentials.');
  assertE2EResetTarget(url, process.env);
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function requireRoleStates(roles: Parameters<typeof unavailableRoleStorageStateMessage>[0]) {
  const unavailable = unavailableRoleStorageStateMessage(roles);
  if (unavailable) throw new Error(unavailable);
}

async function authUserByEmail(database: SupabaseClient, email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const result = await database.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error('Administration Auth namespace lookup failed.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (result.data.users.length < 100) return null;
  }
  throw new Error('Administration Auth namespace lookup exceeded its bound.');
}

test.describe('@recovery-14 administration', () => {
  test('admin manages a disposable user, branch, and scoped role without invitations', async ({ browser, baseURL }) => {
    requireRoleStates(['admin']);
    const database = guardedDatabase();
    const appURL = baseURL ?? 'http://127.0.0.1:3000';
    const admin = await openRolePage(browser, 'admin', appURL);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const marker = `recovery-14-${suffix}`;
    const branchId = `recovery-14-${suffix}`;
    const email = `recovery-14-${suffix}@example.invalid`;
    const branchName = `Recovery 14 ${suffix}`;
    const branchCity = `Recovery fixture ${suffix}`;
    let userId: string | null = null;
    let userCreated = false;
    let branchCreated = false;
    let primaryError: unknown;
    try {
      const [existingBranch, existingUser] = await Promise.all([
        database.from('branches').select('id').eq('id', branchId).maybeSingle(),
        authUserByEmail(database, email),
      ]);
      if (existingBranch.error || existingBranch.data || existingUser) {
        throw new Error('Disposable administration namespace is not empty.');
      }

      const created = await database.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { recovery_fixture: marker },
        user_metadata: { display_name: branchName },
      });
      if (created.error || !created.data.user) throw new Error('Disposable administration user could not be created.');
      userId = created.data.user.id;
      userCreated = true;
      if (created.data.user.email?.toLowerCase() !== email || created.data.user.app_metadata.recovery_fixture !== marker) {
        throw new Error('Disposable administration user marker was not persisted.');
      }

      await admin.page.goto('/admin/branches');
      // "New school" opens the create/edit Sheet (BranchesManager); the form ids and labels are unchanged.
      await admin.page.getByRole('button', { name: 'New school', exact: true }).click();
      await admin.page.locator('#new-branch-id').fill(branchId);
      await admin.page.locator('#new-branch-name').fill(branchName);
      await admin.page.locator('#new-branch-city').fill(branchCity);
      await admin.page.getByRole('button', { name: 'Create branch', exact: true }).click();
      await expect(admin.page.getByRole('status')).toHaveText('Saved.');
      branchCreated = true;
      const storedBranch = await database.from('branches').select('id,name,city').eq('id', branchId).maybeSingle();
      if (storedBranch.error || storedBranch.data?.id !== branchId
        || storedBranch.data.name !== branchName || storedBranch.data.city !== branchCity) {
        throw new Error('Disposable administration branch marker was not persisted.');
      }

      // Members directory (MembersDirectory) → member profile (MemberProfile) → "Schools & roles".
      await admin.page.goto('/admin/users');
      await admin.page.getByRole('textbox', { name: 'Search', exact: true }).fill(email);
      await admin.page.getByRole('button', { name: 'Search', exact: true }).click();
      const row = admin.page.getByRole('row').filter({ hasText: email });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').first().click();
      await expect(admin.page.getByRole('heading', { level: 1 })).toBeVisible();
      await admin.page.getByRole('tab', { name: 'Schools & roles', exact: true }).click();
      const panel = admin.page.getByRole('tabpanel', { name: 'Schools & roles', exact: true });

      const transfer = panel.getByRole('combobox', { name: 'Transfer school', exact: true });
      await transfer.selectOption(branchId);
      const transferConfirm = admin.page.getByRole('dialog', { name: 'Transfer school' });
      await expect(transferConfirm).toContainText(branchName);
      await transferConfirm.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(transferConfirm).toBeHidden();
      await expect(transfer).toHaveValue(branchId);

      await panel.getByRole('combobox', { name: 'Role', exact: true }).selectOption('teacher');
      await panel.getByRole('combobox', { name: 'School', exact: true }).selectOption(branchId);
      await panel.getByRole('button', { name: 'Confirm', exact: true }).click();
      const roleConfirm = admin.page.getByRole('dialog', { name: /^Role: / });
      await expect(roleConfirm).toContainText(branchName);
      await roleConfirm.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(roleConfirm).toBeHidden();
      await expect(panel.getByRole('button', { name: /^Revoke / })).toBeVisible();
      const [profile, role] = await Promise.all([
        database.from('profiles').select('id,branch_id').eq('id', userId).maybeSingle(),
        database.from('role_assignments').select('user_id,role_definition_id,branch_id').eq('user_id', userId)
          .eq('role_definition_id', 'teacher').eq('branch_id', branchId).maybeSingle(),
      ]);
      if (profile.error || profile.data?.id !== userId || profile.data.branch_id !== branchId
        || role.error || role.data?.user_id !== userId || role.data.role_definition_id !== 'teacher'
        || role.data.branch_id !== branchId) {
        throw new Error('Disposable administration assignment readback failed.');
      }
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors: Error[] = [];
      try {
        if (userCreated && userId) {
          const current = await database.auth.admin.getUserById(userId);
          if (current.error || current.data.user?.email?.toLowerCase() !== email
            || current.data.user.app_metadata.recovery_fixture !== marker) {
            throw new Error('Disposable administration user cleanup marker verification failed.');
          }
          const deleted = await database.auth.admin.deleteUser(userId);
          if (deleted.error) throw new Error('Disposable administration user cleanup failed.');
          const absent = await database.auth.admin.getUserById(userId);
          if (!absent.error && absent.data.user) throw new Error('Disposable administration user cleanup verification failed.');
          const [profile, roles, assignments] = await Promise.all([
            database.from('profiles').select('id').eq('id', userId).maybeSingle(),
            database.from('user_roles').select('id').eq('user_id', userId).limit(1).maybeSingle(),
            database.from('role_assignments').select('id').eq('user_id', userId).limit(1).maybeSingle(),
          ]);
          if (profile.error || profile.data || roles.error || roles.data || assignments.error || assignments.data) {
            throw new Error('Disposable administration user cascade cleanup verification failed.');
          }
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error('Disposable administration user cleanup failed.'));
      }
      try {
        if (branchCreated) {
          const current = await database.from('branches').select('id,name,city').eq('id', branchId).maybeSingle();
          if (current.error || current.data?.id !== branchId
            || current.data.name !== branchName || current.data.city !== branchCity) {
            throw new Error('Disposable administration branch cleanup marker verification failed.');
          }
          const branchCleanup = await database.from('branches').delete()
            .eq('id', branchId).eq('name', branchName).eq('city', branchCity)
            .select('id').maybeSingle();
          if (branchCleanup.error || branchCleanup.data?.id !== branchId) {
            throw new Error('Disposable administration branch cleanup failed.');
          }
          const absent = await database.from('branches').select('id').eq('id', branchId).maybeSingle();
          if (absent.error || absent.data) throw new Error('Disposable administration branch cleanup verification failed.');
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error('Disposable administration branch cleanup failed.'));
      }
      try {
        const evidenceDeletes = [
          ...(userCreated && userId ? [database.from('audit_log').delete().eq('target_type', 'user').eq('target_id', userId)] : []),
          ...(branchCreated ? [database.from('audit_log').delete().eq('target_type', 'branch').eq('target_id', branchId)] : []),
        ];
        const results = await Promise.all(evidenceDeletes);
        if (results.some(({ error }) => error)) throw new Error('Disposable administration audit cleanup failed.');
        const evidenceReads = [
          ...(userCreated && userId ? [database.from('audit_log').select('id').eq('target_type', 'user').eq('target_id', userId).limit(1).maybeSingle()] : []),
          ...(branchCreated ? [database.from('audit_log').select('id').eq('target_type', 'branch').eq('target_id', branchId).limit(1).maybeSingle()] : []),
        ];
        const remaining = await Promise.all(evidenceReads);
        if (remaining.some((result) => result.error || result.data)) {
          throw new Error('Disposable administration audit cleanup verification failed.');
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error('Disposable administration audit cleanup failed.'));
      }
      try {
        await admin.context.close();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error('Administration browser context cleanup failed.'));
      }
      if (cleanupErrors.length) {
        throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, 'Administration journey cleanup failed.');
      }
    }
    if (primaryError) throw primaryError;
  });

  test('branch lead cannot search or mutate outside its current branch scope', async ({ browser, baseURL }) => {
    requireRoleStates(['branchLead']);
    const branchLead = await openRolePage(browser, 'branchLead', baseURL ?? 'http://127.0.0.1:3000');
    try {
      const search = await branchLead.page.request.get('/api/v1/studio/users?query=learner&branchId=recovery-14-outside');
      expect(search.status()).toBe(403);
      const assignment = await branchLead.page.request.put('/api/v1/studio/users/00000000-0000-4000-8000-000000000000/branch', {
        data: { branchId: 'recovery-14-outside' },
      });
      expect(assignment.status()).toBe(403);
    } finally {
      await branchLead.context.close();
    }
  });

  test('admin analytics matches the seeded daily facts and audit details stay permission-gated', async ({ browser, baseURL }) => {
    requireRoleStates(['admin', 'branchLead']);
    const database = guardedDatabase();
    const appURL = baseURL ?? 'http://127.0.0.1:3000';
    const admin = await openRolePage(browser, 'admin', appURL);
    const lead = await openRolePage(browser, 'branchLead', appURL);
    try {
      const response = await admin.page.request.get('/api/v1/studio/analytics/branch/vinsmc');
      expect(response.ok()).toBeTruthy();
      const analytics = (await response.json()).data as {
        period: { from: string; to: string };
        activeLearners: { days7: number; days30: number };
        enrollments: number;
        lessonCompletionRate: number;
        attempts: { quiz: number; exam: number };
        pendingGradingCount: number;
      };
      const daily = await database.from('analytics_branch_daily').select('*')
        .eq('branch_id', 'vinsmc').gte('day', analytics.period.from).lte('day', analytics.period.to).order('day');
      if (daily.error) throw new Error('Seeded analytics facts could not be loaded.');
      const rows = daily.data ?? [];
      const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      const latest = rows.at(-1);
      expect(analytics.activeLearners).toEqual({
        days7: Number(latest?.active_learners_7d ?? 0),
        days30: Number(latest?.active_learners_30d ?? 0),
      });
      expect(analytics.enrollments).toBe(sum('enrollments'));
      expect(analytics.attempts).toEqual({ quiz: sum('quiz_attempts'), exam: sum('exam_attempts') });
      const lessonTotal = sum('lesson_progress_total');
      const expectedRate = lessonTotal === 0 ? 0 : Math.round((10000 * sum('lesson_completions')) / lessonTotal) / 100;
      expect(analytics.lessonCompletionRate).toBe(expectedRate);
      const pending = await database.rpc('analytics_pending_grading', { p_branch_id: 'vinsmc' });
      if (pending.error) throw new Error('Seeded pending workload could not be loaded.');
      expect(analytics.pendingGradingCount).toBe(Number(pending.data ?? 0));

      const auditFact = await database.from('audit_log').select('action').order('at', { ascending: false }).limit(1).maybeSingle();
      if (auditFact.error || !auditFact.data?.action) throw new Error('Seeded audit fact could not be loaded.');
      const auditAction = auditFact.data.action;
      const audit = await admin.page.request.get(`/api/v1/studio/audit?action=${encodeURIComponent(auditAction)}&page=1`);
      expect(audit.ok()).toBeTruthy();
      const auditBody = (await audit.json()).data as { items: Array<{ action: string; snapshots: unknown }> };
      expect(auditBody.items.length).toBeGreaterThan(0);
      expect(auditBody.items.every((entry) => entry.action.includes(auditAction))).toBe(true);
      expect(auditBody.items[0].snapshots).not.toBeNull();
      const denied = await lead.page.request.get('/api/v1/studio/audit?page=1');
      expect(denied.status()).toBe(403);
    } finally {
      await Promise.all([admin.context.close(), lead.context.close()]);
    }
  });
});
