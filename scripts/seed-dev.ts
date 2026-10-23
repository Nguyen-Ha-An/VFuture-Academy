import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import type { QuestionBundle, ResourceDocument } from '@/content-engine/schema/bundle';
import { OpportunityFormSchema, type OpportunityForm } from '@/features/opportunities/schema';
import type { Actor } from '@/lib/permissions';
import type { BankDatabase } from '../src/features/bank/service';
import type { MediaStorageDatabase } from '../src/features/media/storage';
import type { StudioDatabase } from '../src/features/studio/drafts';
import { AI_FOUNDATIONS_BANK_BUNDLE, FIXTURES } from '../src/content-engine/fixtures';
import { inlineWorkspace, parseWorkspace } from '../src/content-engine/validate';
import { createServiceClient } from '../src/lib/supabase/service-client';
import { loadEnvironment } from './load-env';
import {
  recoveryFixtureData,
  recoveryOpportunitySchedulePatch,
  runRecoveryFixtureSeed,
  type RecoveryFixtureServices,
  type RecoverySeedSummary,
} from './lib/recovery-fixtures';
import { repairSeedCompletedLearnerCertificate } from './lib/recovery-certificate-artifacts';

export const DEFAULT_BRANCHES = [
  { id: 'vinsmc', name: 'VinSMC', city: 'Hà Nội' },
  { id: 'ans', name: 'ANS', city: 'Hà Nội' },
  { id: 'dewey', name: 'Dewey Schools', city: 'Hà Nội' },
] as const;

type SeedCourseState = 'missing' | 'draft' | 'published';
type SeedQuestionState = SeedCourseState;
type SeedLinkedContentState = 'missing' | 'matching-draft' | 'published' | 'collision';

export type SeedMediaAsset = {
  id: string;
  filename: string;
  sourcePath: string;
};

export type DevelopmentSeedData = {
  course: {
    id: string;
    createInput: unknown;
    inlineJson: string;
  };
  linkedContent: {
    resources: ResourceDocument[];
    opportunities: OpportunityForm[];
  };
  bankBundle: QuestionBundle;
  media: SeedMediaAsset[];
};

export type DevelopmentSeedAccounts = {
  adminEmail: string;
  learnerEmail: string;
  completedLearnerEmail: string;
  precompletionLearnerEmail: string;
  keyboardLearnerEmail: string;
  a11yLearnerEmail: string;
  instructorEmail: string;
  branchLeadEmail: string;
  otherBranchLearnerEmail: string;
};

export type SeedFixtureProfile = {
  key: Exclude<keyof DevelopmentSeedAccounts, 'adminEmail'>;
  email: string;
  displayName: string;
  handle: string;
  branchId: 'vinsmc' | 'ans';
};

export interface SeedServices {
  upsertBranches(branches: typeof DEFAULT_BRANCHES): Promise<void>;
  findUserId(email: string): Promise<string | null>;
  grantAdminRole(userId: string): Promise<void>;
  ensureAdminProfile(userId: string, handle: string): Promise<boolean>;
  upsertFixtureProfile(userId: string, profile: SeedFixtureProfile): Promise<void>;
  grantFixtureRole(userId: string, role: 'instructor' | 'branch_lead', branchId: 'vinsmc'): Promise<void>;
  ensureActiveEnrollment(userId: string, courseId: string): Promise<void>;
  ensureCompletedEnrollment(userId: string, courseId: string): Promise<void>;
  repairCompletedCertificateArtifact?(userId: string, userEmail: string, courseId: string): Promise<boolean>;
  courseState(courseId: string): Promise<SeedCourseState>;
  createCourse(input: unknown, actor: Actor): Promise<void>;
  importCourse(courseId: string, inlineJson: string, actor: Actor): Promise<void>;
  publishCourse(courseId: string, actor: Actor): Promise<void>;
  resourceState(document: ResourceDocument): Promise<SeedLinkedContentState>;
  saveResource(document: ResourceDocument, actor: Actor): Promise<void>;
  publishResource(document: ResourceDocument, actor: Actor): Promise<void>;
  opportunityState(document: OpportunityForm): Promise<SeedLinkedContentState>;
  saveOpportunity(document: OpportunityForm, actor: Actor): Promise<void>;
  publishOpportunity(document: OpportunityForm, actor: Actor): Promise<void>;
  bankQuestionStates(ids: string[]): Promise<Record<string, SeedQuestionState>>;
  importBankBundle(bundle: QuestionBundle, actor: Actor): Promise<void>;
  publishBankQuestion(id: string, actor: Actor): Promise<void>;
  mediaExists(id: string): Promise<boolean>;
  uploadMedia(asset: SeedMediaAsset, actor: Actor): Promise<void>;
  recovery?: (actor: Actor) => RecoveryFixtureServices;
}

