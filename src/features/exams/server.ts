import 'server-only';

import type { CompiledItem, GradingItem, LearnerItem } from '@/content-engine/compile';
import type { Locale } from '@/content-engine/schema/common';
import { ApiError } from '@/lib/api';
import { can, hasGlobalPermission, type Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { recompute } from '@/features/progress/service';
import { assertEnrollmentMembershipAccess,type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { onExamPassed } from '@/features/skills/service';
import { award } from '@/features/xp/service';
import { SupabaseBankSource, type BankDatabase } from './bank-source';
import { createExamService } from './service';
import { SupabaseExamRepo, type ExamDatabase } from './supabase-repo';
import { pendingManualQuestionsForAttempt } from './studio';
import type {
  ExamActor,
  ExamAttemptRecord,
  ExamItemContext,
  ExamPermission,
  LoadExamItem,
} from './types';

type ServiceClient = ReturnType<typeof supabaseService>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function locale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'vi';
}

function databaseFailure(operation: string): never {
  throw new ApiError(500, 'EXAM_DATABASE_ERROR', `Unable to ${operation}`);
}

function examItemLoader(database: ServiceClient): LoadExamItem {
  return async (actor, courseId, itemId): Promise<ExamItemContext | null> => {
    const enrollmentResult = await database.from('enrollments')
      .select('course_version_id,branch_id,branch_scope_known')
      .eq('user_id', actor.id)
      .eq('course_id', courseId)
      .in('status', ['active', 'completed'])
      .maybeSingle();
    if (enrollmentResult.error) databaseFailure('load exam enrollment');
    const enrollment = record(enrollmentResult.data);
    if (!enrollment || typeof enrollment.course_version_id !== 'string') return null;
    await assertEnrollmentMembershipAccess({userId:actor.id,roles:[]},enrollment,database as unknown as MembershipAccessDatabase);
    const versionId = enrollment.course_version_id;

    const [itemResult, rendersResult, outlineResult] = await Promise.all([
      database.from('course_version_items')
        .select('item_id,kind,grading,checksum')
        .eq('version_id', versionId)
        .eq('item_id', itemId)
        .maybeSingle(),
      database.from('course_version_item_renders')
        .select('locale,payload')
        .eq('version_id', versionId)
        .eq('item_id', itemId),
      database.from('course_version_outline')
        .select('default_language')
        .eq('version_id', versionId)
        .maybeSingle(),
    ]);
    if (itemResult.error || rendersResult.error || outlineResult.error) databaseFailure('load exam item');
    const item = record(itemResult.data);
    const outline = record(outlineResult.data);
    if (!item || item.kind !== 'exam' || !record(item.grading)) return null;

    const renders = {} as Record<Locale, LearnerItem>;
    if (Array.isArray(rendersResult.data)) {
      for (const value of rendersResult.data) {
        const row = record(value);
        if (!row || (row.locale !== 'vi' && row.locale !== 'en') || !record(row.payload)) continue;
        renders[row.locale] = row.payload as LearnerItem;
      }
    }
    const compiled: CompiledItem = {
      id: itemId,
      kind: 'exam',
      checksum: typeof item.checksum === 'string' ? item.checksum : '',
      grading: item.grading as unknown as GradingItem,
      renders,
    };
    return {
      courseVersionId: versionId,
      item: compiled,
      enrolled: true,
      defaultLocale: locale(outline?.default_language),
      branchId: actor.branchId ?? null,
    };
  };
}

export function createExamEnrollmentChecker(database: Pick<ServiceClient, 'from'>) {
  return async (userId: string, courseVersionId: string): Promise<boolean> => {
    const result = await database.from('enrollments')
      .select('course_version_id,branch_id,branch_scope_known')
      .eq('user_id', userId)
      .eq('course_version_id', courseVersionId)
      .in('status', ['active', 'completed'])
      .maybeSingle();
    if (result.error) databaseFailure('recheck exam enrollment');
    const enrollment = record(result.data);
    if(enrollment?.course_version_id===courseVersionId)await assertEnrollmentMembershipAccess({userId,roles:[]},enrollment,database as unknown as MembershipAccessDatabase);
    return enrollment?.course_version_id === courseVersionId;
  };
}

export function createExamProgressHook(database: Pick<ServiceClient, 'from'>) {
  return async (attempt: ExamAttemptRecord): Promise<void> => {
    const result = await database.from('course_versions')
      .select('course_id')
      .eq('id', attempt.courseVersionId)
      .maybeSingle();
    if (result.error) databaseFailure('resolve exam course');
    const courseId = record(result.data)?.course_id;
    if (typeof courseId !== 'string') databaseFailure('resolve exam course');
    await recompute({ userId: attempt.userId, roles: [] }, courseId);
  };
}

export async function learnerExamActor(userId: string): Promise<ExamActor> {
  const result = await supabaseService().from('profiles')
    .select('locale,branch_id')
    .eq('id', userId)
    .maybeSingle();
  if (result.error) databaseFailure('load learner exam profile');
  const profile = record(result.data);
  return {
    id: userId,
    locale: locale(profile?.locale),
    branchId: typeof profile?.branch_id === 'string' ? profile.branch_id : null,
  };
}

export function studioExamActor(
  actor: Actor,
  branchId: string,
  permission: ExamPermission,
): ExamActor {
  return {
    id: actor.userId,
    locale: 'vi',
    permissions: [permission],
    branchId,
    global: hasGlobalPermission(actor, permission),
  };
}

export function createServerExamService() {
  const database = supabaseService();
  return createExamService({
    repo: new SupabaseExamRepo(database as unknown as ExamDatabase),
    bank: new SupabaseBankSource(database as unknown as BankDatabase),
    clock: { now: () => new Date() },
    loadItem: examItemLoader(database),
    isEnrolled: createExamEnrollmentChecker(database),
    recomputeProgress: createExamProgressHook(database),
    onExamPassed,
    awardXp: (attempt) => award(
      attempt.userId,
      'exam_passed',
      'exam',
      `${attempt.courseVersionId}:${attempt.itemId}`,
    ).then(() => undefined),
  });
}

function attemptSummary(attempt: ExamAttemptRecord, eventCount: number) {
  return {
    attemptId: attempt.id,
    userId: attempt.userId,
    courseVersionId: attempt.courseVersionId,
    itemId: attempt.itemId,
    branchId: attempt.branchId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    late: attempt.late,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    points: attempt.points,
    maxPoints: attempt.maxPoints,
    percent: attempt.percent,
    releasedAt: attempt.releasedAt,
    resultAvailableAt: attempt.resultAvailableAt,
    integrityEventCount: eventCount,
  };
}

/** The attempt DTO returned by the grading-completion route, with ISO timestamps. */
export type ExamAttemptDto = {
  attemptId: string;
  userId: string;
  courseVersionId: string;
  itemId: string;
  branchId: string | null;
  attemptNo: number;
  status: ExamAttemptRecord['status'];
  late: boolean;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  releasedAt: string | null;
  resultAvailableAt: string | null;
};

export function examAttemptDto(attempt: ExamAttemptRecord): ExamAttemptDto {
  return {
    attemptId: attempt.id,
    userId: attempt.userId,
    courseVersionId: attempt.courseVersionId,
    itemId: attempt.itemId,
    branchId: attempt.branchId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    late: attempt.late,
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    points: attempt.points,
    maxPoints: attempt.maxPoints,
    percent: attempt.percent,
    releasedAt: attempt.releasedAt?.toISOString() ?? null,
    resultAvailableAt: attempt.resultAvailableAt?.toISOString() ?? null,
  };
}

/**
 * Completes grading for one attempt, resolving the branch from the attempt itself so
 * the client does not nominate its own scope. The permission check is the same one
 * that guards reading the attempt in `@/features/grading/detail`: `submission.grade`
 * on the attempt's branch, with a global holder additionally covering an attempt
 * whose branch is unknown. The service re-checks the same branch, so a scope that
 * changes between these two reads cannot widen access.
 */
export async function completeExamGrading(actor: Actor, attemptId: string) {
  const attempt = await new SupabaseExamRepo().getAttempt(attemptId);
  if (!attempt) throw new ApiError(404, 'EXAM_ATTEMPT_NOT_FOUND', 'Exam attempt not found');
  const permitted = attempt.branchId === null
    ? hasGlobalPermission(actor, 'submission.grade')
    : can(actor, 'submission.grade', { kind: 'branch', branchId: attempt.branchId });
  if (!permitted) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  const { attempt: completed, transitioned } = await createServerExamService().completeGrading(
    {
      id: actor.userId,
      locale: 'vi',
      permissions: ['submission.grade'],
      branchId: attempt.branchId,
      global: hasGlobalPermission(actor, 'submission.grade'),
    },
    attemptId,
  );
  return { attempt: examAttemptDto(completed), transitioned };
}

export async function listStudioExamAttempts(
  actor: Actor,
  itemId: string,
  branchId: string,
  courseVersionId: string,
) {
  const repo = new SupabaseExamRepo();
  const includeUnassigned = hasGlobalPermission(actor, 'submission.grade')
    || hasGlobalPermission(actor, 'exam.release');
  const attempts = (await repo.listStudioAttempts(itemId, courseVersionId, branchId, includeUnassigned)).slice(0, 50);
  const summaries = await Promise.all(attempts.map(async ({ attempt, eventCount, learnerName }) => ({
    ...attemptSummary(attempt, eventCount),
    learnerName,
    pendingManualQuestions: attempt.status === 'pending_manual'
      ? pendingManualQuestionsForAttempt(attempt, await repo.listAnswers(attempt.id))
      : [],
  })));
  return {
    attempts: summaries,
    skipped: {
      unassigned: includeUnassigned
        ? 0
        : await repo.countUnassignedStudioAttempts(itemId, courseVersionId),
    },
  };
}
