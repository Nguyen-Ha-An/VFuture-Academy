import 'server-only';

import { z } from 'zod';
import { IdSchema, LocaleSchema, resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import { databaseFailure, oneRecord, outlineItems, recordOf, recordsOf, type LearnerDatabase } from '@/features/learning/shared';
import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';
import type { CourseResult, CourseTask, CourseworkIdentity, LearningAnnouncement, LearningCalendar, LearningCalendarEvent } from './contracts';

export const CourseworkQuerySchema = z.object({ courseId: IdSchema.optional(), locale: LocaleSchema.default('vi') }).strict();
export const CalendarQuerySchema = CourseworkQuerySchema.extend({
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
}).refine(({ start, end }) => Date.parse(end) > Date.parse(start) && Date.parse(end) - Date.parse(start) <= 366 * 86400000,
  { message: 'Calendar range must be positive and at most 366 days', path: ['end'] });
type Query = { courseId?: string; locale?: Locale };
type CalendarQuery = Query & { start: string; end: string };
type Row = Record<string, unknown>;
type Context = { enrollment: Row; outline: Row; courseId: string; versionId: string; branchId: string | null; locale: Locale };
type Target = CourseworkIdentity & { kind: 'assignment' | 'exam'; grading: Row };

function text(value: unknown, locale: Locale, fallback: Locale): string {
  if (typeof value === 'string') return value;
  const map = recordOf(value);
  return map ? resolveL10nString(map as L10nString, locale, fallback) : '';
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function key(itemId: unknown, blockId: unknown): string { return JSON.stringify([itemId, blockId ?? null]); }
function targetKey(target: CourseworkIdentity): string { return key(target.itemId, target.blockId); }
function href(courseId: string, itemId: string, blockId: string | null): string {
  return `${routes.learner.courseItem(courseId, itemId)}${blockId ? `#${encodeURIComponent(blockId)}` : ''}`;
}

export function createCourseworkReadService(database: LearnerDatabase, now: () => Date = () => new Date()) {
  async function contexts(actor: Actor, query: Query): Promise<Context[]> {
    let enrollmentQuery = database.from('enrollments').select('course_id,course_version_id,status,branch_id,branch_scope_known')
      .eq('user_id', actor.userId).in('status', ['active', 'completed']);
    if (query.courseId) enrollmentQuery = enrollmentQuery.eq('course_id', query.courseId);
    const result = await enrollmentQuery;
    databaseFailure(result.error, 'Course enrollments could not be loaded');
    const output: Context[] = [];
    for (const enrollment of recordsOf(result.data)) {
      if (typeof enrollment.course_id !== 'string' || typeof enrollment.course_version_id !== 'string') continue;
      // Multi-school views omit explicitly suspended schools without denying the other schools.
      try { await assertEnrollmentMembershipAccess(actor, enrollment, database); }
      catch (error) {
        if (error instanceof ApiError && error.code === 'MEMBERSHIP_SUSPENDED' && !query.courseId) continue;
        throw error;
      }
      const outlineResult = await database.from('course_version_outline').select('version_id,course_id,outline,meta,default_language')
        .eq('version_id', enrollment.course_version_id).eq('course_id', enrollment.course_id).maybeSingle();
      databaseFailure(outlineResult.error, 'Pinned course outline could not be loaded');
      const outline = recordOf(outlineResult.data);
      if (!outline) continue;
      output.push({ enrollment, outline, courseId: enrollment.course_id, versionId: enrollment.course_version_id,
        branchId: enrollment.branch_scope_known === true && typeof enrollment.branch_id === 'string' ? enrollment.branch_id : null,
        locale: query.locale ?? 'vi' });
    }
    return output;
  }

  async function targets(context: Context): Promise<Target[]> {
    const result = await database.from('course_version_items').select('item_id,kind,grading').eq('version_id', context.versionId);
    databaseFailure(result.error, 'Pinned course tasks could not be loaded');
    const items = new Map(recordsOf(result.data).map((row) => [row.item_id, row]));
    const fallback = context.outline.default_language === 'en' ? 'en' : 'vi';
    const courseTitle = text(recordOf(context.outline.meta)?.title, context.locale, fallback);
    return outlineItems(context.outline.outline).flatMap((item): Target[] => {
      const stored = items.get(item.id);
      const grading = recordOf(stored?.grading);
      if (!stored || !grading) return [];
      const base = { courseId: context.courseId, courseVersionId: context.versionId, branchId: context.branchId,
        itemId: item.id, title: text(item.title, context.locale, fallback), courseTitle };
      if (stored.kind === 'exam' && item.type === 'exam') return [{ ...base, blockId: null, kind: 'exam', grading,
        href: href(context.courseId, item.id, null) }];
      const assignments = recordOf(grading.assignments);
      if (!assignments || stored.kind !== item.type) return [];
      return Object.keys(assignments).flatMap((assignmentId): Target[] => {
        if (stored.kind === 'assignment' && assignmentId !== item.id) return [];
        if (stored.kind !== 'assignment' && stored.kind !== 'lesson') return [];
        const blockId = stored.kind === 'assignment' ? null : assignmentId;
        return [{ ...base, blockId, kind: 'assignment', grading, href: href(context.courseId, item.id, blockId) }];
      });
    });
  }

  async function schedules(context: Context): Promise<Map<string, string | null>> {
    if (!context.branchId) return new Map();
    const result = await database.from('assignment_schedules').select('item_id,block_id,due_at')
      .eq('course_version_id', context.versionId).eq('branch_id', context.branchId);
    databaseFailure(result.error, 'Assignment schedules could not be loaded');
    return new Map(recordsOf(result.data).map((row) => [key(row.item_id, row.block_id), timestamp(row.due_at)]));
  }

  async function tasks(actor: Actor, query: Query = {}): Promise<CourseTask[]> {
    const output: CourseTask[] = [];
    for (const context of await contexts(actor, query)) {
      const [allTargets, dueDates, submissions, exams] = await Promise.all([
        targets(context), schedules(context),
        database.from('assignment_submissions').select('id,item_id,block_id,status,attempt_no,submitted_at,late,grades(released,decision)')
          .eq('user_id', actor.userId).eq('course_version_id', context.versionId).order('attempt_no', { ascending: false }),
        database.from('exam_attempts').select('id,item_id,status,attempt_no,late')
          .eq('user_id', actor.userId).eq('course_version_id', context.versionId).order('attempt_no', { ascending: false }),
      ]);
      databaseFailure(submissions.error, 'Assignment submissions could not be loaded');
      databaseFailure(exams.error, 'Exam attempts could not be loaded');
      for (const target of allTargets) {
        const row = (target.kind === 'assignment' ? recordsOf(submissions.data) : recordsOf(exams.data))
          .find((entry) => entry.item_id === target.itemId && (target.kind === 'exam' || key(entry.item_id, entry.block_id) === targetKey(target)));
        const grade = oneRecord(row?.grades);
        const status = target.kind === 'assignment' && row && grade?.released !== true
          ? row.status === 'submitted' ? 'submitted' : 'in_review'
          : grade?.released === true && typeof grade.decision === 'string' ? grade.decision : typeof row?.status === 'string' ? row.status : 'not_started';
        const { grading: _grading, ...identity } = target;
        output.push({ ...identity, id: `${context.versionId}:${targetKey(target)}`, status,
          dueAt: target.kind === 'assignment' ? dueDates.get(targetKey(target)) ?? null : null,
          submissionId: typeof row?.id === 'string' ? row.id : null, late: typeof row?.late === 'boolean' ? row.late : null });
      }
    }
    return output;
  }

  async function results(actor: Actor, query: Query = {}): Promise<CourseResult[]> {
    const output: CourseResult[] = [];
    for (const context of await contexts(actor, query)) {
      const [allTargets, assignments, exams, quizzes] = await Promise.all([
        targets(context),
        database.from('assignment_submissions').select('id,item_id,block_id,status,attempt_no,submitted_at,grades(released,decision,total_points,max_points,passed,graded_at)')
          .eq('user_id', actor.userId).eq('course_version_id', context.versionId),
        database.from('exam_attempts').select('id,item_id,status,attempt_no,points,max_points,percent,submitted_at,result_available_at,released_at,grading_snapshot')
          .eq('user_id', actor.userId).eq('course_version_id', context.versionId),
        database.from('quiz_attempts').select('id,item_id,quiz_id,points,max_points,percent,passed,submitted_at')
          .eq('user_id', actor.userId).eq('course_version_id', context.versionId),
      ]);
      for (const result of [assignments, exams, quizzes]) databaseFailure(result.error, 'Recorded results could not be loaded');
      const byTarget = new Map(allTargets.map((target) => [targetKey(target), target]));
      for (const row of recordsOf(assignments.data)) {
        const target = byTarget.get(key(row.item_id, row.block_id));
        const grade = oneRecord(row.grades);
        if (!target || target.kind !== 'assignment' || grade?.released !== true) continue;
        add(row, target, 'assignment', grade.total_points, grade.max_points, null, grade.passed, grade.graded_at, grade.decision);
      }
      for (const row of recordsOf(exams.data)) {
        const target = byTarget.get(key(row.item_id, null));
        const settings = recordOf(recordOf(row.grading_snapshot)?.exam);
        const showScore = recordOf(settings?.review)?.showScore;
        const available = timestamp(row.result_available_at) !== null || (row.status === 'graded'
          && (showScore === 'immediately' || (showScore === 'on_release' && timestamp(row.released_at) !== null)));
        if (!target || target.kind !== 'exam' || !available) continue;
        add(row, target, 'exam', row.points, row.max_points, row.percent, null, row.result_available_at ?? row.submitted_at, row.status);
      }
      const fallback = context.outline.default_language === 'en' ? 'en' : 'vi';
      const outlined = new Map(outlineItems(context.outline.outline).map((item) => [item.id, item]));
      for (const row of recordsOf(quizzes.data)) {
        const item = typeof row.item_id === 'string' ? outlined.get(row.item_id) : undefined;
        if (!item || typeof row.quiz_id !== 'string') continue;
        const identity = { courseId: context.courseId, courseVersionId: context.versionId, branchId: context.branchId,
          itemId: item.id, blockId: row.quiz_id, title: text(item.title, context.locale, fallback),
          courseTitle: text(recordOf(context.outline.meta)?.title, context.locale, fallback), href: href(context.courseId, item.id, row.quiz_id) };
        add(row, identity, 'quiz', row.points, row.max_points, row.percent, row.passed, row.submitted_at, 'recorded');
      }
    }
    return output.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    function add(row: Row, target: CourseworkIdentity, kind: CourseResult['kind'], rawPoints: unknown, rawMax: unknown,
      rawPercent: unknown, passed: unknown, recorded: unknown, status: unknown) {
      const points = number(rawPoints), maxPoints = number(rawMax), recordedAt = timestamp(recorded);
      if (typeof row.id !== 'string' || points === null || maxPoints === null || !recordedAt) return;
      // Select only the identity: grading snapshots and draft feedback never leave the service.
      const { courseId, courseVersionId, branchId, itemId, blockId, title, courseTitle, href: targetHref } = target;
      output.push({ id: row.id, courseId, courseVersionId, branchId, itemId, blockId, title, courseTitle, href: targetHref,
        kind, points, maxPoints, percent: number(rawPercent), passed: typeof passed === 'boolean' ? passed : null,
        recordedAt, status: typeof status === 'string' ? status : 'recorded' });
    }
  }

  async function calendar(actor: Actor, query: CalendarQuery): Promise<LearningCalendar> {
    const parsed = CalendarQuerySchema.parse(query);
    const start = Date.parse(parsed.start), end = Date.parse(parsed.end);
    const events: LearningCalendarEvent[] = [];
    for (const context of await contexts(actor, parsed)) {
      const [allTargets, dueDates] = await Promise.all([targets(context), schedules(context)]);
      for (const target of allTargets) {
        const exam = recordOf(target.grading.exam);
        const dates: Array<[LearningCalendarEvent['kind'], unknown]> = target.kind === 'assignment'
          ? [['assignment_due', dueDates.get(targetKey(target))]] : [['exam_open', exam?.openAt], ['exam_close', exam?.closeAt]];
        for (const [kind, date] of dates) {
          const at = timestamp(date);
          if (!at || Date.parse(at) < start || Date.parse(at) >= end) continue;
          const { grading: _grading, kind: _targetKind, ...identity } = target;
          events.push({ ...identity, id: `${context.versionId}:${targetKey(target)}:${kind}`, kind, at });
        }
      }
    }
    return { timeZone: 'Asia/Ho_Chi_Minh', events: events.sort((a, b) => a.at.localeCompare(b.at)) };
  }

  async function announcements(actor: Actor, query: Query = {}): Promise<LearningAnnouncement[]> {
    const output: LearningAnnouncement[] = [];
    for (const context of await contexts(actor, query)) {
      if (!context.branchId) continue;
      const result = await database.from('teaching_announcements').select('id,branch_id,course_id,title,body,published_at')
        .eq('branch_id', context.branchId).eq('course_id', context.courseId).eq('status', 'published');
      databaseFailure(result.error, 'Course announcements could not be loaded');
      for (const row of recordsOf(result.data)) {
        const publishedAt = timestamp(row.published_at);
        if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string' || !publishedAt || Date.parse(publishedAt) > now().getTime()) continue;
        output.push({ id: row.id, branchId: context.branchId, courseId: context.courseId,
          courseTitle: text(recordOf(context.outline.meta)?.title, context.locale, context.outline.default_language === 'en' ? 'en' : 'vi'),
          title: row.title, body: row.body, publishedAt });
      }
    }
    return output.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  return { tasks, results, calendar, announcements };
}
function service() { return createCourseworkReadService(supabaseService() as unknown as LearnerDatabase); }
export const listCourseTasks = (actor: Actor, query: Query = {}) => service().tasks(actor, query);
export const listCourseResults = (actor: Actor, query: Query = {}) => service().results(actor, query);
export const listLearningCalendar = (actor: Actor, query: CalendarQuery) => service().calendar(actor, query);
export const listLearningAnnouncements = (actor: Actor, query: Query = {}) => service().announcements(actor, query);
