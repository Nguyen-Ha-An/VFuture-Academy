import 'server-only';

import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { resolveL10nString, type Locale } from '@/content-engine';
import { getCourse, type listCatalog } from '@/features/catalog/service';
import type { LearnerHomeSummary, LearningTarget } from '@/features/learner/summary';
import { branchIdForUser } from '@/features/me/service';
import { passport, SKILL_LEVELS } from '@/features/skills/service';
import { weeklyLeaderboard } from '@/features/xp/service';
import type { Actor } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { coursePartLabel, paceBand, prerequisiteLabels } from '../format';
import { TraceRail, type TraceEvent } from '../ui/TraceRail';
import { learnerActivitySeries } from './activity.server';
import { LearnerDashboardView } from './LearnerDashboardView';
import { LearnerReadout, type Reading, type ReadoutRank, type ReadoutSkill } from './LearnerReadout';
import { examDeadline, type BenchCourseRow, type BenchProgress, type DashboardResume, type LearnerDashboardData } from './model';

type CatalogCourse = Awaited<ReturnType<typeof listCatalog>>[number];
type CourseDetail = Awaited<ReturnType<typeof getCourse>>;
type OutlineItem = CourseDetail['outline']['modules'][number]['items'][number];

const COMPLETION_STRIP_MS = 7 * 86_400_000;

/** Shared by the Trace Rail and the XP readout so the page issues one xp_events query. */
const activityFor = cache(async (userId: string) => {
  const t = await getTranslations('bench.learner.trace');
  return learnerActivitySeries(userId, {
    points: points => t('points', { points }),
    kind: kind => (['exam_passed', 'assignment_approved', 'course_completed'].includes(kind) ? t(`kinds.${kind}` as 'kinds.exam_passed') : kind),
  });
});

function settle<T>(result: PromiseSettledResult<T>, label: string): Reading<T> {
  if (result.status === 'fulfilled') return { ok: true, value: result.value };
  console.error(`[learner bench] ${label} unavailable`, result.reason);
  return { ok: false };
}

/**
 * Course outlines and progress for the resume strip and the active-courses sheet. This reuses
 * the course overview loader for at most four courses; one failing course only loses its bar.
 */
async function courseDetails(actor: Actor, courseIds: string[], locale: Locale) {
  const results = await Promise.allSettled(courseIds.map(id => getCourse(actor, id, locale)));
  return new Map(courseIds.map((id, index) => {
    const result = results[index];
    if (result.status === 'rejected') console.error('[learner bench] course progress unavailable', id, result.reason);
    return [id, result.status === 'fulfilled' ? result.value : null] as const;
  }));
}

function locate(detail: CourseDetail | null | undefined, itemId: string) {
  if (!detail) return null;
  for (const [moduleIndex, courseModule] of detail.outline.modules.entries()) {
    const itemIndex = courseModule.items.findIndex(item => item.id === itemId);
    if (itemIndex >= 0) return { moduleIndex, itemIndex, item: courseModule.items[itemIndex] };
  }
  return null;
}

function nextItem(detail: CourseDetail | null | undefined): OutlineItem | null {
  if (!detail) return null;
  const items = detail.outline.modules.flatMap(courseModule => courseModule.items);
  return items.find(item => item.required && item.status !== 'completed') ?? items.find(item => item.status !== 'completed') ?? null;
}

function progressOf(detail: CourseDetail | null | undefined, exam: LearnerHomeSummary['upcomingExam'], now: Date): BenchProgress | null {
  if (!detail) return null;
  // A band only for a real schedule: the enrolment start to this course's exam deadline.
  const due = exam && exam.courseId === detail.id ? exam.closeAt : null;
  const enrolledAt = typeof detail.enrollment?.enrolledAt === 'string' ? detail.enrollment.enrolledAt : null;
  return { completed: detail.progress.completedItems, total: detail.progress.totalItems, band: paceBand(enrolledAt, due, now), due };
}

