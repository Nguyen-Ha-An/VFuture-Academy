import 'server-only';

import { randomUUID } from 'node:crypto';
import { learnerQuizState } from '@/content-engine/grading/learner-result';
import { normalizeQuizSettings } from '@/content-engine/compile/normalize';
import {
  evaluateCompletion,
  evaluateLessonCompletion,
  LEARNER_FORBIDDEN_KEYS,
  type GradingItem,
  type Locale,
} from '@/content-engine';
import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import { onCourseCompleted as recordCourseCompletionSkills } from '@/features/skills/service';
import {
  handleCourseCompleted,
  handleLessonCompleted,
  type CourseCompletionTransition,
  type LessonCompletionEffect,
} from '@/features/completion/effects';
import {
  branchCanAccess,
  completionRules,
  databaseFailure,
  loadBranchId,
  loadCompletionRows,
  oneRecord,
  outlineItems,
  recordOf,
  recordsOf,
  type LearnerDatabase,
} from '@/features/learning/shared';

const LEARNER_FORBIDDEN_KEY_SET = new Set<string>(LEARNER_FORBIDDEN_KEYS);

type CompletionTransition = CourseCompletionTransition;

type CompletionEffect = CompletionTransition & {
  id: string;
  status: 'pending';
  attempts: number;
};

function completionOf(value: unknown): CompletionTransition | null {
  const row = oneRecord(value);
  if (
    !row
    || typeof row.user_id !== 'string'
    || typeof row.course_id !== 'string'
    || typeof row.course_version_id !== 'string'
    || typeof row.completed_at !== 'string'
  ) return null;
  return {
    user_id: row.user_id,
    course_id: row.course_id,
    course_version_id: row.course_version_id,
    completed_at: row.completed_at,
  };
}

function completionEffectOf(value: unknown): CompletionEffect | null {
  const row = oneRecord(value);
  const completion = completionOf(row);
  if (
    !row
    || !completion
    || typeof row.id !== 'string'
    || row.status !== 'pending'
    || typeof row.attempts !== 'number'
    || !Number.isInteger(row.attempts)
    || row.attempts < 0
  ) return null;
  return { id: row.id, status: 'pending', attempts: row.attempts, ...completion };
}

export type ProgressOptions = {
  onCourseCompleted?: (completion: CompletionTransition) => void | Promise<void>;
  onLessonCompleted?: (completion: LessonCompletionEffect) => void | Promise<void>;
  now?: () => Date;
};

async function runCourseCompletionEffects(completion: CompletionTransition): Promise<void> {
  const results = await Promise.allSettled([
    handleCourseCompleted(completion),
    recordCourseCompletionSkills(completion),
  ]);
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) {
    throw new AggregateError(failures, 'Course completion effects failed');
  }
}

function completionEffectError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown completion hook error';
  return message.slice(0, 1000);
}

async function runNonFatalLearningEffect(
  effect: string,
  run: () => void | Promise<void>,
  context: Record<string, string>,
) {
  try {
    await run();
  } catch (error) {
    const correlationId = randomUUID();
    console.error(`[learning-effect:${correlationId}] Post-commit effect failed`, {
      effect,
      ...context,
      error: completionEffectError(error),
    });
  }
}

async function processCompletionEffects(
  database: LearnerDatabase,
  actor: Actor,
  courseId: string,
  options: ProgressOptions,
  now: Date,
) {
  if (!options.onCourseCompleted) return;
  const lockedUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
  for (let claimedCount = 0; claimedCount < 10; claimedCount += 1) {
    const claimResult = await database.rpc('learner_claim_completion_effect', {
      p_user_id: actor.userId,
      p_course_id: courseId,
      p_locked_until: lockedUntil,
    });
    if (claimResult.error) {
      const correlationId = randomUUID();
      console.error(`[learning-completion-effect:${correlationId}] Pending effect could not be claimed`, {
        courseId,
        error: claimResult.error,
      });
      return;
    }
    const effect = completionEffectOf(claimResult.data);
    if (!effect) return;
    let status: 'pending' | 'done' | 'failed' = 'done';
    let lastError: string | null = null;
    let hookFailed = false;
    try {
      await options.onCourseCompleted({
        user_id: effect.user_id,
        course_id: effect.course_id,
        course_version_id: effect.course_version_id,
        completed_at: effect.completed_at,
      });
    } catch (error) {
      hookFailed = true;
      status = effect.attempts >= 5 ? 'failed' : 'pending';
      lastError = completionEffectError(error);
      console.error(`[learning-completion-effect:${effect.id}] Completion hook failed`, {
        courseId,
        error,
      });
    }

    const updateResult = await database.from('course_completion_effects')
      .update({ status, locked_until: null, last_error: lastError, updated_at: now.toISOString() })
      .eq('id', effect.id)
      .eq('status', 'pending')
      .eq('locked_until', lockedUntil);
    if (updateResult.error) {
      console.error(`[learning-completion-effect:${effect.id}] Completion effect status could not be saved`, {
        courseId,
        error: updateResult.error,
      });
      return;
    }
    if (hookFailed) return;
  }
}

function sanitizedLearnerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizedLearnerValue);
  const object = recordOf(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).flatMap(([key, nested]) => (
    LEARNER_FORBIDDEN_KEY_SET.has(key) ? [] : [[key, sanitizedLearnerValue(nested)]]
  )));
}

async function loadActiveEnrollment(database: LearnerDatabase, actor: Actor, courseId: string) {
  const { data, error } = await database.from('enrollments')
    .select('id,user_id,course_id,course_version_id,status,enrolled_at,completed_at,branch_id,branch_scope_known')
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(error, 'Enrollment could not be loaded');
  const enrollment = recordOf(data);
  if (
    !enrollment
    || typeof enrollment.course_version_id !== 'string'
    || !['active', 'completed'].includes(String(enrollment.status))
  ) return null;
  return enrollment;
}

async function requireActiveEnrollment(database: LearnerDatabase, actor: Actor, courseId: string) {
  const enrollment = await loadActiveEnrollment(database, actor, courseId);
  if (!enrollment) throw new ApiError(403, 'FORBIDDEN', 'An active course enrollment is required');
  return enrollment;
}

async function pinnedOutlineItem(
  database: LearnerDatabase,
  courseId: string,
  versionId: string,
  itemId: string,
) {
  const outlineResult = await database.from('course_version_outline')
    .select('outline,access,default_language')
    .eq('version_id', versionId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(outlineResult.error, 'Pinned course outline could not be loaded');
  const item = outlineItems(recordOf(outlineResult.data)?.outline).find(({ id }) => id === itemId);
  if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Course item was not found');
  const outline = recordOf(outlineResult.data);
  const defaultLocale: Locale = outline?.default_language === 'en' ? 'en' : 'vi';
  return { item, access: outline?.access, defaultLocale };
}

async function itemAccess(database: LearnerDatabase, actor: Actor, courseId: string, itemId: string) {
  const enrollment = await loadActiveEnrollment(database, actor, courseId);
  if (enrollment) {
    await assertEnrollmentMembershipAccess(actor,enrollment,database);
    const versionId = enrollment.course_version_id as string;
    const { item, defaultLocale } = await pinnedOutlineItem(database, courseId, versionId, itemId);
    return { item, versionId, defaultLocale };
  }

  const courseResult = await database.from('courses')
    .select('id,status,current_version_id')
    .eq('id', courseId)
    .maybeSingle();
  databaseFailure(courseResult.error, 'Course could not be loaded');
  const course = recordOf(courseResult.data);
  if (!course || course.status !== 'published' || typeof course.current_version_id !== 'string') {
    throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
  }
  const versionId = course.current_version_id;
  const branchId = await loadBranchId(database, actor.userId);
  const pinned = await pinnedOutlineItem(database, courseId, versionId, itemId);
  if (!branchCanAccess(pinned.access, branchId)) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
  }
  return { item: pinned.item, versionId, defaultLocale: pinned.defaultLocale };
}

function quizFeedbackPolicies(value: unknown, policies = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    for (const entry of value) quizFeedbackPolicies(entry, policies);
  } else {
    const object = recordOf(value);
    if (!object) return policies;
    if (object.type === 'quiz' && typeof object.id === 'string') {
      policies.set(object.id, normalizeQuizSettings(recordOf(object.settings) ?? undefined).feedback);
    }
    for (const nested of Object.values(object)) quizFeedbackPolicies(nested, policies);
  }
  return policies;
}

function quizAnswersVisible(feedback: unknown): boolean {
  return feedback === 'per_question' || feedback === 'after_submit';
}

function blockState(row: Record<string, unknown>): unknown {
  const safeValue = sanitizedLearnerValue(row.state);
  const state = recordOf(safeValue);
  if (!state) return safeValue;
  return {
    ...state,
    completed: row.completed === true,
    ...(typeof row.updated_at === 'string' ? { updatedAt: row.updated_at } : {}),
  };
}