export type SeedSummary = {
  branches: number;
  adminRoleGranted: true;
  adminProfileRepaired: boolean;
  coursePublished: boolean;
  linkedResourcesPublished: number;
  linkedOpportunitiesPublished: number;
  bankImported: number;
  bankPublished: number;
  mediaUploaded: number;
  fixtureProfiles: number;
  fixtureRoles: number;
  activeEnrollments: number;
  completedEnrollments: number;
  certificateArtifactRepaired: boolean;
  recovery: RecoverySeedSummary;
};

const emptyRecoverySummary = (): RecoverySeedSummary => ({
  coursesCreated: 0,
  coursesPublished: 0,
  resourcesCreated: 0,
  resourcesPublished: 0,
  opportunitiesCreated: 0,
  opportunitiesPublished: 0,
  opportunitySchedulesRefreshed: 0,
  projectsCreated: 0,
});

const publishChecklist = {
  outcomesReviewed: true,
  answerKeysVerified: true,
  accessibilityReviewed: true,
  ageAppropriate: true,
  linksValid: true,
  warningsAcknowledged: true,
} as const;

export function developmentSeedData(): DevelopmentSeedData {
  const workspace = FIXTURES['ai-foundations'];
  const parsed = parseWorkspace(workspace);
  if (!parsed.parsed) throw new Error('The AI Foundations seed fixture is invalid.');
  const manifest = parsed.parsed.manifest;

  return {
    course: {
      id: manifest.id,
      createInput: {
        id: manifest.id,
        title: manifest.title,
        languages: manifest.languages,
        defaultLanguage: manifest.defaultLanguage,
        pathway: manifest.pathway,
        level: manifest.level,
      },
      inlineJson: JSON.stringify(inlineWorkspace(parsed.parsed), null, 2),
    },
    linkedContent: {
      resources: [{
        schemaVersion: 1,
        kind: 'resource',
        id: 'prompting-cheat-sheet',
        languages: ['vi', 'en'],
        defaultLanguage: 'vi',
        title: { vi: 'Bảng tóm tắt prompting', en: 'Prompting cheat sheet' },
        summary: {
          vi: 'Mẫu ngắn để viết prompt rõ ràng và có trách nhiệm.',
          en: 'A concise guide to clear, responsible prompts.',
        },
        resourceType: 'cheat_sheet',
        branchScope: { scope: 'global' },
        tags: ['prompting', 'responsible-ai'],
        skills: ['ai-literacy'],
        pathways: ['ai-emerging-technology'],
        body: {
          vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Nêu mục tiêu, bối cảnh và giới hạn.' }] }] },
          en: { blocks: [{ type: 'paragraph', content: [{ text: 'State the goal, context and constraints.' }] }] },
        },
      }],
      opportunities: [{
        id: 'ai-build-sprint-01',
        title: { vi: 'AI Build Sprint', en: 'AI Build Sprint' },
        organization: 'VFuture Labs',
        type: 'hackathon',
        description: {
          vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Xây dựng một sản phẩm AI có trách nhiệm.' }] }] },
          en: { blocks: [{ type: 'paragraph', content: [{ text: 'Build a responsible AI product.' }] }] },
        },
        eligibility: {},
        recommendedSkills: ['ai-literacy'],
        recommendedCourses: ['ai-foundations'],
        requiredCourses: [],
        applicationUrl: null,
        internalApplication: true,
        openAt: null,
        closeAt: null,
        startAt: null,
        endAt: null,
        location: 'Hà Nội',
        online: true,
        branchScope: { scope: 'global' },
        featured: true,
      }],
    },
    bankBundle: AI_FOUNDATIONS_BANK_BUNDLE,
    media: [
      {
        id: 'asset_cover_ai',
        filename: 'asset-cover-ai.png',
        sourcePath: join(process.cwd(), 'public', 'seed-media', 'asset-cover-ai.png.base64'),
      },
      {
        id: 'asset_ai_map',
        filename: 'asset-ai-map.png',
        sourcePath: join(process.cwd(), 'public', 'seed-media', 'asset-ai-map.png.base64'),
      },
    ],
  };
}