export async function buildDashboardData({ actor, locale, summary, catalog, name, now = new Date() }: { actor: Actor; locale: Locale; summary: LearnerHomeSummary; catalog: CatalogCourse[]; name: string; now?: Date }): Promise<LearnerDashboardData> {
  const [t, enums] = await Promise.all([getTranslations('bench.learner.dashboard'), getTranslations('learner.enums')]);
  const active = catalog.filter(course => course.enrollment?.status === 'active').slice(0, 3);
  const hasCompleted = catalog.some(course => course.enrollment?.status === 'completed');
  const byId = new Map(catalog.map(course => [course.id, course]));
  const target: LearningTarget | null = summary.continueLearning ?? summary.nextRequired;
  const ids = [...new Set([...(target ? [target.courseId] : []), ...active.map(course => course.id)])];
  const details = ids.length ? await courseDetails(actor, ids, locale) : new Map<string, CourseDetail | null>();
  const partOf = (courseId: string) => coursePartLabel(byId.get(courseId) ?? {});
  const code = (item: OutlineItem, moduleIndex: number, itemIndex: number) => item.type === 'lesson' ? `L${moduleIndex + 1}.${itemIndex + 1}` : t(item.type === 'exam' ? 'nextExam' : 'nextAssignment');

  const courses: BenchCourseRow[] = active.map(course => {
    const detail = details.get(course.id);
    const next = nextItem(detail);
    const where = next ? locate(detail, next.id) : null;
    const sub = [
      detail ? t('items', { count: detail.progress.totalItems }) : null,
      course.estimatedMinutes ? t('minutes', { count: course.estimatedMinutes }) : null,
      enums(`level.${course.level}` as 'level.foundation'),
    ].filter(Boolean).join(' · ');
    return {
      id: course.id,
      title: course.title,
      part: coursePartLabel(course),
      dependsOn: prerequisiteLabels(course, catalog),
      href: routes.learner.course(course.id),
      sub,
      progress: progressOf(detail, summary.upcomingExam, now),
      next: next && where ? { code: code(next, where.moduleIndex, where.itemIndex), title: next.title, href: routes.learner.courseItem(course.id, next.id) } : null,
    };
  });

  const resumeFor = (courseId: string, courseTitle: string, itemId: string, itemTitle: string): DashboardResume => {
    const detail = details.get(courseId);
    const where = locate(detail, itemId);
    return {
      title: itemTitle,
      href: routes.learner.courseItem(courseId, itemId),
      courseTitle,
      part: partOf(courseId),
      position: where ? `M${where.moduleIndex + 1} · ${code(where.item, where.moduleIndex, where.itemIndex)}` : undefined,
      minutes: where && typeof where.item.estimatedMinutes === 'number' ? where.item.estimatedMinutes : undefined,
      progress: progressOf(detail, summary.upcomingExam, now),
    };
  };
  // All caught up on required work: the anchor becomes the next unstarted (optional) item.
  const optional = target ? null : active.map(course => ({ course, item: nextItem(details.get(course.id)) })).find(entry => entry.item);
  const resume = target
    ? resumeFor(target.courseId, target.courseTitle, target.itemId, target.itemTitle)
    : optional?.item ? resumeFor(optional.course.id, optional.course.title, optional.item.id, optional.item.title) : null;

  const certificate = [...summary.rewards.certificates]
    .filter(entry => { const at = Date.parse(entry.issuedAt); return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= COMPLETION_STRIP_MS; })
    .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))[0];
  const exam = summary.upcomingExam;
  const feedback = summary.feedback;

  return {
    now,
    name,
    state: resume ? 'resume' : active.length ? 'caught-up' : hasCompleted ? 'completed' : 'first-run',
    resume,
    courses,
    exam: exam ? { title: exam.itemTitle, courseTitle: exam.courseTitle, part: partOf(exam.courseId), href: routes.learner.courseItem(exam.courseId, exam.itemId), openAt: exam.openAt, closeAt: exam.closeAt } : null,
    feedback: feedback ? { title: feedback.itemTitle, courseTitle: feedback.courseTitle, href: routes.learner.courseItem(feedback.courseId, feedback.itemId), decision: feedback.decision, message: feedback.message, at: feedback.at } : null,
    completion: certificate ? { courseTitle: certificate.courseTitle || byId.get(certificate.courseId)?.title || certificate.courseId, part: partOf(certificate.courseId) } : null,
  };
}

