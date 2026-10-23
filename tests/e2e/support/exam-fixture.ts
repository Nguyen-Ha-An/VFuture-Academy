import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { compileCourse, InMemoryResolver, parseWorkspace, type CourseWorkspace } from '@/content-engine';
import { assertE2EResetTarget } from './reset';

const BRANCH_ID = 'vinsmc';
const MAIN_EXAM_ID = 'recovery-manual-exam';
const EXPIRY_EXAM_ID = 'recovery-expiry-exam';
const MANUAL_QUESTION_ID = 'assessment/manual-response';

export type DisposableExamFixture = {
  courseId: string;
  courseTitle: string;
  versionId: string;
  branchId: string;
  mainExamId: string;
  mainExamTitle: string;
  expiryExamId: string;
  learner: { id: string; email: string; password: string; displayName: string };
  correctOption: string;
  manualPrompt: string;
  manualAnswer: string;
  manualFeedback: string;
  manualQuestionId: string;
  expectStoredAnswer(attemptId: string, questionId: string, answer: unknown): Promise<void>;
  expectManualGrade(attemptId: string, questionId: string, points: number, feedback: unknown): Promise<void>;
  expireOwnedAttempt(attemptId: string): Promise<void>;
  expectAttemptStatus(attemptId: string, status: string): Promise<void>;
};

type CreatedState = {
  course: boolean;
  learner: boolean;
  learnerId?: string;
};