/** Seeds and repairs the local development fixture set without duplicating published state. */
export async function runDevelopmentSeed(
  accounts: DevelopmentSeedAccounts,
  services: SeedServices,
  data = developmentSeedData(),
  now = new Date(),
): Promise<SeedSummary> {
  await services.upsertBranches(DEFAULT_BRANCHES);
  const userId = await services.findUserId(accounts.adminEmail);
  if (!userId) {
    throw new Error('Create the SEED_ADMIN_EMAIL account in Supabase Auth before running the development seed.');
  }
  await services.grantAdminRole(userId);
  const adminProfileRepaired = await services.ensureAdminProfile(
    userId,
    fixtureHandle('adminEmail', accounts.adminEmail),
  );
  const actor: Actor = { userId, roles: [{ role: 'admin', branchId: null }] };
  const fixtureProfiles = developmentFixtureProfiles(accounts);
  const resolvedFixtures = [] as Array<SeedFixtureProfile & { userId: string }>;
  for (const fixture of fixtureProfiles) {
    const fixtureUserId = await services.findUserId(fixture.email);
    if (!fixtureUserId) {
      throw new Error(`The ${fixture.key.replace(/Email$/, '')} E2E Auth account does not exist.`);
    }
    resolvedFixtures.push({ ...fixture, userId: fixtureUserId });
  }
  const allUserIds = [userId, ...resolvedFixtures.map(({ userId: fixtureUserId }) => fixtureUserId)];
  if (new Set(allUserIds).size !== allUserIds.length) {
    throw new Error('Seeded E2E fixtures must use distinct Auth accounts.');
  }

  let linkedResourcesPublished = 0;
  for (const document of data.linkedContent.resources) {
    const state = await services.resourceState(document);
    if (state === 'published') continue;
    if (state === 'collision') {
      throw new Error(`Linked seed resource "${document.id}" already exists and does not match the seed fixture; refusing to overwrite it.`);
    }
    if (state === 'missing') await services.saveResource(document, actor);
    await services.publishResource(document, actor);
    linkedResourcesPublished += 1;
  }
  let linkedOpportunitiesPublished = 0;
  for (const document of data.linkedContent.opportunities) {
    const state = await services.opportunityState(document);
    if (state === 'published') continue;
    if (state === 'collision') {
      throw new Error(`Linked seed opportunity "${document.id}" already exists and does not match the seed fixture; refusing to overwrite it.`);
    }
    if (state === 'missing') await services.saveOpportunity(document, actor);
    await services.publishOpportunity(document, actor);
    linkedOpportunitiesPublished += 1;
  }

  let mediaUploaded = 0;
  for (const asset of data.media) {
    if (await services.mediaExists(asset.id)) continue;
    await services.uploadMedia(asset, actor);
    mediaUploaded += 1;
  }

  const questionIds = data.bankBundle.questions.map(({ id }) => id);
  const bankStates = await services.bankQuestionStates(questionIds);
  const missingQuestions = data.bankBundle.questions.filter(({ id }) => (bankStates[id] ?? 'missing') === 'missing');
  if (missingQuestions.length > 0) {
    await services.importBankBundle({ ...data.bankBundle, questions: missingQuestions }, actor);
  }

  let bankPublished = 0;
  for (const questionId of questionIds) {
    if (bankStates[questionId] === 'published') continue;
    await services.publishBankQuestion(questionId, actor);
    bankPublished += 1;
  }

  const courseState = await services.courseState(data.course.id);
  if (courseState === 'missing') await services.createCourse(data.course.createInput, actor);
  const coursePublished = courseState !== 'published';
  if (coursePublished) {
    await services.importCourse(data.course.id, data.course.inlineJson, actor);
    await services.publishCourse(data.course.id, actor);
  }

  for (const fixture of resolvedFixtures) {
    await services.upsertFixtureProfile(fixture.userId, fixture);
  }
  const instructor = resolvedFixtures.find(({ key }) => key === 'instructorEmail');
  const branchLead = resolvedFixtures.find(({ key }) => key === 'branchLeadEmail');
  const precompletion = resolvedFixtures.find(({ key }) => key === 'precompletionLearnerEmail');
  const completed = resolvedFixtures.find(({ key }) => key === 'completedLearnerEmail');
  const learner = resolvedFixtures.find(({ key }) => key === 'learnerEmail');
  if (!instructor || !branchLead || !precompletion || !completed || !learner) {
    throw new Error('The E2E fixture definition is incomplete.');
  }
  await services.grantFixtureRole(instructor.userId, 'instructor', 'vinsmc');
  await services.grantFixtureRole(branchLead.userId, 'branch_lead', 'vinsmc');
  await services.ensureActiveEnrollment(precompletion.userId, data.course.id);
  await services.ensureCompletedEnrollment(completed.userId, data.course.id);
  const certificateArtifactRepaired = await services.repairCompletedCertificateArtifact?.(
    completed.userId,
    completed.email,
    data.course.id,
  ) ?? false;
  const recovery = services.recovery
    ? await runRecoveryFixtureSeed(recoveryFixtureData(now, learner.userId), services.recovery(actor))
    : emptyRecoverySummary();

  return {
    branches: DEFAULT_BRANCHES.length,
    adminRoleGranted: true,
    adminProfileRepaired,
    coursePublished,
    linkedResourcesPublished,
    linkedOpportunitiesPublished,
    bankImported: missingQuestions.length,
    bankPublished,
    mediaUploaded,
    fixtureProfiles: fixtureProfiles.length,
    fixtureRoles: 2,
    activeEnrollments: 1,
    completedEnrollments: 1,
    certificateArtifactRepaired,
    recovery,
  };
}

