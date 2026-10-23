import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { compileCourse } from '../../src/content-engine/compile';
import { InMemoryResolver } from '../../src/content-engine/validate';
import {
  assertDevelopmentSeedTarget,
  DEFAULT_BRANCHES,
  developmentSeedData,
  readSeedEnvironment,
  runDevelopmentSeed,
  seedFailureMessage,
  type SeedServices,
} from '../../scripts/seed-dev';
import { recoveryFixtureData, type RecoveryFixtureServices } from '../../scripts/lib/recovery-fixtures';

const seedAccounts = {
  adminEmail: 'admin@example.com',
  learnerEmail: 'learner@example.com',
  completedLearnerEmail: 'completed@example.com',
  precompletionLearnerEmail: 'precompletion@example.com',
  keyboardLearnerEmail: 'keyboard@example.com',
  a11yLearnerEmail: 'a11y@example.com',
  instructorEmail: 'instructor@example.com',
  branchLeadEmail: 'branch-lead@example.com',
  otherBranchLearnerEmail: 'other-branch@example.com',
} as const;

describe('development seed orchestration', () => {
  it('builds an admin repair patch only when the profile handle is missing', async () => {
    const seedModule = await import('../../scripts/seed-dev');
    const repair = (seedModule as unknown as {
      missingAdminProfilePatch?: (
        profile: { handle: string | null; display_name: string; branch_id: string | null; locale: string },
        handle: string,
      ) => { handle: string } | null;
    }).missingAdminProfilePatch;

    expect(repair?.({
      handle: null,
      display_name: 'Existing Admin Name',
      branch_id: 'ans',
      locale: 'vi',
    }, 'e2e-admin-safe')).toEqual({ handle: 'e2e-admin-safe' });
    expect(repair?.({
      handle: 'existing-admin',
      display_name: 'Existing Admin Name',
      branch_id: 'ans',
      locale: 'vi',
    }, 'e2e-admin-safe')).toBeNull();
  });

  it('reports no admin repair when a concurrent handle update wins the conditional write', async () => {
    const seedModule = await import('../../scripts/seed-dev');
    const ensureMissingAdminHandle = (seedModule as unknown as {
      ensureMissingAdminHandle?: (database: unknown, userId: string, handle: string) => Promise<boolean>;
    }).ensureMissingAdminHandle;
    const calls: Array<[string, ...unknown[]]> = [];
    const results = [
      { data: { handle: null, display_name: 'Admin', branch_id: 'ans', locale: 'vi' }, error: null },
      { data: null, error: null },
    ];
    const database = {
      from(table: string) {
        calls.push(['from', table]);
        const result = results.shift()!;
        const query = {
          select(columns: string) { calls.push(['select', columns]); return query; },
          update(value: unknown) { calls.push(['update', value]); return query; },
          eq(column: string, value: unknown) { calls.push(['eq', column, value]); return query; },
          is(column: string, value: unknown) { calls.push(['is', column, value]); return query; },
          maybeSingle() { return Promise.resolve(result); },
        };
        return query;
      },
    };

    expect(ensureMissingAdminHandle).toBeTypeOf('function');
    if (!ensureMissingAdminHandle) return;
    await expect(ensureMissingAdminHandle(database, 'admin-1', 'e2e-admin-safe')).resolves.toBe(false);
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', 'id', 'admin-1'],
      ['is', 'handle', null],
      ['select', 'id'],
    ]));
  });

  it('reports an admin repair only when the conditional update returns the profile row', async () => {
    const seedModule = await import('../../scripts/seed-dev');
    const ensureMissingAdminHandle = seedModule.ensureMissingAdminHandle;
    const results = [
      { data: { handle: null, display_name: 'Admin', branch_id: null, locale: 'vi' }, error: null },
      { data: { id: 'admin-1' }, error: null },
    ];
    const database = {
      from() {
        const result = results.shift()!;
        const query = {
          select() { return query; },
          update() { return query; },
          eq() { return query; },
          is() { return query; },
          maybeSingle() { return Promise.resolve(result); },
        };
        return query;
      },
    };

    await expect(ensureMissingAdminHandle(database as never, 'admin-1', 'e2e-admin-safe')).resolves.toBe(true);
  });

  it('creates missing dependencies, publishes fixtures, and becomes a no-op on rerun', async () => {
    let courseState: 'missing' | 'draft' | 'published' = 'missing';
    let adminProfileComplete = false;
    const bankStates = new Map<string, 'missing' | 'draft' | 'published'>();
    const mediaIds = new Set<string>();
    const recoveryStates = new Map<string, 'draft' | 'published'>();
    const recovery: RecoveryFixtureServices = {
      contentState: vi.fn(async (_kind, id) => recoveryStates.get(id) ?? 'missing'),
      createCourse: vi.fn(async ({ document }) => { recoveryStates.set(document.id, 'draft'); }),
      importCourse: vi.fn(async () => undefined),
      publishCourse: vi.fn(async (id) => { recoveryStates.set(id, 'published'); }),
      saveResource: vi.fn(async (document) => { recoveryStates.set(document.id, 'draft'); }),
      publishResource: vi.fn(async (id) => { recoveryStates.set(id, 'published'); }),
      saveOpportunity: vi.fn(async (document) => { recoveryStates.set(document.id, 'draft'); }),
      publishOpportunity: vi.fn(async (id) => { recoveryStates.set(id, 'published'); }),
      refreshOpportunitySchedule: vi.fn(async () => false),
      createProject: vi.fn(async (document) => { recoveryStates.set(document.id, 'published'); }),
    };
    const services: SeedServices = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email) => `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => {
        if (adminProfileComplete) return false;
        adminProfileComplete = true;
        return true;
      }),
      upsertFixtureProfile: vi.fn(async () => undefined),
      grantFixtureRole: vi.fn(async () => undefined),
      ensureActiveEnrollment: vi.fn(async () => undefined),
      ensureCompletedEnrollment: vi.fn(async () => undefined),
      repairCompletedCertificateArtifact: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false),
      courseState: vi.fn(async () => courseState),
      createCourse: vi.fn(async () => { courseState = 'draft'; }),
      importCourse: vi.fn(async () => undefined),
      publishCourse: vi.fn(async () => { courseState = 'published'; }),
      resourceState: vi.fn(async (document) => recoveryStates.get(document.id) === 'published' ? 'published' : 'missing'),
      saveResource: vi.fn(async (document) => { recoveryStates.set(document.id, 'draft'); }),
      publishResource: vi.fn(async (document) => { recoveryStates.set(document.id, 'published'); }),
      opportunityState: vi.fn(async (document) => recoveryStates.get(document.id) === 'published' ? 'published' : 'missing'),
      saveOpportunity: vi.fn(async (document) => { recoveryStates.set(document.id, 'draft'); }),
      publishOpportunity: vi.fn(async (document) => { recoveryStates.set(document.id, 'published'); }),
      bankQuestionStates: vi.fn(async (ids: string[]) => Object.fromEntries(
        ids.map((id) => [id, bankStates.get(id) ?? 'missing']),
      )),
      importBankBundle: vi.fn(async (bundle: ReturnType<typeof developmentSeedData>['bankBundle']) => {
        bundle.questions.forEach((question) => bankStates.set(question.id, 'draft'));
      }),
      publishBankQuestion: vi.fn(async (id) => { bankStates.set(id, 'published'); }),
      mediaExists: vi.fn(async (id) => mediaIds.has(id)),
      uploadMedia: vi.fn(async (asset) => { mediaIds.add(asset.id); }),
      recovery: () => recovery,
    };

    const now = new Date('2026-09-05T04:00:00.000Z');
    const first = await runDevelopmentSeed(seedAccounts, services, developmentSeedData(), now);
    const second = await runDevelopmentSeed(seedAccounts, services, developmentSeedData(), now);
    const data = developmentSeedData();
    const recoveryData = recoveryFixtureData(now, 'user-learner@example.com');

    expect(services.upsertBranches).toHaveBeenCalledTimes(2);
    expect(services.upsertBranches).toHaveBeenCalledWith(DEFAULT_BRANCHES);
    expect(services.findUserId).toHaveBeenCalledWith('admin@example.com');
    for (const email of Object.values(seedAccounts).slice(1)) {
      expect(services.findUserId).toHaveBeenCalledWith(email);
    }
    expect(services.grantAdminRole).toHaveBeenCalledTimes(2);
    expect(services.ensureAdminProfile).toHaveBeenCalledTimes(2);
    expect(services.ensureAdminProfile).toHaveBeenCalledWith(
      'user-admin@example.com',
      expect.stringMatching(/^e2e-admin-[a-f0-9]{6}$/),
    );
    expect(services.upsertFixtureProfile).toHaveBeenCalledTimes(16);
    expect(services.grantFixtureRole).toHaveBeenCalledTimes(4);
    expect(services.grantFixtureRole).toHaveBeenCalledWith(
      'user-instructor@example.com',
      'instructor',
      'vinsmc',
    );
    expect(services.grantFixtureRole).toHaveBeenCalledWith(
      'user-branch-lead@example.com',
      'branch_lead',
      'vinsmc',
    );
    expect(services.ensureActiveEnrollment).toHaveBeenCalledTimes(2);
    expect(services.ensureCompletedEnrollment).toHaveBeenCalledTimes(2);
    expect(services.repairCompletedCertificateArtifact).toHaveBeenCalledTimes(2);
    expect(services.repairCompletedCertificateArtifact).toHaveBeenCalledWith(
      'user-completed@example.com',
      'completed@example.com',
      'ai-foundations',
    );
    expect(vi.mocked(services.ensureCompletedEnrollment).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(services.repairCompletedCertificateArtifact!).mock.invocationCallOrder[0]!);
    expect(services.createCourse).toHaveBeenCalledOnce();
    expect(services.importCourse).toHaveBeenCalledOnce();
    expect(services.publishCourse).toHaveBeenCalledOnce();
    expect(services.importBankBundle).toHaveBeenCalledOnce();
    expect(services.publishBankQuestion).toHaveBeenCalledTimes(data.bankBundle.questions.length);
    expect(services.uploadMedia).toHaveBeenCalledTimes(2);
    expect(first).toEqual({
      branches: DEFAULT_BRANCHES.length,
      adminRoleGranted: true,
      adminProfileRepaired: true,
      coursePublished: true,
      linkedResourcesPublished: 1,
      linkedOpportunitiesPublished: 1,
      bankImported: data.bankBundle.questions.length,
      bankPublished: data.bankBundle.questions.length,
      mediaUploaded: 2,
      fixtureProfiles: 8,
      fixtureRoles: 2,
      activeEnrollments: 1,
      completedEnrollments: 1,
      certificateArtifactRepaired: true,
      recovery: {
        coursesCreated: recoveryData.courses.length,
        coursesPublished: recoveryData.courses.length,
        resourcesCreated: recoveryData.resources.length,
        resourcesPublished: recoveryData.resources.length,
        opportunitiesCreated: recoveryData.opportunities.length,
        opportunitiesPublished: recoveryData.opportunities.length,
        opportunitySchedulesRefreshed: 0,
        projectsCreated: recoveryData.projects.length,
      },
    });
    expect(second).toEqual({
      branches: DEFAULT_BRANCHES.length,
      adminRoleGranted: true,
      adminProfileRepaired: false,
      coursePublished: false,
      linkedResourcesPublished: 0,
      linkedOpportunitiesPublished: 0,
      bankImported: 0,
      bankPublished: 0,
      mediaUploaded: 0,
      fixtureProfiles: 8,
      fixtureRoles: 2,
      activeEnrollments: 1,
      completedEnrollments: 1,
      certificateArtifactRepaired: false,
      recovery: {
        coursesCreated: 0,
        coursesPublished: 0,
        resourcesCreated: 0,
        resourcesPublished: 0,
        opportunitiesCreated: 0,
        opportunitiesPublished: 0,
        opportunitySchedulesRefreshed: 0,
        projectsCreated: 0,
      },
    });
    expect(recovery.createProject).toHaveBeenCalledWith(expect.objectContaining({
      members: [{ userId: 'user-learner@example.com', role: 'owner' }],
    }));

    const uploadOrder = vi.mocked(services.uploadMedia).mock.invocationCallOrder.at(-1)!;
    const bankPublishOrder = vi.mocked(services.publishBankQuestion).mock.invocationCallOrder.at(-1)!;
    const coursePublishOrder = vi.mocked(services.publishCourse).mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(coursePublishOrder);
    expect(bankPublishOrder).toBeLessThan(coursePublishOrder);
  });

  it('publishes ai-foundations only after its linked content is available to validation', async () => {
    const data = developmentSeedData();
    const publishedResources = new Set<string>();
    const publishedOpportunities = new Set<string>();
    let importedCourse: unknown;
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email: string) => `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => false),
      upsertFixtureProfile: vi.fn(async () => undefined),
      grantFixtureRole: vi.fn(async () => undefined),
      ensureActiveEnrollment: vi.fn(async () => undefined),
      ensureCompletedEnrollment: vi.fn(async () => undefined),
      courseState: vi.fn(async () => 'draft' as const),
      createCourse: vi.fn(async () => undefined),
      importCourse: vi.fn(async (_courseId: string, inlineJson: string) => {
        importedCourse = JSON.parse(inlineJson) as unknown;
      }),
      publishCourse: vi.fn(async () => {
        const result = await compileCourse(
          { manifest: importedCourse, items: {} },
          new InMemoryResolver({
            bank: data.bankBundle.questions.map((question) => ({
              id: question.id,
              versionId: `published-${question.id}`,
              type: question.type,
              tags: question.tags,
              difficulty: question.difficulty,
              question,
            })),
            assets: data.media.map(({ id }) => id),
            resources: [...publishedResources],
            opportunities: [...publishedOpportunities],
            branches: DEFAULT_BRANCHES.map(({ id }) => id),
          }),
          { publish: true },
        );
        if (!result.ok) {
          throw new Error(result.report.errors.map(({ code, path }) => `${code}:${path}`).join(', '));
        }
      }),
      bankQuestionStates: vi.fn(async () => ({})),
      importBankBundle: vi.fn(async () => undefined),
      publishBankQuestion: vi.fn(async () => undefined),
      mediaExists: vi.fn(async () => false),
      uploadMedia: vi.fn(async () => undefined),
      resourceState: vi.fn(async (document: { id: string }) => publishedResources.has(document.id) ? 'published' as const : 'missing' as const),
      saveResource: vi.fn(async () => undefined),
      publishResource: vi.fn(async (document: { id: string }) => { publishedResources.add(document.id); }),
      opportunityState: vi.fn(async (document: { id: string }) => publishedOpportunities.has(document.id) ? 'published' as const : 'missing' as const),
      saveOpportunity: vi.fn(async () => undefined),
      publishOpportunity: vi.fn(async (document: { id: string }) => { publishedOpportunities.add(document.id); }),
    } as unknown as SeedServices;

    await expect(runDevelopmentSeed(seedAccounts, services, data)).resolves.toMatchObject({
      coursePublished: true,
    });
    expect(services.publishResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prompting-cheat-sheet' }),
      expect.anything(),
    );
    expect(services.publishOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ai-build-sprint-01' }),
      expect.anything(),
    );
    expect(vi.mocked(services.publishResource).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(services.publishCourse).mock.invocationCallOrder[0]);
    expect(vi.mocked(services.publishOpportunity).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(services.publishCourse).mock.invocationCallOrder[0]);
  });

  it('refuses to overwrite a colliding linked-content draft', async () => {
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email: string) => `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => false),
      resourceState: vi.fn(async () => 'collision' as const),
      saveResource: vi.fn(async () => undefined),
      publishResource: vi.fn(async () => undefined),
    } as unknown as SeedServices;

    await expect(runDevelopmentSeed(seedAccounts, services)).rejects.toThrow(
      'Linked seed resource "prompting-cheat-sheet" already exists and does not match',
    );
    expect(services.saveResource).not.toHaveBeenCalled();
    expect(services.publishResource).not.toHaveBeenCalled();
  });

  it('resumes publication of a matching linked-content draft without rewriting it', async () => {
    const data = developmentSeedData();
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email: string) => `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => false),
      upsertFixtureProfile: vi.fn(async () => undefined),
      resourceState: vi.fn(async () => 'matching-draft' as const),
      saveResource: vi.fn(async () => undefined),
      publishResource: vi.fn(async () => undefined),
      opportunityState: vi.fn(async () => 'published' as const),
      courseState: vi.fn(async () => 'published' as const),
      bankQuestionStates: vi.fn(async () => Object.fromEntries(
        data.bankBundle.questions.map(({ id }) => [id, 'published']),
      )),
      mediaExists: vi.fn(async () => true),
      recovery: undefined,
      grantFixtureRole: vi.fn(async () => undefined),
      ensureActiveEnrollment: vi.fn(async () => undefined),
      ensureCompletedEnrollment: vi.fn(async () => undefined),
    } as unknown as SeedServices;

    await runDevelopmentSeed(seedAccounts, services, data);

    expect(services.saveResource).not.toHaveBeenCalled();
    expect(services.publishResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prompting-cheat-sheet' }),
      expect.anything(),
    );
  });

  it('repairs draft bank/course state without re-importing existing questions', async () => {
    const data = developmentSeedData();
    const states = Object.fromEntries(data.bankBundle.questions.map(({ id }) => [id, 'draft' as const]));
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email) => `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => false),
      upsertFixtureProfile: vi.fn(async () => undefined),
      grantFixtureRole: vi.fn(async () => undefined),
      ensureActiveEnrollment: vi.fn(async () => undefined),
      ensureCompletedEnrollment: vi.fn(async () => undefined),
      courseState: vi.fn(async () => 'draft' as const),
      createCourse: vi.fn(async () => undefined),
      importCourse: vi.fn(async () => undefined),
      publishCourse: vi.fn(async () => undefined),
      resourceState: vi.fn(async () => 'published' as const),
      saveResource: vi.fn(async () => undefined),
      publishResource: vi.fn(async () => undefined),
      opportunityState: vi.fn(async () => 'published' as const),
      saveOpportunity: vi.fn(async () => undefined),
      publishOpportunity: vi.fn(async () => undefined),
      bankQuestionStates: vi.fn(async () => states),
      importBankBundle: vi.fn(async () => undefined),
      publishBankQuestion: vi.fn(async () => undefined),
      mediaExists: vi.fn(async () => true),
      uploadMedia: vi.fn(async () => undefined),
    } satisfies SeedServices;

    const result = await runDevelopmentSeed(seedAccounts, services);

    expect(services.createCourse).not.toHaveBeenCalled();
    expect(services.importBankBundle).not.toHaveBeenCalled();
    expect(services.publishBankQuestion).toHaveBeenCalledTimes(data.bankBundle.questions.length);
    expect(services.importCourse).toHaveBeenCalledOnce();
    expect(services.publishCourse).toHaveBeenCalledOnce();
    expect(result.bankImported).toBe(0);
  });

  it('fails clearly when the operator has not created the seed admin account', async () => {
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async () => null),
    } as unknown as SeedServices;

    await expect(runDevelopmentSeed({ ...seedAccounts, adminEmail: 'missing@example.com' }, services))
      .rejects.toThrow('Create the SEED_ADMIN_EMAIL account');
  });

  it('fails clearly when any configured E2E Auth account is missing', async () => {
    const services = {
      upsertBranches: vi.fn(async () => undefined),
      findUserId: vi.fn(async (email: string) => email === seedAccounts.keyboardLearnerEmail ? null : `user-${email}`),
      grantAdminRole: vi.fn(async () => undefined),
      ensureAdminProfile: vi.fn(async () => false),
      courseState: vi.fn(async () => 'published' as const),
      bankQuestionStates: vi.fn(async () => ({})),
      mediaExists: vi.fn(async () => true),
    } as unknown as SeedServices;

    await expect(runDevelopmentSeed(seedAccounts, services))
      .rejects.toThrow('The keyboardLearner E2E Auth account does not exist');
  });

  it('reads every fixture email but excludes Playwright-only passwords', () => {
    const source = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
      SEED_ADMIN_EMAIL: seedAccounts.adminEmail,
      SEED_E2E_LEARNER_EMAIL: seedAccounts.learnerEmail,
      SEED_E2E_COMPLETED_LEARNER_EMAIL: seedAccounts.completedLearnerEmail,
      SEED_E2E_PRECOMPLETION_LEARNER_EMAIL: seedAccounts.precompletionLearnerEmail,
      SEED_E2E_KEYBOARD_LEARNER_EMAIL: seedAccounts.keyboardLearnerEmail,
      SEED_E2E_A11Y_LEARNER_EMAIL: seedAccounts.a11yLearnerEmail,
      SEED_E2E_INSTRUCTOR_EMAIL: seedAccounts.instructorEmail,
      SEED_E2E_BRANCH_LEAD_EMAIL: seedAccounts.branchLeadEmail,
      SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL: ' Other-Branch@Example.com ',
      SEED_COMPLETED_LEARNER_PASSWORD: 'must-not-be-read',
    } as unknown as NodeJS.ProcessEnv;

    const environment = readSeedEnvironment(source);

    expect(environment.SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL).toBe(seedAccounts.otherBranchLearnerEmail);
    expect(environment).not.toHaveProperty('SEED_COMPLETED_LEARNER_PASSWORD');
  });

  it('permits local and explicitly allowlisted development Supabase targets', () => {
    expect(() => assertDevelopmentSeedTarget('http://localhost:54321', {})).not.toThrow();
    expect(() => assertDevelopmentSeedTarget('http://127.0.0.1:54321', {})).not.toThrow();
    expect(() => assertDevelopmentSeedTarget('https://devproject.supabase.co', {
      SEED_DEV_PROJECT_REF: 'devproject',
    })).not.toThrow();
  });

  it('refuses the promoted production project even with stale development settings', () => {
    expect(() => assertDevelopmentSeedTarget('https://rpggoukinvxuxuxjodkt.supabase.co', {
      SEED_DEV_PROJECT_REF: 'rpggoukinvxuxuxjodkt', SUPABASE_PRODUCTION_PROJECT_REF: 'rpggoukinvxuxuxjodkt', SEED_ALLOW_PROD: '1',
    })).toThrow('production');
  });

  it('refuses unknown hosted targets unless the operator explicitly overrides the guard', () => {
    expect(() => assertDevelopmentSeedTarget('https://production.supabase.co', {
      SEED_DEV_PROJECT_REF: 'devproject',
    })).toThrow('Refusing to seed a non-development Supabase project');
    expect(() => assertDevelopmentSeedTarget('https://production.supabase.co', {
      SEED_DEV_PROJECT_REF: 'devproject',
      SEED_ALLOW_PROD: '1',
    })).not.toThrow();
  });

  it('formats seed failures without exposing cause URLs or error objects', () => {
    const failure = new Error('Unable to seed branches.', {
      cause: new Error('connect ECONNREFUSED https://secret-project.supabase.co/rest/v1'),
    });

    expect(seedFailureMessage(failure)).toBe('Unable to seed branches.');
    expect(seedFailureMessage(failure)).not.toContain('secret-project');
  });

  it('reports a nested PostgreSQL SQLSTATE without exposing its raw cause', () => {
    const failure = new Error('Unable to provision the completed E2E course transition.', {
      cause: {
        code: '42702',
        message: 'column reference is ambiguous at https://private-project.example',
        details: 'secret-bearing database detail',
      },
    });

    expect(seedFailureMessage(failure)).toBe(
      'Unable to provision the completed E2E course transition. [SQLSTATE 42702]',
    );
    expect(seedFailureMessage(failure)).not.toContain('private-project');
    expect(seedFailureMessage(failure)).not.toContain('secret-bearing');
  });

  it('reports bounded AggregateError codes and messages without raw metadata', () => {
    const certificateFailure = Object.assign(
      new Error('Certificate renderer failed at https://private.example/module'),
      { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED', headers: { authorization: 'Bearer private-token' } },
    );
    const xpFailure = Object.assign(
      new Error('XP write failed token=private-token'),
      { code: 'XP_DATABASE_ERROR' },
    );
    const failure = new AggregateError([certificateFailure, xpFailure], 'Course completion effects failed');

    expect(seedFailureMessage(failure)).toBe([
      'Course completion effects failed',
      '- [ERR_PACKAGE_PATH_NOT_EXPORTED] Certificate renderer failed at [redacted-url]',
      '- [XP_DATABASE_ERROR] XP write failed token=[redacted]',
    ].join('\n'));
    expect(seedFailureMessage(failure)).not.toContain('authorization');
    expect(seedFailureMessage(failure)).not.toContain('private-token');
  });

  it('includes bounded validation issues in the local seed failure message', () => {
    const failure = Object.assign(new Error('Course has validation errors'), {
      code: 'COURSE_INVALID',
      issues: [
        { path: ['manifest', 'relatedOpportunities', 0], message: 'Opportunity "ai-build-sprint-01" not found' },
        { path: ['what-is-ai', 'blocks', 9, 'resourceId'], message: 'Resource "prompting-cheat-sheet" not found' },
        { path: ['manifest', 'https://private.example/secret\ncover'], message: 'See https://private.example/asset' },
      ],
    });

    expect(seedFailureMessage(failure)).toBe([
      'Course has validation errors [COURSE_INVALID]',
      '- manifest.relatedOpportunities.0: Opportunity "ai-build-sprint-01" not found',
      '- what-is-ai.blocks.9.resourceId: Resource "prompting-cheat-sheet" not found',
      '- manifest.[redacted-url] cover: See [redacted-url]',
    ].join('\n'));
  });
});
