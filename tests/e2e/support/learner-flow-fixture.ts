import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { compileCourse, InMemoryResolver, parseWorkspace, type CourseWorkspace } from '@/content-engine';
import { assertE2EResetTarget } from './reset';

const BRANCH_ID = 'vinsmc';
const LESSON_ID = 'chain-lesson';
const QUIZ_ID = 'chain-quiz';
const EXAM_ID = 'chain-exam';
const ASSIGNMENT_ID = 'chain-assignment';

const rich = (text: string) => ({ blocks: [{ type: 'paragraph' as const, content: [{ text }] }] });

function markerOf(namespace: string, courseId: string, ownerId: string) {
  return { recovery_fixture: true, recovery_namespace: namespace, recovery_course_id: courseId, recovery_owner_id: ownerId };
}

function markerMatches(value: unknown, namespace: string, courseId: string, ownerId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.recovery_fixture === true && marker.recovery_namespace === namespace
    && marker.recovery_course_id === courseId && marker.recovery_owner_id === ownerId;
}

export type DisposableLearnerFlowFixture = {
  courseId: string;
  versionId: string;
  branchId: string;
  lessonId: string;
  quizAnswer: string;
  examId: string;
  examAnswer: string;
  assignmentId: string;
  learner: { id: string; email: string; password: string; displayName: string };
  feedback: string;
};

export function learnerFlowWorkspace(courseId: string, suffix: string): CourseWorkspace {
  return {
    manifest: {
      schemaVersion: 1,
      kind: 'course',
      id: courseId,
      slug: courseId,
      title: `Learner chain ${suffix}`,
      summary: 'Disposable quiz, exam, assignment, grading, and release chain.',
      languages: ['en'],
      defaultLanguage: 'en',
      level: 'foundation',
      difficulty: 'beginner',
      pathway: 'core-future-skills',
      learningOutcomes: ['Complete one guarded learning chain.'],
      access: { scope: 'global' },
      enrollment: 'open',
      completion: { rules: [{ type: 'assignment_approved', assignmentId: ASSIGNMENT_ID }], certificate: false },
      modules: [{
        id: 'chain',
        title: 'Learning chain',
        items: [
          { type: 'lesson', id: LESSON_ID },
          { type: 'exam', id: EXAM_ID },
          { type: 'assignment', id: ASSIGNMENT_ID },
        ],
      }],
    },
    items: {
      [LESSON_ID]: {
        schemaVersion: 1,
        kind: 'lesson',
        id: LESSON_ID,
        title: `Chain lesson ${suffix}`,
        objectives: ['Pass the quiz.'],
        estimatedMinutes: 2,
        completion: { mode: 'activities' },
        blocks: [{
          id: QUIZ_ID,
          type: 'quiz',
          title: 'Chain knowledge check',
          settings: { mode: 'graded', passPercent: 100, attemptsAllowed: 1, feedback: 'after_submit' },
          questions: [{
            id: 'quiz-choice',
            type: 'single_choice',
            points: 1,
            content: rich('Which choice continues the disposable learner chain?'),
            options: [
              { id: 'continue', content: rich('Continue safely') },
              { id: 'stop', content: rich('Stop early') },
            ],
            correctAnswer: 'continue',
          }],
        }],
      },
      [EXAM_ID]: {
        schemaVersion: 1,
        kind: 'exam',
        id: EXAM_ID,
        title: `Chain exam ${suffix}`,
        settings: {
          timeLimitMinutes: 10,
          attemptsAllowed: 1,
          scoringPolicy: 'latest',
          passPercent: 100,
          review: { showScore: 'on_release', showCorrectAnswers: 'on_release', showExplanations: 'on_release' },
          navigation: 'free',
          layout: 'single_page',
          integrity: { logFocusLoss: false, logPaste: false },
        },
        sections: [{
          id: 'exam-section',
          title: 'Exam check',
          questions: [{
            id: 'exam-choice',
            type: 'single_choice',
            points: 1,
            content: rich('Which answer is protected until release?'),
            options: [
              { id: 'protected', content: rich('Protected answer') },
              { id: 'visible', content: rich('Visible answer') },
            ],
            correctAnswer: 'protected',
            explanation: rich('The answer key appears only after release.'),
          }],
        }],
      },
      [ASSIGNMENT_ID]: {
        schemaVersion: 1,
        kind: 'assignment',
        id: ASSIGNMENT_ID,
        title: `Chain assignment ${suffix}`,
        instructions: rich('Submit the owned evidence link.'),
        submission: { accepts: ['link'], linkHosts: ['example.com'] },
        rubric: { criteria: [{ id: 'evidence', name: 'Evidence', maxPoints: 4 }] },
        passPoints: 3,
        resubmission: 'until_approved',
      },
    },
  } as CourseWorkspace;
}