function fixtureHandle(key: string, email: string): string {
  const label = key.replace(/Email$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const digest = createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex').slice(0, 6);
  return `e2e-${label.slice(0, 20)}-${digest}`;
}

export function developmentFixtureProfiles(accounts: DevelopmentSeedAccounts): SeedFixtureProfile[] {
  const profile = (
    key: SeedFixtureProfile['key'],
    displayName: string,
    branchId: SeedFixtureProfile['branchId'],
  ): SeedFixtureProfile => ({
    key,
    email: accounts[key],
    displayName,
    handle: fixtureHandle(key, accounts[key]),
    branchId,
  });
  return [
    profile('learnerEmail', 'E2E Learner', 'vinsmc'),
    profile('completedLearnerEmail', 'E2E Completed Learner', 'vinsmc'),
    profile('precompletionLearnerEmail', 'E2E Pre-completion Learner', 'vinsmc'),
    profile('keyboardLearnerEmail', 'E2E Keyboard Learner', 'vinsmc'),
    profile('a11yLearnerEmail', 'E2E Accessibility Learner', 'vinsmc'),
    profile('instructorEmail', 'E2E Instructor', 'vinsmc'),
    profile('branchLeadEmail', 'E2E VinSMC Branch Lead', 'vinsmc'),
    profile('otherBranchLearnerEmail', 'E2E ANS Learner', 'ans'),
  ];
}

type ServiceClient = ReturnType<typeof createServiceClient>;

function databaseFailure(message: string, error: unknown): never {
  throw new Error(message, { cause: error });
}

async function productionSeedServices(
  client: ServiceClient,
  environment: { completedLearnerEmail: string; appUrl: string },
): Promise<SeedServices> {
  const [drafts, bank, media, resources, opportunities, projects] = await Promise.all([
    import('../src/features/studio/drafts'),
    import('../src/features/bank/service'),
    import('../src/features/media/storage'),
    import('../src/features/resources/service'),
    import('../src/features/opportunities/service'),
    import('../src/features/projects/service'),
  ]);

  const currentVersionId = async (courseId: string): Promise<string> => {
    const { data, error } = await client.from('courses')
      .select('current_version_id,status')
      .eq('id', courseId)
      .maybeSingle();
    if (error || data?.status !== 'published' || typeof data.current_version_id !== 'string') {
      databaseFailure('Unable to load the published E2E course version.', error);
    }
    return data.current_version_id;
  };

  const resourceServiceFor = (actor: Actor) => resources.createResourceService({
    database: client as never,
    requirePermission: resources.actorResourcePermissionCheck(actor),
  });
  const opportunityServiceFor = (actor: Actor) => opportunities.createOpportunityService({
    database: client as never,
    requirePermission: opportunities.actorOpportunityPermissionCheck(actor),
  });

  const approveSeedReview = async (
    contentType: 'course' | 'bank_question' | 'resource' | 'opportunity',
    contentId: string,
    actor: Actor,
  ) => {
    const candidate = await client.rpc('cms_review_candidate', {
      p_actor_user_id: actor.userId,
      p_content_type: contentType,
      p_content_id: contentId,
      p_expected_revision: null,
    });
    if (candidate.error || !candidate.data || typeof candidate.data.revision_key !== 'string') {
      databaseFailure(`Unable to prepare the ${contentType} seed review.`, candidate.error);
    }
    const requested = await client.rpc('cms_request_review', {
      p_actor_user_id: actor.userId,
      p_content_type: contentType,
      p_content_id: contentId,
      p_expected_revision: candidate.data.revision_key,
      p_notebook_dependencies: null,
    });
    if (requested.error || !requested.data || typeof requested.data.id !== 'string') {
      databaseFailure(`Unable to request the ${contentType} seed review.`, requested.error);
    }
    const decision = await client.rpc('cms_decide_review', {
      p_actor_user_id: actor.userId,
      p_review_id: requested.data.id,
      p_decision: 'approve',
      p_note: 'Explicit development fixture self-review',
    });
    if (decision.error) databaseFailure(`Unable to approve the ${contentType} seed review.`, decision.error);
  };

  const recoveryServices = (actor: Actor): RecoveryFixtureServices => {
    const resourceService = resourceServiceFor(actor);
    const opportunityService = opportunityServiceFor(actor);
    const projectService = projects.createProjectService({
      store: projects.createSupabaseProjectStore(client as never),
      authorize: projects.actorPermissionCheck(actor),
    });
    return {
      async contentState(kind, id) {
        if (kind === 'course') return currentCourseState(id);
        if (kind === 'project') {
          const { data, error } = await client.from('projects').select('id').eq('id', id).maybeSingle();
          if (error) databaseFailure('Unable to inspect the recovery project.', error);
          return data ? 'published' : 'missing';
        }
        const result = kind === 'resource'
          ? await client.from('resources').select('id,status').eq('id', id).maybeSingle()
          : await client.from('opportunities').select('id,status').eq('id', id).maybeSingle();
        if (result.error) databaseFailure(`Unable to inspect the recovery ${kind}.`, result.error);
        if (!result.data) return 'missing';
        return result.data.status === 'published' ? 'published' : 'draft';
      },
      async createCourse(fixture) {
        await drafts.createCourse(fixture.createInput, actor, { client: client as unknown as StudioDatabase });
      },
      async importCourse(fixture) {
        await drafts.importSingle(fixture.document.id, fixture.inlineJson, actor, { client: client as unknown as StudioDatabase });
      },
      async publishCourse(id) {
        await approveSeedReview('course', id, actor);
        await drafts.publish(id, { checklist: publishChecklist, notes: 'Recovery staging fixture' }, actor, {
          client: client as unknown as StudioDatabase,
        });
      },
      async saveResource(document) { await resourceService.saveDraft(document); },
      async publishResource(id) { await approveSeedReview('resource', id, actor); await resourceService.publish(id); },
      async saveOpportunity(document) { await opportunityService.saveDraft(document); },
      async publishOpportunity(id) { await approveSeedReview('opportunity', id, actor); await opportunityService.publish(id); },
      async refreshOpportunitySchedule(id, schedule) {
        const { data, error } = await client.from('opportunities')
          .select('id,status,organization,title,open_at,close_at,start_at,end_at')
          .eq('id', id)
          .maybeSingle();
        if (error) databaseFailure('Unable to inspect the recovery opportunity schedule.', error);
        const patch = recoveryOpportunitySchedulePatch(data, schedule);
        if (!patch) return false;
        const result = await client.from('opportunities').update(patch).eq('id', id);
        if (result.error) databaseFailure('Unable to refresh the recovery opportunity schedule.', result.error);
        return true;
      },
      async createProject(document) { await projectService.createStudio(document); },
    };
  };

  async function currentCourseState(courseId: string): Promise<SeedCourseState> {
    const { data, error } = await client.from('courses')
      .select('id,status,current_version_id')
      .eq('id', courseId)
      .maybeSingle();
    if (error) databaseFailure('Unable to inspect the recovery course.', error);
    if (!data) return 'missing';
    return data.status === 'published' && data.current_version_id ? 'published' : 'draft';
  }

  return {
    async upsertBranches(branches) {
      const { error } = await client.from('branches').upsert([...branches], { onConflict: 'id' });
      if (error) databaseFailure('Unable to seed branches.', error);
    },

    async findUserId(email) {
      const perPage = 1_000;
      for (let page = 1; ; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage });
        if (error) databaseFailure('Unable to look up SEED_ADMIN_EMAIL.', error);
        const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
        if (user) return user.id;
        if (data.users.length < perPage) return null;
      }
    },

    async grantAdminRole(userId) {
      const { error } = await client.from('role_assignments').upsert({
        user_id: userId,
        role_definition_id: 'central_admin',
        branch_id: null,
      }, { onConflict: 'user_id,role_definition_id,branch_id' });
      if (error) databaseFailure('Unable to grant the seed admin role.', error);
    },

    async ensureAdminProfile(userId, handle) {
      return ensureMissingAdminHandle(client as unknown as AdminProfileDatabase, userId, handle);
    },

    async upsertFixtureProfile(userId, profile) {
      const { error } = await client.from('profiles').upsert({
        id: userId,
        display_name: profile.displayName,
        handle: profile.handle,
        locale: 'en',
        branch_id: profile.branchId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) databaseFailure(`Unable to provision the ${profile.key} E2E profile.`, error);
    },

    async grantFixtureRole(userId, role, branchId) {
      if (branchId) {
        const { error: membershipError } = await client.from('branch_memberships').upsert({ user_id: userId, branch_id: branchId, status: 'active' }, { onConflict: 'user_id,branch_id' });
        if (membershipError) databaseFailure('Unable to provision fixture school membership.', membershipError);
      }
      const roleDefinitionId = role === 'instructor' ? 'teacher' : role === 'branch_lead' ? 'school_admin' : role === 'editor' ? 'central_editor' : role === 'admin' ? 'central_admin' : role;
      const { error } = await client.from('role_assignments').upsert({
        user_id: userId,
        role_definition_id: roleDefinitionId,
        branch_id: branchId,
      }, { onConflict: 'user_id,role_definition_id,branch_id' });
      if (error) databaseFailure(`Unable to grant the E2E ${role} role.`, error);
    },

    async ensureActiveEnrollment(userId, courseId) {
      const versionId = await currentVersionId(courseId);
      const { error } = await client.from('enrollments').upsert({
        user_id: userId,
        course_id: courseId,
        course_version_id: versionId,
        status: 'active',
        completed_at: null,
      }, { onConflict: 'user_id,course_id' });
      if (error) databaseFailure('Unable to provision the pre-completion E2E enrollment.', error);
    },

    async ensureCompletedEnrollment(userId, courseId) {
      const versionId = await currentVersionId(courseId);
      const completedAt = new Date().toISOString();
      const enrollmentResult = await client.from('enrollments').upsert({
        user_id: userId,
        course_id: courseId,
        course_version_id: versionId,
        status: 'completed',
        completed_at: completedAt,
      }, { onConflict: 'user_id,course_id' });
      if (enrollmentResult.error) databaseFailure('Unable to provision the completed E2E enrollment.', enrollmentResult.error);

      const completionResult = await client.rpc('learner_complete_course', {
        p_user_id: userId,
        p_course_id: courseId,
        p_course_version_id: versionId,
        p_completed_at: completedAt,
      });
      if (completionResult.error) databaseFailure('Unable to provision the completed E2E course transition.', completionResult.error);
      const transition = {
        user_id: userId,
        course_id: courseId,
        course_version_id: versionId,
        completed_at: completedAt,
      };
      const [completionEffects, skills] = await Promise.all([
        import('../src/features/completion/effects'),
        import('../src/features/skills/service'),
      ]);
      await Promise.all([
        completionEffects.handleCourseCompleted(transition),
        skills.onCourseCompleted(transition, { client: client as never }),
      ]);
      const effectResult = await client.from('course_completion_effects')
        .update({ status: 'done', locked_until: null, last_error: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('course_id', courseId);
      if (effectResult.error) databaseFailure('Unable to finalize the completed E2E course effects.', effectResult.error);
    },

    async repairCompletedCertificateArtifact(userId, userEmail, courseId) {
      if (courseId !== 'ai-foundations' || userEmail.toLowerCase() !== environment.completedLearnerEmail.toLowerCase()) {
        throw new Error('Refusing to repair a certificate outside the exact completed seed fixture.');
      }
      const result = await repairSeedCompletedLearnerCertificate({
        client,
        userId,
        userEmail,
        appUrl: environment.appUrl,
      });
      return result.status === 'repaired' || result.oldArtifactRemoved;
    },

    async courseState(courseId) {
      return currentCourseState(courseId);
    },

    async createCourse(input, actor) {
      await drafts.createCourse(input, actor, { client: client as unknown as StudioDatabase });
    },

    async importCourse(courseId, inlineJson, actor) {
      await drafts.importSingle(courseId, inlineJson, actor, { client: client as unknown as StudioDatabase });
    },

    async publishCourse(courseId, actor) {
      await approveSeedReview('course', courseId, actor);
      await drafts.publish(courseId, {
        checklist: publishChecklist,
        notes: 'Development seed',
      }, actor, { client: client as unknown as StudioDatabase });
    },

    async resourceState(document) {
      const { data, error } = await client.from('resources').select('id,status,document').eq('id', document.id).maybeSingle();
      if (error) databaseFailure('Unable to inspect a linked seed resource.', error);
      if (!data) return 'missing';
      if (!isDeepStrictEqual(data.document, document)) return 'collision';
      if (data.status === 'published') return 'published';
      return data.status === 'draft' ? 'matching-draft' : 'collision';
    },

    async saveResource(document, actor) {
      await resourceServiceFor(actor).saveDraft(document, { createOnly: true });
    },

    async publishResource(document, actor) {
      await approveSeedReview('resource', document.id, actor);
      await resourceServiceFor(actor).publish(document.id, { expectedDraft: document });
    },

    async opportunityState(document) {
      const { data, error } = await client.from('opportunities').select('*').eq('id', document.id).maybeSingle();
      if (error) databaseFailure('Unable to inspect a linked seed opportunity.', error);
      if (!data) return 'missing';
      const parsed = OpportunityFormSchema.safeParse({
        id: data.id,
        title: data.title,
        organization: data.organization,
        type: data.type,
        description: data.description,
        eligibility: data.eligibility,
        recommendedSkills: data.recommended_skills,
        recommendedCourses: data.recommended_courses,
        requiredCourses: data.required_courses,
        applicationUrl: data.application_url,
        internalApplication: data.internal_application,
        openAt: data.open_at,
        closeAt: data.close_at,
        startAt: data.start_at,
        endAt: data.end_at,
        location: data.location,
        online: data.online,
        branchScope: data.branch_scope,
        featured: data.featured,
      });
      if (!parsed.success || !isDeepStrictEqual(parsed.data, document)) return 'collision';
      if (data.status === 'published') return 'published';
      return data.status === 'draft' ? 'matching-draft' : 'collision';
    },

    async saveOpportunity(document, actor) {
      await opportunityServiceFor(actor).saveDraft(document, { createOnly: true });
    },

    async publishOpportunity(document, actor) {
      await approveSeedReview('opportunity', document.id, actor);
      await opportunityServiceFor(actor).publish(document.id, { expectedDraft: document });
    },

    async bankQuestionStates(ids) {
      if (ids.length === 0) return {};
      const { data, error } = await client.from('bank_questions').select('id,status').in('id', ids);
      if (error) databaseFailure('Unable to inspect seed bank questions.', error);
      const states: Record<string, SeedQuestionState> = {};
      for (const row of data ?? []) {
        if (typeof row.id !== 'string') continue;
        states[row.id] = row.status === 'published' ? 'published' : 'draft';
      }
      return states;
    },

    async importBankBundle(bundle, actor) {
      await bank.createBankService({
        database: client as unknown as BankDatabase,
        requirePermission: bank.actorPermissionCheck(actor),
      }).importBundle(bundle);
    },

    async publishBankQuestion(id, actor) {
      await approveSeedReview('bank_question', id, actor);
      await bank.createBankService({
        database: client as unknown as BankDatabase,
        requirePermission: bank.actorPermissionCheck(actor),
      }).publish(id);
    },

    async mediaExists(id) {
      const { data, error } = await client.from('media_assets').select('id').eq('id', id).maybeSingle();
      if (error) databaseFailure('Unable to inspect seed media.', error);
      return data !== null;
    },

    async uploadMedia(asset, actor) {
      const encoded = (await readFile(asset.sourcePath, 'utf8')).trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error(`Seed media is not valid base64: ${asset.sourcePath}`);
      const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
      if (bytes.byteLength === 0) throw new Error(`Seed media is empty: ${asset.sourcePath}`);
      await media.uploadImportedMedia(asset.filename, bytes, actor, {
        database: client as unknown as MediaStorageDatabase,
        createId: () => asset.id,
      });
    },
    recovery: recoveryServices,
  };
}

const seedEmail = z.string().trim().toLowerCase().email();

const seedEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  SEED_ADMIN_EMAIL: seedEmail,
  SEED_E2E_LEARNER_EMAIL: seedEmail,
  SEED_E2E_COMPLETED_LEARNER_EMAIL: seedEmail,
  SEED_E2E_PRECOMPLETION_LEARNER_EMAIL: seedEmail,
  SEED_E2E_KEYBOARD_LEARNER_EMAIL: seedEmail,
  SEED_E2E_A11Y_LEARNER_EMAIL: seedEmail,
  SEED_E2E_INSTRUCTOR_EMAIL: seedEmail,
  SEED_E2E_BRANCH_LEAD_EMAIL: seedEmail,
  SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL: seedEmail,
  SUPABASE_PRODUCTION_PROJECT_REF: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  SEED_DEV_PROJECT_REF: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  SEED_ALLOW_PROD: z.literal('1').optional(),
});