export function disposableExamWorkspace(courseId: string, suffix: string): CourseWorkspace {
  return {
    manifest: {
      schemaVersion: 1,
      kind: 'course',
      id: courseId,
      slug: courseId,
      title: `Recovery exam ${suffix}`,
      summary: 'Disposable browser acceptance for exam restore, grading, release, and expiration.',
      languages: ['en'],
      defaultLanguage: 'en',
      level: 'foundation',
      difficulty: 'beginner',
      pathway: 'core-future-skills',
      learningOutcomes: ['Recover an exam safely.'],
      access: { scope: 'global' },
      enrollment: 'open',
      completion: { rules: [{ type: 'all_items' }], certificate: false },
      modules: [{
        id: 'assessment',
        title: 'Assessment',
        items: [
          { type: 'exam', id: MAIN_EXAM_ID },
          { type: 'exam', id: EXPIRY_EXAM_ID, required: false },
        ],
      }],
    },
    items: {
      [MAIN_EXAM_ID]: {
        schemaVersion: 1,
        kind: 'exam',
        id: MAIN_EXAM_ID,
        title: `Recovery manual exam ${suffix}`,
        description: { blocks: [{ type: 'paragraph', content: [{ text: 'One automatic and one manual question.' }] }] },
        settings: {
          timeLimitMinutes: 10,
          attemptsAllowed: 1,
          scoringPolicy: 'latest',
          passPercent: 50,
          review: {
            showScore: 'on_release',
            showCorrectAnswers: 'on_release',
            showExplanations: 'on_release',
          },
          navigation: 'free',
          layout: 'single_page',
          integrity: { logFocusLoss: false, logPaste: false },
        },
        sections: [{
          id: 'assessment',
          title: 'Assessment',
          questions: [
            {
              id: 'automatic-choice',
              type: 'single_choice',
              points: 2,
              content: { blocks: [{ type: 'paragraph', content: [{ text: 'Which answer is the verified choice?' }] }] },
              options: [
                { id: 'verified', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Verified recovery answer' }] }] } },
                { id: 'other', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Unverified answer' }] }] } },
              ],
              correctAnswer: 'verified',
              explanation: { blocks: [{ type: 'paragraph', content: [{ text: 'The verified option is correct.' }] }] },
            },
            {
              id: 'manual-response',
              type: 'essay',
              points: 2,
              content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain how a saved draft should recover.' }] }] },
              minWords: 3,
              maxWords: 80,
              rubric: { criteria: [{ id: 'recovery', name: 'Recovery reasoning', maxPoints: 2 }] },
            },
          ],
        }],
      },
      [EXPIRY_EXAM_ID]: {
        schemaVersion: 1,
        kind: 'exam',
        id: EXPIRY_EXAM_ID,
        title: `Recovery expiry exam ${suffix}`,
        settings: {
          timeLimitMinutes: 1,
          attemptsAllowed: 1,
          scoringPolicy: 'latest',
          passPercent: 100,
          availability: { lateSubmission: 'reject' },
          review: { showScore: 'never', showCorrectAnswers: 'never', showExplanations: 'never' },
          navigation: 'free',
          layout: 'single_page',
          integrity: { logFocusLoss: false, logPaste: false },
        },
        sections: [{
          id: 'expiry',
          title: 'Expiry check',
          questions: [{
            id: 'expiry-choice',
            type: 'single_choice',
            points: 1,
            content: { blocks: [{ type: 'paragraph', content: [{ text: 'This attempt will expire.' }] }] },
            options: [
              { id: 'one', content: { blocks: [{ type: 'paragraph', content: [{ text: 'One' }] }] } },
              { id: 'two', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Two' }] }] } },
            ],
            correctAnswer: 'one',
          }],
        }],
      },
    },
  } as CourseWorkspace;
}

export async function compileDisposableExamPublication(courseId: string, suffix: string) {
  const source = disposableExamWorkspace(courseId, suffix);
  const compilation = await compileCourse(source, new InMemoryResolver({}), { publish: true, locales: ['en'] });
  if (!compilation.ok || !compilation.compiled) throw new Error('Disposable exam fixture did not compile.');
  const parsed = parseWorkspace(source).parsed;
  if (!parsed) throw new Error('Disposable exam fixture source did not parse.');
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
  const perPage = 1_000;
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage });
    if (result.error) throw new Error('Disposable exam fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (result.data.users.length < perPage) return null;
  }
}

function oneRow<T extends Record<string, unknown>>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function createFixture(): Promise<{ fixture: DisposableExamFixture; cleanup(): Promise<void> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const instructorEmail = process.env.SEED_E2E_INSTRUCTOR_EMAIL?.trim();
  if (!supabaseUrl || !serviceRoleKey || !adminEmail || !instructorEmail) {
    throw new Error('Exam acceptance requires Supabase cleanup credentials and seeded admin/instructor emails.');
  }
  assertE2EResetTarget(supabaseUrl, process.env);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const courseId = `recovery-exam-${suffix}`;
  const learnerEmail = `${courseId}@vfuture.example`;
  const learnerPassword = `${randomUUID()}${randomUUID()}`;
  const learnerDisplayName = `Recovery Exam ${suffix}`;
  const marker = `recovery-exam:${suffix}`;
  const state: CreatedState = { course: false, learner: false };

  const cleanup = async () => {
    const failures: Error[] = [];
    if (state.learner && state.learnerId) {
      try {
        const current = await admin.auth.admin.getUserById(state.learnerId);
        const user = current.data.user;
        if (current.error || !user || user.email !== learnerEmail
          || user.app_metadata?.recovery_fixture !== true
          || user.app_metadata?.recovery_namespace !== marker) {
          throw new Error('Learner cleanup ownership verification failed.');
        }
        const removed = await admin.auth.admin.deleteUser(state.learnerId);
        if (removed.error) throw new Error('Learner cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Learner cleanup failed.'));
      }
    }
    if (state.course) {
      try {
        const current = await admin.from('courses').select('id,slug,owner_id').eq('id', courseId).maybeSingle();
        if (current.error || !current.data || current.data.id !== courseId
          || current.data.slug !== courseId || current.data.owner_id !== adminUser.id) {
          throw new Error('Course cleanup ownership verification failed.');
        }
        const detached = await admin.from('courses').update({ current_version_id: null })
          .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (detached.error || detached.data?.id !== courseId) throw new Error('Course cleanup precondition failed.');
        const removed = await admin.from('courses').delete()
          .eq('id', courseId).eq('slug', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (removed.error || removed.data?.id !== courseId) throw new Error('Course cleanup failed.');
        const publishCleanup = await admin.from('publish_events').delete().eq('course_id', courseId);
        if (publishCleanup.error) throw new Error('Publication cleanup failed.');
        const auditCleanup = await admin.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
        if (auditCleanup.error) throw new Error('Course audit cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Course cleanup failed.'));
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Disposable exam fixture cleanup failed.');
  };

  let adminUser: NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;
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
    if (existingCourse.error || existingCourse.data) throw new Error('Disposable course namespace is not empty.');
    if (existingLearner) throw new Error('Disposable learner namespace is not empty.');
    const instructorRole = await admin.from('role_assignments').select('user_id,role_definition_id,branch_id')
      .eq('user_id', instructor.id).eq('role_definition_id', 'teacher').eq('branch_id', BRANCH_ID).maybeSingle();
    if (instructorRole.error || !instructorRole.data) throw new Error('Seeded instructor lacks the required branch role.');

    const createdLearner = await admin.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
      user_metadata: { full_name: learnerDisplayName },
      app_metadata: { recovery_fixture: true, recovery_namespace: marker },
    });
    if (createdLearner.error || !createdLearner.data.user) throw new Error('Disposable learner creation failed.');
    state.learner = true;
    state.learnerId = createdLearner.data.user.id;
    const verifiedLearner = await admin.auth.admin.getUserById(state.learnerId);
    if (verifiedLearner.error || verifiedLearner.data.user?.email !== learnerEmail
      || verifiedLearner.data.user.app_metadata?.recovery_namespace !== marker) {
      throw new Error('Disposable learner ownership verification failed.');
    }
    const profile = await admin.from('profiles').update({
      branch_id: BRANCH_ID,
      locale: 'en',
      display_name: learnerDisplayName,
      handle: `rexam_${suffix}`.slice(0, 32),
    }).eq('id', state.learnerId).select('id,branch_id,display_name').single();
    if (profile.error || profile.data?.id !== state.learnerId || profile.data.branch_id !== BRANCH_ID) {
      throw new Error('Disposable learner profile setup failed.');
    }

    const insertedCourse = await admin.from('courses').insert({
      id: courseId,
      slug: courseId,
      owner_id: adminUser.id,
      status: 'draft',
    }).select('id,slug,owner_id').single();
    if (insertedCourse.error || insertedCourse.data?.id !== courseId
      || insertedCourse.data.slug !== courseId || insertedCourse.data.owner_id !== adminUser.id) {
      throw new Error('Disposable course creation failed.');
    }
    state.course = true;
    const publication = await compileDisposableExamPublication(courseId, suffix);
    const published = await admin.rpc('studio_publish_version', {
      course_id: courseId,
      manifest: publication.manifest,
      compiled: publication.compiled,
      checklist: {},
      report: { summary: publication.report.summary },
      actor_id: adminUser.id,
      notes: 'Recovery 08 exam runtime fixture',
      audit_row: {
        actor_id: adminUser.id,
        action: 'course.publish',
        target_type: 'course',
        target_id: courseId,
        before: null,
        after: { checksum: publication.compiled.checksum },
      },
    });
    const publishedRow = oneRow(published.data as Record<string, unknown> | Record<string, unknown>[] | null);
    const versionId = typeof publishedRow?.id === 'string' ? publishedRow.id : null;
    if (published.error || !versionId) throw new Error('Disposable exam publication failed.');

    const fixture: DisposableExamFixture = {
      courseId,
      courseTitle: `Recovery exam ${suffix}`,
      versionId,
      branchId: BRANCH_ID,
      mainExamId: MAIN_EXAM_ID,
      mainExamTitle: `Recovery manual exam ${suffix}`,
      expiryExamId: EXPIRY_EXAM_ID,
      learner: { id: state.learnerId, email: learnerEmail, password: learnerPassword, displayName: learnerDisplayName },
      correctOption: 'Verified recovery answer',
      manualPrompt: 'Explain how a saved draft should recover.',
      manualAnswer: `The local draft ${suffix} returns after a failed save and reload.`,
      manualFeedback: `Verified manual feedback ${suffix}`,
      manualQuestionId: MANUAL_QUESTION_ID,
      async expectStoredAnswer(attemptId, questionId, answer) {
        const result = await admin.from('exam_answers').select('attempt_id,question_id,answer')
          .eq('attempt_id', attemptId).eq('question_id', questionId).maybeSingle();
        if (result.error || result.data?.attempt_id !== attemptId
          || result.data.question_id !== questionId || result.data.answer !== answer) {
          throw new Error('The retried exam answer was not durably stored.');
        }
      },
      async expectManualGrade(attemptId, questionId, points, feedback) {
        const result = await admin.from('exam_answers')
          .select('attempt_id,question_id,manual_points,manual_feedback,graded_by')
          .eq('attempt_id', attemptId).eq('question_id', questionId).maybeSingle();
        if (result.error || result.data?.attempt_id !== attemptId
          || result.data.question_id !== questionId || Number(result.data.manual_points) !== points
          || result.data.manual_feedback !== feedback || typeof result.data.graded_by !== 'string') {
          throw new Error('The manual exam grade was not durably stored.');
        }
      },
      async expireOwnedAttempt(attemptId) {
        const deadline = new Date(Date.now() - 90_000).toISOString();
        const startedAt = new Date(Date.now() - 180_000).toISOString();
        const result = await admin.from('exam_attempts').update({ deadline_at: deadline, started_at: startedAt })
          .eq('id', attemptId)
          .eq('user_id', state.learnerId!)
          .eq('course_version_id', versionId)
          .eq('item_id', EXPIRY_EXAM_ID)
          .eq('status', 'in_progress')
          .select('id,user_id,course_version_id,item_id,status,deadline_at')
          .single();
        if (result.error || result.data?.id !== attemptId || result.data.user_id !== state.learnerId
          || result.data.course_version_id !== versionId || result.data.item_id !== EXPIRY_EXAM_ID
          || Date.parse(result.data.deadline_at) > Date.now() - 30_001) {
          throw new Error('Owned expiration attempt could not be moved beyond the server grace period.');
        }
      },
      async expectAttemptStatus(attemptId, status) {
        const result = await admin.from('exam_attempts').select('id,user_id,course_version_id,item_id,status')
          .eq('id', attemptId).eq('user_id', state.learnerId!).eq('course_version_id', versionId).maybeSingle();
        if (result.error || result.data?.id !== attemptId || result.data.status !== status) {
          throw new Error(`Owned exam attempt did not reach ${status}.`);
        }
      },
    };
    return { fixture, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Disposable exam fixture setup and cleanup failed.');
    }
    throw error;
  }
}

export async function withDisposableExamFixture(
  run: (fixture: DisposableExamFixture) => Promise<void>,
): Promise<void> {
  const created = await createFixture();
  let primaryError: unknown;
  try {
    await run(created.fixture);
  } catch (error) {
    primaryError = error;
  }
  try {
    await created.cleanup();
  } catch (cleanupError) {
    if (primaryError) {
      throw new AggregateError([primaryError, cleanupError], 'Exam journey and verified cleanup both failed.');
    }
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}
