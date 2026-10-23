import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import type { LearnerItem, Locale } from '@/content-engine';
import { getCourse } from '@/features/catalog/service';
import { readItemActivitySummary } from '@/features/learner/summary';
import { ItemPlayer } from '@/features/learner/ui/ItemPlayer';
import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { getItemPayload } from '@/features/progress/service';
import { assignmentId, type AssignmentTarget } from '@/features/submissions/contracts';
import { session as readAssignmentSession } from '@/features/submissions/service';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';
import { ActivityFrame } from '@/features/workspace-ui/learner/activity/ActivityFrame';
import { pad2 } from '@/features/workspace-ui/learner/activity/status';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function inlineAssignmentIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const object = record(candidate);
    if (!object) return;
    if (object.type === 'assignment' && typeof object.id === 'string') found.add(object.id);
    Object.values(object).forEach(visit);
  };
  visit(value);
  return [...found];
}

export default async function LearnerItemPage({ params }: { params: Promise<{ courseId: string; itemId: string }> }) {
  const [{ courseId, itemId }, user, localeValue, t, enums, activity] = await Promise.all([
    params,
    requireUser(),
    getLocale(),
    getTranslations('learner.item'),
    getTranslations('learner.enums'),
    getTranslations('bench.learner.activity'),
  ]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const actor = { userId: user.id, roles: [] };
  let payload: Awaited<ReturnType<typeof getItemPayload>>;
  let course: Awaited<ReturnType<typeof getCourse>>;
  try {
    [payload, course] = await Promise.all([
      getItemPayload(actor, courseId, itemId, locale),
      getCourse(actor, courseId, locale),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (!course.enrollment) redirect(routes.learner.course(courseId));
  const item = payload.item as LearnerItem;
  const assignmentTargets: AssignmentTarget[] = item.kind === 'assignment'
    ? [{ blockId: null }]
    : inlineAssignmentIds(item).map((blockId) => ({ blockId }));
  const [itemSummary, assignmentSessionValues] = await Promise.all([
    readItemActivitySummary(actor, payload.courseVersionId, itemId),
    Promise.all(assignmentTargets.map((target) => readAssignmentSession(actor, {
      courseId,
      itemId,
      blockId: target.blockId,
    }))),
  ]);
  const assignmentSessions = Object.fromEntries(
    assignmentSessionValues.map((session) => [assignmentId(session.locator), session]),
  );
  const items = course.outline.modules.flatMap((module) => module.items);
  const index = items.findIndex((outlineItem) => outlineItem.id === itemId);
  if (index < 0) notFound();
  const previous = items[index - 1];
  const next = items[index + 1];
  const itemCompletion = record(record(item)?.completion);
  const completionMode = itemSummary.completionMode
    ?? (itemCompletion?.mode === 'activities' ? 'activities' : itemCompletion?.mode === 'view' ? 'view' : null);
  const courseHref = routes.learner.course(courseId);
  const kindLabel = (kind: unknown) => enums(`kind.${kind === 'exam' || kind === 'assignment' ? kind : 'lesson'}`);
  const progress = { completed: course.progress.completedItems, total: course.progress.totalItems };
  const player = <ItemPlayer key={`${courseId}:${itemId}`}
    courseId={courseId}
    itemId={itemId}
    locale={locale}
    contentLocale={payload.locale}
    item={item}
    activityState={payload.activityState}
    completionMode={completionMode}
    completed={course.progress.items[itemId] === 'completed'}
    attemptsUsed={itemSummary.attemptsUsed}
    assignmentSessions={assignmentSessions}
    progress={progress}
    courseHref={courseHref}
    next={next ? { href: routes.learner.courseItem(courseId, next.id), title: next.title } : undefined}
  />;

  const moduleIndex = course.outline.modules.findIndex((courseModule) => courseModule.items.some((outlineItem) => outlineItem.id === itemId));
  const currentModule = course.outline.modules[moduleIndex];
  const minutes = typeof record(item)?.estimatedMinutes === 'number' ? record(item)?.estimatedMinutes as number : null;
  return (
    <ActivityFrame
      kind={item.kind === 'exam' || item.kind === 'assignment' ? item.kind : 'lesson'}
      course={{ title: course.meta.title || t('back'), href: courseHref }}
      progress={progress}
      position={{ current: index + 1, total: items.length }}
      outline={<FocusOutline courseId={courseId} itemId={itemId} modules={course.outline.modules} courseTitle={course.meta.title} progress={progress} />}
      head={{
        kicker: <><span>{kindLabel(item.kind)}</span>{currentModule?.title ? <><span aria-hidden="true"> · </span><span>{currentModule.title}</span></> : null}</>,
        title: item.title,
        meta: [
          <><span aria-hidden="true">{moduleIndex >= 0 ? `M${pad2(moduleIndex + 1)} · ` : ''}{pad2(index + 1)} / {pad2(items.length)}</span><span className="sr-only">{t('step', { current: index + 1, total: items.length })}</span></>,
          minutes ? activity('minutes', { count: minutes }) : null,
        ],
        status: course.progress.items[itemId] ?? items[index]?.status ?? 'not_started',
      }}
      pager={{
        label: activity('pager'),
        previous: previous ? { href: routes.learner.courseItem(courseId, previous.id), title: previous.title, kicker: activity('prevKicker', { kind: kindLabel(previous.type) }) } : undefined,
        next: next ? { href: routes.learner.courseItem(courseId, next.id), title: next.title, kicker: activity('nextKicker', { kind: kindLabel(next.type) }) } : undefined,
      }}
    >
      {player}
    </ActivityFrame>
  );
}