/** Refuses destructive fixture writes outside an explicit development target. */
export function assertDevelopmentSeedTarget(
  supabaseUrl: string,
  source: Record<string, string | undefined> = process.env,
): void {
  const hostname = new URL(supabaseUrl).hostname.toLowerCase();
  const productionRef = source.SUPABASE_PRODUCTION_PROJECT_REF?.trim().toLowerCase();
  if (productionRef && hostname === `${productionRef}.supabase.co`) throw new Error('Refusing to seed the designated production project.');
  if (source.SEED_ALLOW_PROD === '1') return;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return;

  const projectRef = source.SEED_DEV_PROJECT_REF?.trim().toLowerCase();
  if (projectRef && /^[a-z0-9-]+$/.test(projectRef) && hostname === `${projectRef}.supabase.co`) return;
  throw new Error(
    'Refusing to seed a non-development Supabase project. Set SEED_DEV_PROJECT_REF or SEED_ALLOW_PROD=1.',
  );
}

/** Produces a safe operator message without serializing nested errors or URLs. */
export function seedFailureMessage(error: unknown): string {
  const redact = (value: string) => value
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/\b(password|token|secret|api[_-]?key)=\S+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null;
  const message = redact(error instanceof Error ? error.message : 'Unknown seed error');
  const code = typeof record?.code === 'string' ? redact(record.code) : null;
  const cause = typeof record?.cause === 'object' && record.cause !== null
    ? record.cause as Record<string, unknown>
    : null;
  const sqlstate = typeof cause?.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code)
    ? cause.code
    : null;
  const heading = code ? `${message} [${code}]` : sqlstate ? `${message} [SQLSTATE ${sqlstate}]` : message;
  const issues = Array.isArray(record?.issues) ? record.issues.slice(0, 10) : [];
  const lines = issues.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return [];
    const value = issue as Record<string, unknown>;
    const path = Array.isArray(value.path)
      ? redact(value.path.filter((segment) => typeof segment === 'string' || typeof segment === 'number').join('.'))
      : '';
    const issueMessage = typeof value.message === 'string' ? redact(value.message) : 'Invalid value';
    return [`- ${path || '(document)'}: ${issueMessage}`];
  });
  const aggregateLines = error instanceof AggregateError
    ? error.errors.slice(0, 5).map((inner) => {
      const value = typeof inner === 'object' && inner !== null ? inner as Record<string, unknown> : null;
      const innerCode = typeof value?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.code)
        ? `[${value.code}] `
        : '';
      const innerMessage = redact(inner instanceof Error
        ? inner.message
        : typeof value?.message === 'string' ? value.message : 'Unknown completion effect error');
      return `- ${innerCode}${innerMessage}`;
    })
    : [];
  return [heading, ...lines, ...aggregateLines].join('\n');
}