export async function getItemPayload(actor: Actor, courseId: string, itemId: string, locale: Locale) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const { item: outlineItem, versionId, defaultLocale } = await itemAccess(database, actor, courseId, itemId);
  const renderLocales = [...new Set<Locale>([locale, defaultLocale])];
  const renderResult = await database.from('course_version_item_renders')
    .select('locale,payload')
    .eq('version_id', versionId)
    .eq('item_id', itemId)
    .in('locale', renderLocales);
  databaseFailure(renderResult.error, 'Course item could not be loaded');
  const renders = recordsOf(renderResult.data);
  const render = renders.find((row) => row.locale === locale)
    ?? renders.find((row) => row.locale === defaultLocale);
  if (!render || render.payload === undefined) {
    throw new ApiError(404, 'ITEM_NOT_FOUND', 'Course item was not found');
  }
  const stateResult = await database.from('activity_state')
    .select('block_id,state,completed,updated_at')
    .eq('user_id', actor.userId)
    .eq('course_version_id', versionId)
    .eq('item_id', itemId);
  databaseFailure(stateResult.error, 'Activity state could not be loaded');
  const quizPolicies = quizFeedbackPolicies(render.payload);
  const activityState = Object.fromEntries(recordsOf(stateResult.data).flatMap((row) => {
    if (typeof row.block_id !== 'string') return [];
    const state = blockState(row);
    return [[row.block_id, quizPolicies.has(row.block_id)
      ? learnerQuizState(state, quizAnswersVisible(quizPolicies.get(row.block_id)))
      : state]];
  }));

  return {
    courseId,
    courseVersionId: versionId,
    itemId,
    locale: render.locale as Locale,
    item: outlineItem.type === 'exam'
      ? sanitizedLearnerValue({
        id: itemId,
        kind: 'exam',
        title: recordOf(render.payload)?.title,
        description: recordOf(render.payload)?.description,
        settings: recordOf(render.payload)?.settings,
        sections: [],
      })
      : sanitizedLearnerValue(render.payload),
    activityState,
  };
}

export async function markViewed(actor: Actor, courseId: string, itemId: string, now = new Date()) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const enrollment = await requireActiveEnrollment(database, actor, courseId);
  await assertEnrollmentMembershipAccess(actor,enrollment,database);
  const versionId = enrollment.course_version_id as string;
  const { item } = await pinnedOutlineItem(database, courseId, versionId, itemId);
  if (item.type !== 'lesson') {
    throw new ApiError(400, 'INVALID_PROGRESS_TARGET', 'Viewed progress applies only to lessons');
  }
  const viewedResult = await database.rpc('learner_mark_viewed', {
    p_user_id: actor.userId,
    p_course_version_id: versionId,
    p_item_id: itemId,
    p_started_at: now.toISOString(),
  });
  databaseFailure(viewedResult.error, 'Lesson progress could not be saved');
  const stored = oneRecord(viewedResult.data);
  if (!stored || !['in_progress', 'completed'].includes(String(stored.status))) {
    throw new ApiError(500, 'LEARNING_DATABASE_ERROR', 'Lesson progress could not be saved');
  }
  return { itemId, status: stored.status };
}

function quizCompleted(grading: Record<string, unknown>, blockId: string, percent: unknown): boolean {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return false;
  const pass = recordOf(recordOf(grading.quizzes)?.[blockId])?.passPercent;
  return pass === undefined || (typeof pass === 'number' && percent >= pass);
}

function submittedAssignment(row: Record<string, unknown>): boolean {
  return ['submitted', 'in_review', 'approved', 'changes_requested'].includes(String(row.status))
    && typeof row.submitted_at === 'string';
}

