import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { compileCourse, InMemoryResolver, parseWorkspace, type CourseWorkspace } from '@/content-engine';
import { assertE2EResetTarget } from './reset';

const BRANCH_ID = 'vinsmc';
const STANDALONE_ID = 'recovery-assignment';
const INLINE_LESSON_ID = 'recovery-inline';

export type AssignmentFixtureKind = 'standalone' | 'inline';

export type DisposableAssignmentFixture = {
  kind: AssignmentFixtureKind;
  courseId: string;
  courseTitle: string;
  versionId: string;
  branchId: string;
  itemId: string;
  assignmentId: string;
  assignmentTitle: string;
  learner: { id: string; email: string; password: string; displayName: string };
  fileName: string;
  rubricCriterion: string;
  trackUpload(assetId: string): void;
  expectSubmissionCount(count: number): Promise<void>;
  expectCompletion(completed: boolean): Promise<void>;
};

type CreatedState = { course: boolean; learner: boolean; learnerId?: string; assetIds: Set<string> };

const rich = (text: string) => ({ blocks: [{ type: 'paragraph' as const, content: [{ text }] }] });

export function disposableAssignmentWorkspace(
  courseId: string,
  suffix: string,
  kind: AssignmentFixtureKind,
): CourseWorkspace {
  const assignment = {
    id: kind === 'standalone' ? STANDALONE_ID : INLINE_LESSON_ID,
    type: 'assignment' as const,
    title: kind === 'standalone' ? `Recovery assignment ${suffix}` : `Inline assignment ${suffix}`,
    instructions: rich('Submit notes, a permitted link, code, and the recovery text file.'),
    submission: {
      accepts: ['text', 'link', 'code', 'file'] as const,
      maxFiles: 2,
      maxFileSizeMB: 1,
      allowedMimeTypes: ['text/plain'],
      linkHosts: ['example.com'],
      codeLanguage: 'typescript',
    },
    rubric: { criteria: [{ id: 'evidence', name: 'Evidence', maxPoints: 4 }] },
    passPoints: 3,
    resubmission: 'until_approved' as const,
  };
  const { type: _inlineType, ...standaloneAssignment } = assignment;
  const itemId = kind === 'standalone' ? STANDALONE_ID : INLINE_LESSON_ID;
  const item = kind === 'standalone'
    ? { schemaVersion: 1 as const, kind: 'assignment' as const, ...standaloneAssignment }
    : {
      schemaVersion: 1 as const,
      kind: 'lesson' as const,
      id: INLINE_LESSON_ID,
      title: `Inline lesson ${suffix}`,
      objectives: ['Submit the explicitly targeted inline assignment.'],
      estimatedMinutes: 5,
      completion: { mode: 'activities' as const },
      blocks: [
        { type: 'paragraph' as const, content: [{ text: 'The block ID intentionally equals the lesson ID.' }] },
        assignment,
      ],
    };
  return {
    manifest: {
      schemaVersion: 1,
      kind: 'course',
      id: courseId,
      slug: courseId,
      title: `Recovery assignments ${suffix}`,
      summary: 'Disposable browser acceptance for guarded assignment submissions.',
      languages: ['en', 'vi'],
      defaultLanguage: 'en',
      level: 'foundation',
      difficulty: 'beginner',
      pathway: 'core-future-skills',
      learningOutcomes: ['Submit and revise a guarded assignment.'],
      access: { scope: 'global' },
      enrollment: 'open',
      completion: { rules: [{ type: 'assignment_approved', assignmentId: assignment.id }], certificate: false },
      modules: [{ id: 'work', title: 'Work', items: [{ type: kind === 'standalone' ? 'assignment' : 'lesson', id: itemId }] }],
    },
    items: { [itemId]: item },
  } as CourseWorkspace;
}

export async function compileDisposableAssignmentPublication(courseId: string, suffix: string, kind: AssignmentFixtureKind) {
  const source = disposableAssignmentWorkspace(courseId, suffix, kind);
  const compilation = await compileCourse(source, new InMemoryResolver({}), { publish: true, locales: ['en', 'vi'] });
  if (!compilation.ok || !compilation.compiled) throw new Error('Disposable assignment fixture did not compile.');
  const parsed = parseWorkspace(source).parsed;
  if (!parsed) throw new Error('Disposable assignment fixture source did not parse.');
  return {
    manifest: parsed.manifest,
    compiled: {
      ...compilation.compiled,
      items: Object.fromEntries(Object.entries(compilation.compiled.items).map(([itemId, item]) => [itemId, {
        ...item,
        source: parsed.items[itemId],
      }])),
    },
    report: compilation.report,
  };
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw new Error('Assignment fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (result.data.users.length < 1_000) return null;
  }
}