export function missingAdminProfilePatch(
  profile: { handle: string | null; display_name: string; branch_id: string | null; locale: string },
  handle: string,
): { handle: string } | null {
  return profile.handle === null ? { handle } : null;
}

type AdminProfileQueryResult = { data: unknown; error: unknown | null };
interface AdminProfileQuery extends PromiseLike<AdminProfileQueryResult> {
  select(columns: string): this;
  update(value: unknown): this;
  eq(column: string, value: unknown): this;
  is(column: string, value: unknown): this;
  maybeSingle(): Promise<AdminProfileQueryResult>;
}
interface AdminProfileDatabase {
  from(table: string): AdminProfileQuery;
}

/** Fills only a missing admin handle and reports whether this call won the conditional update. */
export async function ensureMissingAdminHandle(
  database: AdminProfileDatabase,
  userId: string,
  handle: string,
): Promise<boolean> {
  const current = await database.from('profiles')
    .select('handle,display_name,branch_id,locale')
    .eq('id', userId)
    .maybeSingle();
  if (current.error || !current.data) databaseFailure('Unable to inspect the seed admin profile.', current.error);
  const profile = current.data as { handle: string | null; display_name: string; branch_id: string | null; locale: string };
  const patch = missingAdminProfilePatch(profile, handle);
  if (!patch) return false;
  const result = await database.from('profiles')
    .update(patch)
    .eq('id', userId)
    .is('handle', null)
    .select('id')
    .maybeSingle();
  if (result.error) databaseFailure('Unable to complete the seed admin profile.', result.error);
  return result.data !== null;
}