export async function putBlockState(
  actor: Actor,
  courseId: string,
  itemId: string,
  blockId: string,
  state: unknown,
  completed: boolean,
  now = new Date(),
) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const enrollment = await requireActiveEnrollment(database, actor, courseId);
  await assertEnrollmentMembershipAccess(actor,enrollment,database);
  const versionId = enrollment.course_version_id as string;
  const { item } = await pinnedOutlineItem(database, courseId, versionId, itemId);
  const itemResult = await database.from('course_version_items')
    .select('item_id,kind,grading')
    .eq('version_id', versionId)
    .eq('item_id', itemId)
    .maybeSingle();
  databaseFailure(itemResult.error, 'Course item activity manifest could not be loaded');
  const grading = recordOf(recordOf(itemResult.data)?.grading);
  const activities = Array.isArray(grading?.activities) ? recordsOf(grading.activities) : [];
  const activity = activities.find(({ id }) => id === blockId);
  const validBlock = Boolean(activity)
    || (item.type === 'assignment' && blockId === itemId);
  if (!validBlock) throw new ApiError(400, 'INVALID_BLOCK_ID', 'Block is not stateful in this course item');
  if (activity?.type === 'quiz') {
    const attempts = await database.from('quiz_attempts')
      .select('percent')
      .eq('user_id', actor.userId)
      .eq('course_version_id', versionId)
      .eq('item_id', itemId)
      .eq('quiz_id', blockId);
    databaseFailure(attempts.error, 'Quiz completion evidence could not be loaded');
    completed = recordsOf(attempts.data).some((row) => quizCompleted(grading!, blockId, row.percent));
  } else if (activity?.type === 'assignment' || item.type === 'assignment') {
    const submissions = await database.from('assignment_submissions')
      .select('block_id,status,submitted_at,grades(decision,released)')
      .eq('user_id', actor.userId)
      .eq('course_version_id', versionId)
      .eq('item_id', itemId);
    databaseFailure(submissions.error, 'Assignment completion evidence could not be loaded');
    completed = recordsOf(submissions.data).some((row) => {
      if (activity?.type === 'assignment') return row.block_id === blockId && submittedAssignment(row);
      const grade = oneRecord(row.grades);
      return row.block_id === null && grade?.released === true && grade.decision === 'approved';
    });
  }
  if (activity?.type === 'quiz') {
    state = learnerQuizState(state, quizAnswersVisible(recordOf(recordOf(grading?.quizzes)?.[blockId])?.feedback));
  }
  const storedResult = await database.from('activity_state')
    .upsert({
      user_id: actor.userId,
      course_version_id: versionId,
      item_id: itemId,
      block_id: blockId,
      state,
      completed,
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id,course_version_id,item_id,block_id' })
    .select('block_id,state,completed,updated_at')
    .single();
  databaseFailure(storedResult.error, 'Activity state could not be saved');
  const stored = recordOf(storedResult.data);
  return {
    blockId,
    state: activity?.type === 'quiz'
      ? learnerQuizState(stored?.state ?? state, quizAnswersVisible(recordOf(recordOf(grading?.quizzes)?.[blockId])?.feedback))
      : stored?.state ?? state,
    completed: activity?.type === 'quiz' || activity?.type === 'assignment' || item.type === 'assignment'
      ? completed
      : stored?.completed === true || (!stored && completed),
    updatedAt: stored?.updated_at ?? null,
  };
}

export async function recompute(actor: Actor, courseId: string, options: ProgressOptions = {}) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const enrollment = await requireActiveEnrollment(database, actor, courseId);
  const versionId = enrollment.course_version_id as string;
  const outlineResult = await database.from('course_version_outline')
    .select('outline,completion')
    .eq('version_id', versionId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(outlineResult.error, 'Course completion rules could not be loaded');
  const outline = recordOf(outlineResult.data);
  if (!outline) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');

  const gradingResult = await database.from('course_version_items')
    .select('item_id,kind,grading')
    .eq('version_id', versionId);
  databaseFailure(gradingResult.error, 'Lesson grading data could not be loaded');
  const gradingRows = recordsOf(gradingResult.data);
  const items = outlineItems(outline.outline);
  const completionRows = await loadCompletionRows(database, actor.userId, versionId, items);
  const activityResult = await database.from('activity_state')
    .select('item_id,block_id,completed')
    .eq('user_id', actor.userId)
    .eq('course_version_id', versionId)
    .eq('completed', true);
  databaseFailure(activityResult.error, 'Completed activities could not be loaded');
  const activities = recordsOf(activityResult.data);
  let submittedAssignments: Record<string, unknown>[] = [];
  if (gradingRows.some((row) => recordsOf(recordOf(row.grading)?.activities).some((activity) => activity.type === 'assignment'))) {
    const submissions = await database.from('assignment_submissions')
      .select('item_id,block_id,status,submitted_at')
      .eq('user_id', actor.userId)
      .eq('course_version_id', versionId);
    databaseFailure(submissions.error, 'Assignment completion evidence could not be loaded');
    submittedAssignments = recordsOf(submissions.data);
  }
  const completedLessons = new Set(completionRows.facts.lessonsCompleted);
  const lessonResults: Record<string, { complete: boolean; pending: string[]; transitioned: boolean }> = {};
  const warnings: Array<{ code: 'MISSING_LESSON_GRADING'; itemId: string; message: string }> = [];
  const now = options.now?.() ?? new Date();

  for (const item of items.filter(({ type }) => type === 'lesson')) {
    const gradingRow = gradingRows.find((row) => row.item_id === item.id && row.kind === 'lesson');
    const grading = recordOf(gradingRow?.grading) as GradingItem | null;
    if (!grading || !Array.isArray(grading.activities)) {
      completedLessons.delete(item.id);
      lessonResults[item.id] = { complete: false, pending: ['grading'], transitioned: false };
      warnings.push({
        code: 'MISSING_LESSON_GRADING',
        itemId: item.id,
        message: 'Lesson grading is unavailable',
      });
      continue;
    }
    const prefix = `${item.id}/`;
    const quizBest = Object.fromEntries(Object.entries(completionRows.facts.quizBest).flatMap(([key, percent]) => (
      key.startsWith(prefix) ? [[key.slice(prefix.length), percent]] : []
    )));
    const evaluated = evaluateLessonCompletion(grading, {
      viewed: ['in_progress', 'completed'].includes(completionRows.lessonProgress[item.id] ?? ''),
      completedActivities: grading.activities.flatMap((activity) => {
        if (activity.type === 'quiz') return quizCompleted(grading as unknown as Record<string, unknown>, activity.id, quizBest[activity.id]) ? [activity.id] : [];
        if (activity.type === 'assignment') return submittedAssignments.some((row) => row.item_id === item.id && row.block_id === activity.id && submittedAssignment(row)) ? [activity.id] : [];
        return activities.some((row) => row.item_id === item.id && row.block_id === activity.id) ? [activity.id] : [];
      }),
      quizBest,
    });
    const transitioned = evaluated.complete && !completedLessons.has(item.id);
    if (!evaluated.complete) completedLessons.delete(item.id);
    if (transitioned) {
      const progressResult = await database.from('lesson_progress')
        .upsert({
          user_id: actor.userId,
          course_version_id: versionId,
          item_id: item.id,
          status: 'completed',
          completed_at: now.toISOString(),
        }, { onConflict: 'user_id,course_version_id,item_id' })
        .select('item_id,status,completed_at')
        .single();
      databaseFailure(progressResult.error, 'Lesson completion could not be saved');
      completedLessons.add(item.id);
      const lessonEffect = options.onLessonCompleted ?? handleLessonCompleted;
      await runNonFatalLearningEffect('xp.lesson_completed', () => lessonEffect({
        userId: actor.userId,
        courseVersionId: versionId,
        itemId: item.id,
      }), { courseId, itemId: item.id });
    }
    lessonResults[item.id] = { ...evaluated, transitioned };
  }

  completionRows.facts.lessonsCompleted = [...completedLessons];
  const evaluatedCourse = evaluateCompletion(completionRules(outline.completion), completionRows.facts);
  const existingResult = await database.from('course_completions')
    .select('user_id,course_id,course_version_id,completed_at')
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(existingResult.error, 'Course completion could not be loaded');
  let completion = completionOf(existingResult.data);
  let transitioned = false;

  if (evaluatedCourse.complete && !completion) {
    const completionValue: CompletionTransition = {
      user_id: actor.userId,
      course_id: courseId,
      course_version_id: versionId,
      completed_at: now.toISOString(),
    };
    const transitionResult = await database.rpc('learner_complete_course', {
      p_user_id: completionValue.user_id,
      p_course_id: completionValue.course_id,
      p_course_version_id: completionValue.course_version_id,
      p_completed_at: completionValue.completed_at,
    });
    databaseFailure(transitionResult.error, 'Course completion could not be saved');
    const transition = oneRecord(transitionResult.data);
    completion = completionOf(transition);
    if (!completion) throw new ApiError(500, 'LEARNING_DATABASE_ERROR', 'Course completion could not be saved');
    transitioned = transition?.transitioned === true;
  }

  await processCompletionEffects(database, actor, courseId, {
    ...options,
    onCourseCompleted: options.onCourseCompleted ?? runCourseCompletionEffects,
  }, now);

  return {
    warnings,
    lessons: lessonResults,
    course: {
      ...evaluatedCourse,
      complete: evaluatedCourse.complete || completion !== null,
      transitioned,
      completedAt: completion?.completed_at ?? null,
    },
  };
}