function oneRow<T extends Record<string, unknown>>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function createFixture(kind: AssignmentFixtureKind): Promise<{ fixture: DisposableAssignmentFixture; cleanup(): Promise<void> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const instructorEmail = process.env.SEED_E2E_INSTRUCTOR_EMAIL?.trim();
  if (!supabaseUrl || !serviceRoleKey || !adminEmail || !instructorEmail) {
    throw new Error('Assignment acceptance requires Supabase cleanup credentials and seeded admin/instructor emails.');
  }
  assertE2EResetTarget(supabaseUrl, process.env);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const courseId = `recovery-assignment-${kind}-${suffix}`;
  const learnerEmail = `${courseId}@vfuture.example`;
  const learnerPassword = `${randomUUID()}${randomUUID()}`;
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${learnerPassword}\n`);
  const learnerDisplayName = `Recovery Assignment ${suffix}`;
  const marker = `recovery-assignment:${kind}:${suffix}`;
  const state: CreatedState = { course: false, learner: false, assetIds: new Set() };
  let adminUser: NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

  const cleanup = async () => {
    const failures: Error[] = [];
    if (state.learner && state.learnerId) {
      try {
        const current = await admin.auth.admin.getUserById(state.learnerId);
        const user = current.data.user;
        if (current.error || !user || user.email !== learnerEmail
          || user.app_metadata?.recovery_fixture !== true
          || user.app_metadata?.recovery_namespace !== marker) {
          throw new Error('Assignment learner cleanup ownership verification failed.');
        }
        const ids = [...state.assetIds];
        if (ids.length) {
          const linked = await admin.from('submission_files').delete().eq('user_id', state.learnerId);
          if (linked.error) throw new Error('Assignment file-link cleanup failed.');
          const assets = await admin.from('media_assets').select('id,owner_id,bucket,path').in('id', ids);
          if (assets.error || assets.data?.length !== ids.length) throw new Error('Tracked assignment uploads could not be reverified.');
          const paths = assets.data.map((asset) => {
            if (asset.owner_id !== state.learnerId || asset.bucket !== 'submissions'
              || typeof asset.path !== 'string' || !asset.path.startsWith(`${state.learnerId}/`)
              || !state.assetIds.has(asset.id)) throw new Error('Tracked assignment upload failed its ownership guard.');
            return asset.path;
          });
          const storage = await admin.storage.from('submissions').remove(paths);
          if (storage.error) throw new Error('Tracked assignment storage cleanup failed.');
          const media = await admin.from('media_assets').delete().in('id', ids)
            .eq('owner_id', state.learnerId).eq('bucket', 'submissions').select('id');
          if (media.error || media.data?.length !== ids.length) throw new Error('Tracked assignment media cleanup failed.');
        }
        const removed = await admin.auth.admin.deleteUser(state.learnerId);
        if (removed.error) throw new Error('Assignment learner cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Assignment learner cleanup failed.'));
      }
    }
    if (state.course) {
      try {
        const current = await admin.from('courses').select('id,slug,owner_id').eq('id', courseId).maybeSingle();
        if (current.error || !current.data || current.data.id !== courseId
          || current.data.slug !== courseId || current.data.owner_id !== adminUser.id) {
          throw new Error('Assignment course cleanup ownership verification failed.');
        }
        const detached = await admin.from('courses').update({ current_version_id: null })
          .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (detached.error || detached.data?.id !== courseId) throw new Error('Assignment course cleanup precondition failed.');
        const removed = await admin.from('courses').delete()
          .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (removed.error || removed.data?.id !== courseId) throw new Error('Assignment course cleanup failed.');
        const publishCleanup = await admin.from('publish_events').delete().eq('course_id', courseId);
        if (publishCleanup.error) throw new Error('Assignment publication cleanup failed.');
        const auditCleanup = await admin.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
        if (auditCleanup.error) throw new Error('Assignment course audit cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Assignment course cleanup failed.'));
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Disposable assignment fixture cleanup failed.');
  };

  try {
    const [resolvedAdmin, instructor, branch, existingCourse, existingLearner] = await Promise.all([
      findUserByEmail(admin, adminEmail),
      findUserByEmail(admin, instructorEmail),
      admin.from('branches').select('id').eq('id', BRANCH_ID).maybeSingle(),
      admin.from('courses').select('id').eq('id', courseId).maybeSingle(),
      findUserByEmail(admin, learnerEmail),
    ]);
    if (!resolvedAdmin) throw new Error('Seeded admin fixture does not exist.');
    adminUser = resolvedAdmin;
    if (!instructor) throw new Error('Seeded instructor fixture does not exist.');
    if (branch.error || branch.data?.id !== BRANCH_ID) throw new Error('Required grading branch does not exist.');
    if (existingCourse.error || existingCourse.data || existingLearner) throw new Error('Disposable assignment namespace is not empty.');
    const role = await admin.from('role_assignments').select('user_id').eq('user_id', instructor.id)
      .eq('role_definition_id', 'teacher').eq('branch_id', BRANCH_ID).maybeSingle();
    if (role.error || !role.data) throw new Error('Seeded instructor lacks the required branch role.');

    const createdLearner = await admin.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
      user_metadata: { full_name: learnerDisplayName },
      app_metadata: { recovery_fixture: true, recovery_namespace: marker },
    });
    if (createdLearner.error || !createdLearner.data.user) throw new Error('Disposable assignment learner creation failed.');
    state.learner = true;
    state.learnerId = createdLearner.data.user.id;
    const profile = await admin.from('profiles').update({
      branch_id: BRANCH_ID, locale: 'en', display_name: learnerDisplayName,
      handle: `rasg_${suffix}`.slice(0, 32),
    }).eq('id', state.learnerId).select('id,branch_id').single();
    if (profile.error || profile.data?.id !== state.learnerId || profile.data.branch_id !== BRANCH_ID) {
      throw new Error('Disposable assignment learner profile setup failed.');
    }
    const insertedCourse = await admin.from('courses').insert({
      id: courseId, slug: courseId, owner_id: adminUser.id, status: 'draft',
    }).select('id,slug,owner_id').single();
    if (insertedCourse.error || insertedCourse.data?.id !== courseId || insertedCourse.data.owner_id !== adminUser.id) {
      throw new Error('Disposable assignment course creation failed.');
    }
    state.course = true;
    const publication = await compileDisposableAssignmentPublication(courseId, suffix, kind);
    const published = await admin.rpc('studio_publish_version', {
      course_id: courseId,
      manifest: publication.manifest,
      compiled: publication.compiled,
      checklist: {},
      report: { summary: publication.report.summary },
      actor_id: adminUser.id,
      notes: 'Recovery 09 assignment runtime fixture',
      audit_row: { actor_id: adminUser.id, action: 'course.publish', target_type: 'course', target_id: courseId, before: null, after: { checksum: publication.compiled.checksum } },
    });
    const versionId = oneRow(published.data as Record<string, unknown> | Record<string, unknown>[] | null)?.id;
    if (published.error || typeof versionId !== 'string') throw new Error('Disposable assignment publication failed.');
    const assignmentId = kind === 'standalone' ? STANDALONE_ID : INLINE_LESSON_ID;
    const itemId = kind === 'standalone' ? STANDALONE_ID : INLINE_LESSON_ID;
    const fixture: DisposableAssignmentFixture = {
      kind, courseId, courseTitle: `Recovery assignments ${suffix}`, versionId, branchId: BRANCH_ID,
      itemId, assignmentId,
      assignmentTitle: kind === 'standalone' ? `Recovery assignment ${suffix}` : `Inline assignment ${suffix}`,
      learner: { id: state.learnerId, email: learnerEmail, password: learnerPassword, displayName: learnerDisplayName },
      fileName: `recovery-${kind}-${suffix}.txt`, rubricCriterion: 'Evidence',
      trackUpload(assetId) { state.assetIds.add(assetId); },
      async expectSubmissionCount(count) {
        let query = admin.from('assignment_submissions').select('id', { count: 'exact', head: true })
          .eq('user_id', state.learnerId!).eq('course_version_id', versionId).eq('item_id', itemId);
        query = kind === 'standalone' ? query.is('block_id', null) : query.eq('block_id', assignmentId);
        const result = await query;
        if (result.error || result.count !== count) throw new Error(`Expected ${count} owned assignment submissions.`);
      },
      async expectCompletion(completed) {
        const result = await admin.from('course_completions').select('user_id').eq('user_id', state.learnerId!)
          .eq('course_id', courseId).maybeSingle();
        if (result.error || Boolean(result.data) !== completed) throw new Error(`Expected assignment completion to be ${completed}.`);
      },
    };
    return { fixture, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Disposable assignment fixture setup and cleanup failed.');
    }
    throw error;
  }
}

export async function withDisposableAssignmentFixture(
  kind: AssignmentFixtureKind,
  run: (fixture: DisposableAssignmentFixture) => Promise<void>,
): Promise<void> {
  const created = await createFixture(kind);
  let primaryError: unknown;
  try { await run(created.fixture); } catch (error) { primaryError = error; }
  try { await created.cleanup(); } catch (cleanupError) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Assignment journey and verified cleanup both failed.');
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}