export function readSeedEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const result = seedEnvironmentSchema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new Error(`Missing or invalid seed environment variables: ${names}`);
}

async function main() {
  loadEnvironment();
  const environment = readSeedEnvironment();
  assertDevelopmentSeedTarget(environment.NEXT_PUBLIC_SUPABASE_URL, environment);
  const client = createServiceClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
  );
  const summary = await runDevelopmentSeed(
    {
      adminEmail: environment.SEED_ADMIN_EMAIL,
      learnerEmail: environment.SEED_E2E_LEARNER_EMAIL,
      completedLearnerEmail: environment.SEED_E2E_COMPLETED_LEARNER_EMAIL,
      precompletionLearnerEmail: environment.SEED_E2E_PRECOMPLETION_LEARNER_EMAIL,
      keyboardLearnerEmail: environment.SEED_E2E_KEYBOARD_LEARNER_EMAIL,
      a11yLearnerEmail: environment.SEED_E2E_A11Y_LEARNER_EMAIL,
      instructorEmail: environment.SEED_E2E_INSTRUCTOR_EMAIL,
      branchLeadEmail: environment.SEED_E2E_BRANCH_LEAD_EMAIL,
      otherBranchLearnerEmail: environment.SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL,
    },
    await productionSeedServices(client, {
      completedLearnerEmail: environment.SEED_E2E_COMPLETED_LEARNER_EMAIL,
      appUrl: environment.NEXT_PUBLIC_APP_URL,
    }),
  );
  console.log('Development seed complete.', summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('Development seed failed:', seedFailureMessage(error));
    process.exitCode = 1;
  });
}