/** The learner Trace Rail on its own, for /app/profile (spec section 8). */
export async function LearnerActivityTrace({ userId }: { userId: string }) {
  const series = await activityFor(userId);
  return <TraceRail days={series.days} events={series.events} kind="learner" />;
}

async function LearnerTraceSlot({ userId, data }: { userId: string; data: LearnerDashboardData }) {
  const [series, t] = await Promise.all([activityFor(userId), getTranslations('bench.learner.trace')]);
  const deadline = examDeadline(data.exam, data.now);
  const events: TraceEvent[] = [...series.events];
  if (data.exam) events.push({ dayIndex: series.days.length - 1, tone: 'pending', label: [t('examMarker', { title: data.exam.title }), deadline?.countdown].filter(Boolean).join(' · ') });
  return <TraceRail days={series.days} events={events} kind="learner" />;
}

async function viewerRank(userId: string, handle: string | null): Promise<ReadoutRank> {
  const branchId = await branchIdForUser(userId);
  if (!branchId) return { rank: null, reason: 'no-branch' };
  const [entries, previous] = await Promise.all([weeklyLeaderboard('branch', branchId), weeklyLeaderboard('branch', branchId, { weeksAgo: 1 }).catch(() => null)]);
  const viewer = handle ? entries.find(entry => entry.handle === handle) : undefined;
  if (!viewer) return { rank: null, reason: 'no-xp' };
  // A failed prior-week read omits the change rather than failing the rank cell.
  const previousRank = previous === null ? undefined : previous.find(entry => entry.handle === handle)?.rank ?? null;
  return { rank: viewer.rank, total: entries.length, previousRank };
}

async function topSkills(userId: string, locale: Locale): Promise<ReadoutSkill[]> {
  const skills = await passport(userId);
  return skills
    .map(skill => ({ skill, rank: SKILL_LEVELS.indexOf(skill.level) }))
    .sort((left, right) => right.rank - left.rank || right.skill.evidence.length - left.skill.evidence.length)
    .slice(0, 3)
    .map(({ skill, rank }) => ({ id: skill.id, name: resolveL10nString(skill.name, locale, 'vi'), level: (rank + 1) as 1 | 2 | 3, levelKey: skill.level }));
}

async function LearnerReadoutSlot({ userId, handle, locale, data }: { userId: string; handle: string | null; locale: Locale; data: LearnerDashboardData }) {
  const [xp, rank, skills] = await Promise.allSettled([activityFor(userId), viewerRank(userId, handle), topSkills(userId, locale)]);
  const deadline = examDeadline(data.exam, data.now);
  const t = await getTranslations('bench.learner.readout');
  const xpReading = settle(xp, 'xp');
  return <LearnerReadout
    locale={locale}
    xp={xpReading.ok ? { ok: true, value: { week: xpReading.value.week.current, previous: xpReading.value.week.previous, values: xpReading.value.values } } : { ok: false }}
    deadline={deadline}
    deadlineLabel={data.exam ? t('deadlineExam', { part: data.exam.part }) : undefined}
    rank={settle(rank, 'rank')}
    skills={settle(skills, 'skills')} />;
}

/** Server entry for the bench /app view: primary data first, secondary blocks streamed into slots. */
export async function LearnerDashboardBench({ actor, locale, summary, catalog, name }: { actor: Actor; locale: Locale; summary: LearnerHomeSummary; catalog: CatalogCourse[]; name: string }) {
  const data = await buildDashboardData({ actor, locale, summary, catalog, name });
  return <LearnerDashboardView data={data}
    trace={<LearnerTraceSlot userId={actor.userId} data={data} />}
    readout={<LearnerReadoutSlot userId={actor.userId} handle={summary.rewards.profile.handle} locale={locale} data={data} />} />;
}