async function findUser(admin: SupabaseClient, email: string) {
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw new Error('Learner-chain fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found || result.data.users.length < 1_000) return found ?? null;
  }
}

function oneRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return data[0] as Record<string, unknown> | undefined ?? null;
  return typeof data === 'object' && data !== null ? data as Record<string, unknown> : null;
}

async function createFixture(): Promise<{ fixture: DisposableLearnerFlowFixture; cleanup(): Promise<void> }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const instructorEmail = process.env.SEED_E2E_INSTRUCTOR_EMAIL?.trim();
  if (!url || !key || !adminEmail || !instructorEmail) {
    throw new Error('Learner-chain acceptance requires cleanup credentials and seeded admin/instructor emails.');
  }
  assertE2EResetTarget(url, process.env);
  const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const courseId = `main-learner-chain-${suffix}`;
  const learnerEmail = `${courseId}@vfuture.example`;
  const learnerPassword = `${randomUUID()}${randomUUID()}`;
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${learnerPassword}\n`);
  const displayName = `Learner Chain ${suffix}`;
  const marker = `main-learner-chain:${suffix}`;
  let learnerId: string | null = null;
  let courseCreated = false;
  let courseMarkerVerified = false;
  let ownerId: string | null = null;
  let publishedVersionId: string | null = null;

  const cleanup = async () => {
    const failures: unknown[] = [];
    if (courseCreated && !courseMarkerVerified) {
      failures.push(new Error('Learner-chain course was created without a verified cleanup marker.'));
    }
    let courseOwned = false;
    let currentVersionId: string | null = null;
    if (courseCreated && courseMarkerVerified && ownerId) {
      try {
        const [course, draft] = await Promise.all([
          database.from('courses').select('id,slug,owner_id,current_version_id').eq('id', courseId).maybeSingle(),
          database.from('course_drafts').select('course_id,checklist,updated_by').eq('course_id', courseId).maybeSingle(),
        ]);
        if (course.error || course.data?.id !== courseId || course.data.slug !== courseId || course.data.owner_id !== ownerId
          || draft.error || draft.data?.course_id !== courseId || draft.data.updated_by !== ownerId
          || !markerMatches(draft.data.checklist, marker, courseId, ownerId)) {
          throw new Error('Learner-chain course cleanup marker verification failed.');
        }
        currentVersionId = typeof course.data.current_version_id === 'string' ? course.data.current_version_id : null;
        courseOwned = true;
      } catch (error) { failures.push(error); }
    }
    let submissionIds: string[] = [];
    let cleanupLearnerId = learnerId;
    if (!cleanupLearnerId) {
      try {
        const discovered = await findUser(database, learnerEmail);
        if (discovered?.app_metadata?.recovery_fixture === true
          && discovered.app_metadata.recovery_namespace === marker) cleanupLearnerId = discovered.id;
      } catch (error) { failures.push(error); }
    }
    if (cleanupLearnerId) {
      try {
        const current = await database.auth.admin.getUserById(cleanupLearnerId);
        if (current.error || current.data.user?.email !== learnerEmail
          || current.data.user.app_metadata?.recovery_fixture !== true
          || current.data.user.app_metadata?.recovery_namespace !== marker) {
          throw new Error('Learner-chain user cleanup marker verification failed.');
        }
        if (courseMarkerVerified && !courseOwned) {
          throw new Error('Learner-chain course marker must be reconciled before Auth cleanup.');
        }
        if (courseOwned && publishedVersionId) {
          const submissions = await database.from('assignment_submissions').select('id')
            .eq('user_id', cleanupLearnerId).eq('course_version_id', publishedVersionId).eq('item_id', ASSIGNMENT_ID);
          if (submissions.error) throw new Error('Learner-chain submissions could not be inspected for cleanup.');
          submissionIds = (submissions.data ?? []).flatMap((row) => typeof row.id === 'string' ? [row.id] : []);
          const analytics = await database.from('analytics_events').delete()
            .eq('props->>courseId', courseId).eq('user_id', cleanupLearnerId);
          if (analytics.error) throw new Error('Learner-chain analytics cleanup failed before Auth deletion.');
        }
        const removed = await database.auth.admin.deleteUser(cleanupLearnerId);
        if (removed.error) throw new Error('Learner-chain user cleanup failed.');
        if (courseOwned) {
          const lateAnalytics = await database.from('analytics_events').delete()
            .eq('props->>courseId', courseId).is('user_id', null);
          if (lateAnalytics.error) throw new Error('Learner-chain late analytics cleanup failed.');
        }
        if (await findUser(database, learnerEmail)) throw new Error('Learner-chain Auth cleanup readback failed.');
      } catch (error) { failures.push(error); }
    }
    if (courseOwned && ownerId) {
      try {
        if (currentVersionId) {
          const detached = await database.from('courses').update({ current_version_id: null })
            .eq('id', courseId).eq('slug', courseId).eq('owner_id', ownerId)
            .eq('current_version_id', currentVersionId).select('id').maybeSingle();
          if (detached.error || detached.data?.id !== courseId) throw new Error('Learner-chain detach failed.');
        }
        const removed = await database.from('courses').delete()
          .eq('id', courseId).eq('slug', courseId).eq('owner_id', ownerId).select('id').maybeSingle();
        if (removed.error || removed.data?.id !== courseId) throw new Error('Learner-chain course cleanup failed.');
        const publishEvents = await database.from('publish_events').delete().eq('course_id', courseId);
        const courseAudits = await database.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
        if (publishEvents.error || courseAudits.error) throw new Error('Learner-chain publication evidence cleanup failed.');
        if (submissionIds.length) {
          const submissionAudits = await database.from('audit_log').delete()
            .eq('target_type', 'assignment_submission').in('target_id', submissionIds);
          if (submissionAudits.error) throw new Error('Learner-chain grading audit cleanup failed.');
        }
        const [absentCourse, absentAnalytics, absentCourseAudits, absentSubmissionAudits] = await Promise.all([
          database.from('courses').select('id').eq('id', courseId).maybeSingle(),
          database.from('analytics_events').select('id', { count: 'exact', head: true }).eq('props->>courseId', courseId),
          database.from('audit_log').select('id', { count: 'exact', head: true }).eq('target_type', 'course').eq('target_id', courseId),
          submissionIds.length
            ? database.from('audit_log').select('id', { count: 'exact', head: true }).eq('target_type', 'assignment_submission').in('target_id', submissionIds)
            : Promise.resolve({ data: null, error: null, count: 0 }),
        ]);
        if (absentCourse.error || absentCourse.data || absentAnalytics.error || absentAnalytics.count !== 0
          || absentCourseAudits.error || absentCourseAudits.count !== 0
          || absentSubmissionAudits.error || absentSubmissionAudits.count !== 0) {
          throw new Error('Learner-chain cleanup readback failed.');
        }
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Disposable learner-chain cleanup failed.');
  };

  try {
    const [owner, instructor, branch, existingCourse, existingLearner] = await Promise.all([
      findUser(database, adminEmail), findUser(database, instructorEmail),
      database.from('branches').select('id').eq('id', BRANCH_ID).maybeSingle(),
      database.from('courses').select('id').eq('id', courseId).maybeSingle(), findUser(database, learnerEmail),
    ]);
    if (!owner || !instructor) throw new Error('Required seeded admin or instructor does not exist.');
    if (branch.error || branch.data?.id !== BRANCH_ID) throw new Error('Required grading branch does not exist.');
    if (existingCourse.error || existingCourse.data || existingLearner) throw new Error('Learner-chain namespace is not empty.');
    const instructorRole = await database.from('role_assignments').select('user_id').eq('user_id', instructor.id)
      .eq('role_definition_id', 'teacher').eq('branch_id', BRANCH_ID).maybeSingle();
    if (instructorRole.error || !instructorRole.data) throw new Error('Seeded instructor lacks the required branch role.');
    ownerId = owner.id;
    const source = learnerFlowWorkspace(courseId, suffix);
    const compilation = await compileCourse(source, new InMemoryResolver({}), { publish: true, locales: ['en'] });
    const parsed = parseWorkspace(source).parsed;
    if (!compilation.ok || !compilation.compiled || !parsed) throw new Error('Learner-chain fixture did not compile.');

    const createdUser = await database.auth.admin.createUser({
      email: learnerEmail, password: learnerPassword, email_confirm: true,
      user_metadata: { full_name: displayName },
      app_metadata: { recovery_fixture: true, recovery_namespace: marker },
    });
    if (createdUser.error || !createdUser.data.user) throw new Error('Learner-chain user creation failed.');
    learnerId = createdUser.data.user.id;
    const verifiedUser = await database.auth.admin.getUserById(learnerId);
    if (verifiedUser.error || verifiedUser.data.user?.id !== learnerId
      || verifiedUser.data.user.email !== learnerEmail
      || verifiedUser.data.user.app_metadata?.recovery_fixture !== true
      || verifiedUser.data.user.app_metadata?.recovery_namespace !== marker) {
      throw new Error('Learner-chain user creation marker readback failed.');
    }
    const profile = await database.from('profiles').update({
      branch_id: BRANCH_ID, locale: 'en', display_name: displayName, handle: `mchain_${suffix}`.slice(0, 32),
    }).eq('id', learnerId).select('id,branch_id').single();
    if (profile.error || profile.data?.id !== learnerId || profile.data.branch_id !== BRANCH_ID) {
      throw new Error('Learner-chain profile setup failed.');
    }
    const course = await database.from('courses').insert({
      id: courseId, slug: courseId, owner_id: ownerId, status: 'draft',
    }).select('id,slug,owner_id').single();
    if (course.error || course.data?.id !== courseId || course.data.owner_id !== ownerId) {
      throw new Error('Learner-chain course creation failed.');
    }
    courseCreated = true;
    const courseMarker = markerOf(marker, courseId, ownerId);
    const markedDraft = await database.from('course_drafts').insert({
      course_id: courseId,
      manifest: parsed.manifest,
      checklist: courseMarker,
      updated_by: ownerId,
    }).select('course_id,checklist,updated_by').single();
    if (markedDraft.error || markedDraft.data?.course_id !== courseId || markedDraft.data.updated_by !== ownerId
      || !markerMatches(markedDraft.data.checklist, marker, courseId, ownerId)) {
      throw new Error('Learner-chain course marker creation failed.');
    }
    courseMarkerVerified = true;
    const compiled = {
      ...compilation.compiled,
      items: Object.fromEntries(Object.entries(compilation.compiled.items).map(([id, item]) => [id, {
        ...item, source: parsed.items[id],
      }])),
    };
    const published = await database.rpc('studio_publish_version', {
      course_id: courseId, manifest: parsed.manifest, compiled, checklist: {},
      report: { summary: compilation.report.summary }, actor_id: ownerId,
      notes: 'Main unique disposable learner chain',
      audit_row: {
        actor_id: ownerId, action: 'course.publish', target_type: 'course', target_id: courseId,
        before: null, after: { checksum: compilation.compiled.checksum },
      },
    });
    const versionId = oneRow(published.data)?.id;
    if (published.error || typeof versionId !== 'string') throw new Error('Learner-chain publication failed.');
    publishedVersionId = versionId;
    return { fixture: {
      courseId, versionId, branchId: BRANCH_ID, lessonId: LESSON_ID, quizAnswer: 'Continue safely',
      examId: EXAM_ID, examAnswer: 'Protected answer', assignmentId: ASSIGNMENT_ID,
      learner: { id: learnerId, email: learnerEmail, password: learnerPassword, displayName },
      feedback: `Released learner-chain feedback ${suffix}`,
    }, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Learner-chain setup and cleanup failed.');
    }
    throw error;
  }
}

export async function withDisposableLearnerFlowFixture(
  run: (fixture: DisposableLearnerFlowFixture) => Promise<void>,
): Promise<void> {
  const created = await createFixture();
  let primaryError: unknown;
  try { await run(created.fixture); } catch (error) { primaryError = error; }
  try { await created.cleanup(); } catch (cleanupError) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Learner chain and cleanup both failed.');
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}
