'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { LearnerItem } from '@/content-engine/compile';
import { AssignmentRenderer, LessonRenderer, registerAll } from '@/content-engine/render';
import type { Locale } from '@/content-engine/schema/common';
import { ExamFlow } from '@/features/exams/ui/ExamFlow';
import type { LearnerExam } from '@/features/exams/ui/types';
import { createHttpExamClient } from '@/features/exams/ui/client';
import { createApiRuntime } from '@/features/runtime';
import type { RuntimeWriteTarget } from '@/features/runtime';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { ActivityFooter } from '@/features/workspace-ui/learner/activity/ActivityFooter';
import { useActivityProgress } from '@/features/workspace-ui/learner/activity/ActivityProgress';
import { LearnerNavigationLink } from './LearnerNavigationLink';
import { assignmentId, compareAssignmentTimestamps, type AssignmentSessionResult } from '@/features/submissions/contracts';

registerAll();

type Submission = {
  id?: string;
  attemptNo?: number;
  status?: string;
  submittedAt?: string;
  payload?: unknown;
  feedback?: unknown;
  grade?: { feedback?: unknown; decision?: string; released?: boolean } | null;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assignmentActivityState(
  activityState: Record<string, unknown>,
  sessions: Record<string, AssignmentSessionResult>,
): Record<string, unknown> {
  const hydrated = { ...activityState };
  for (const session of Object.values(sessions)) {
    const latestSubmission = session.submissions[0];
    if (!latestSubmission) continue;
    const key = assignmentId(session.locator);
    const existing = activityState[key];
    if (existing !== undefined) {
      const updatedAt = recordOf(existing)?.updatedAt;
      const comparison = typeof updatedAt === 'string'
        ? compareAssignmentTimestamps(latestSubmission.submittedAt, updatedAt)
        : null;
      if (comparison !== 1) continue;
    }
    const existingRecord = recordOf(existing);
    hydrated[key] = {
      status: latestSubmission.status,
      payload: latestSubmission.payload,
      submittedAt: latestSubmission.submittedAt,
      ...(existingRecord?.completed === true ? { completed: true } : {}),
    };
  }
  return hydrated;
}

export type ItemPlayerProps = {
  courseId: string;
  itemId: string;
  locale: Locale;
  contentLocale?: Locale;
  item: LearnerItem;
  activityState: Record<string, unknown>;
  completionMode: 'view' | 'activities' | null;
  completed: boolean;
  attemptsUsed: number;
  assignmentSessions?: Record<string, AssignmentSessionResult>;
  submissions?: Submission[];
  progress?: { completed: number; total: number };
  /** The course overview; the footer's primary action on the last item. */
  courseHref?: string;
  /** The next outline item; the footer's primary action. */
  next?: { href: string; title: string };
};

export function ItemPlayer(props: ItemPlayerProps) {
  const t = useTranslations('learner.item');
  const activity = useTranslations('bench.learner.activity');
  const frame = useActivityProgress();
  const [completed, setCompleted] = useState(props.completed);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedWrites, setFailedWrites] = useState<string[]>([]);
  const [retryingWrites, setRetryingWrites] = useState(false);
  const [leaveSaveFailed, setLeaveSaveFailed] = useState(false);
  const pendingDecision = useRef<((decision: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const retrying = useRef(false);
  const resolveNavigation = (decision: boolean) => {
    const resolve = pendingDecision.current;
    pendingDecision.current = null;
    setLeaveSaveFailed(false);
    resolve?.(decision);
  };
  const writeKey = (target: RuntimeWriteTarget) => target.kind === 'viewed' ? 'viewed' : `block:${target.blockId}`;
  const [runtime] = useState(() => {
    const initialState = assignmentActivityState(props.activityState, props.assignmentSessions ?? {});
    return createApiRuntime({
      courseId: props.courseId,
      itemId: props.itemId,
      locale: props.locale,
      initialState,
      assignmentSessions: props.assignmentSessions,
      onWriteError: (_error, target) => {
        const key = writeKey(target);
        setFailedWrites((current) => current.includes(key) ? current : [...current, key]);
      },
      onWriteSuccess: (target) => {
        const key = writeKey(target);
        setFailedWrites((current) => current.filter((value) => value !== key));
        if (target.kind === 'viewed' && props.completionMode === 'view') {
          setCompleted(true);
          setError(null);
        }
      },
      onItemCompleted: () => {
        if (props.completionMode === 'activities') setCompleted(true);
      },
    });
  });
  const [examClient] = useState(() => createHttpExamClient({ courseId: props.courseId, itemId: props.itemId }));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingDecision.current?.(false);
      pendingDecision.current = null;
      runtime.dispose();
    };
  }, [runtime]);

  const beforeNavigate = useCallback(async () => {
    try {
      await runtime.flush();
      return mounted.current;
    } catch {
      if (!mounted.current) return false;
      return new Promise<boolean>((resolve) => {
        pendingDecision.current = resolve;
        setLeaveSaveFailed(true);
      });
    }
  }, [runtime]);

  useEffect(() => registerNavigationGuard(beforeNavigate), [beforeNavigate]);

  // The frame's readout and head tag follow a completion made on this page (reported once).
  const reported = useRef(props.completed);
  const report = frame?.report;
  const frameValue = frame?.value;
  useEffect(() => {
    if (!completed || reported.current || !report || !frameValue) return;
    reported.current = true;
    report({ completed: Math.min(frameValue.total, frameValue.completed + 1), total: frameValue.total }, 'completed');
  }, [completed, frameValue, report]);

  // Mark complete (and its Retry) unmount on success; hand focus to the footer's primary action.
  const primaryAction = useRef<HTMLAnchorElement>(null);
  const focusAfterComplete = useRef(false);
  useEffect(() => {
    if (!completed || !focusAfterComplete.current) return;
    focusAfterComplete.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    primaryAction.current?.focus();
  }, [completed]);

  const markComplete = async () => {
    focusAfterComplete.current = true;
    setMarking(true);
    setError(null);
    try {
      await runtime.completeViewed();
    } catch {
      setError(t('markError'));
    } finally {
      setMarking(false);
    }
  };

  const retryWrites = async () => {
    if (retrying.current) return;
    retrying.current = true;
    const decision = pendingDecision.current;
    setRetryingWrites(true);
    try {
      await runtime.retry();
      if (mounted.current && decision && pendingDecision.current === decision) resolveNavigation(true);
    } catch {
      // The runtime reports the specific failed target through onWriteError.
    } finally {
      retrying.current = false;
      if (mounted.current) setRetryingWrites(false);
    }
  };

  return (
    <div className="space-y-6">
      {props.progress && !frame ? (
        <section aria-label={t('courseProgress')} className="rounded-lg border border-border bg-card p-4 min-[760px]:p-5">
          <div className="mb-2 flex justify-between gap-4 text-sm text-muted-foreground">
            <span>{t('courseProgress')}</span>
            <span>{t('progressValue', props.progress)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t('courseProgress')} aria-valuemin={0} aria-valuemax={props.progress.total} aria-valuenow={props.progress.completed} aria-valuetext={t('progressValue', props.progress)}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${props.progress.total ? (props.progress.completed / props.progress.total) * 100 : 0}%` }} />
          </div>
        </section>
      ) : null}

      <div lang={props.contentLocale ?? props.locale}>
        {props.item.kind === 'lesson' ? <LessonRenderer item={props.item} runtime={runtime} headingLevel={2} presentation hideTitle /> : null}
        {props.item.kind === 'assignment' ? <AssignmentRenderer assignment={props.item} target={{ blockId: null }} runtime={runtime} hideTitle /> : null}
        {props.item.kind === 'exam' ? (
          <ExamFlow
            exam={props.item as LearnerExam}
            attemptsUsed={props.attemptsUsed}
            client={examClient}
            runtime={runtime}
            headingLevel={2}
            hideTitle
          />
        ) : null}
      </div>

      {failedWrites.length > 0 && !error ? (
        <div className="vf-notice" data-tone="fault" role="alert">
          <span className="vf-kicker">{activity('state.notSaved')}</span>
          <p className="m-0 text-sm">{t('saveError')}</p>
          <button type="button" onClick={() => void retryWrites()} disabled={retryingWrites} className="vf-btn vf-btn-lg">
            {retryingWrites ? t('retryingSave') : t('retrySave')}
          </button>
        </div>
      ) : null}

      {leaveSaveFailed ? <Dialog.Root open={leaveSaveFailed} onOpenChange={(open) => { if (!open) resolveNavigation(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-[8px] border border-border border-l-2 border-l-destructive bg-card p-6 text-card-foreground" onCloseAutoFocus={(event) => event.preventDefault()}>
            <Dialog.Title className="text-xl font-medium tracking-[-0.01em]">{t('leaveTitle')}</Dialog.Title>
            <Dialog.Description className="text-sm leading-6 text-muted-foreground">{t('leaveSaveFailed')}</Dialog.Description>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => resolveNavigation(false)} className="vf-btn vf-btn-lg">{t('stayOnItem')}</button>
              <button type="button" onClick={() => void retryWrites()} disabled={retryingWrites} className="vf-btn vf-btn-primary vf-btn-lg">{retryingWrites ? t('retryingSave') : t('retrySave')}</button>
              <button type="button" onClick={() => resolveNavigation(true)} disabled={retryingWrites} className="vf-btn vf-btn-ghost vf-btn-lg">{t('leaveAnyway')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root> : null}

      {props.item.kind === 'lesson' ? (
        <ActivityFooter
          status={props.completionMode !== 'view'
            ? (completed ? { tone: 'signal', label: activity('state.completed') } : undefined)
            : completed ? { tone: 'signal', label: activity('state.completed') }
              : marking ? { tone: 'pending', label: activity('state.saving') }
                : error ? { tone: 'fault', label: activity('state.notSaved') } : undefined}
          note={props.completionMode === 'view'
            ? (completed ? activity('viewedComplete') : null)
            : props.completionMode === 'activities' && !completed ? activity('activitiesRequired') : null}
          action={<>
            {props.completionMode === 'view' && !completed ? (
              <button type="button" onClick={() => void markComplete()} disabled={marking} className="vf-btn vf-btn-lg">
                {marking ? t('marking') : t('markComplete')}
              </button>
            ) : null}
            {props.next ? (
              <LearnerNavigationLink ref={primaryAction} href={props.next.href} className="vf-btn vf-btn-primary vf-btn-lg">{activity('next', { title: props.next.title })} <span aria-hidden="true">→</span></LearnerNavigationLink>
            ) : props.courseHref ? (
              <LearnerNavigationLink ref={primaryAction} href={props.courseHref} className="vf-btn vf-btn-primary vf-btn-lg">{activity('backToCourse')}</LearnerNavigationLink>
            ) : null}
          </>}
        >
          {error ? (
            <div className="flex w-full flex-wrap items-center gap-3" role="alert">
              <p className="m-0 text-sm text-destructive">{error}</p>
              <button type="button" onClick={() => void markComplete()} disabled={marking} className="vf-btn">
                {marking ? t('retryingSave') : t('retrySave')}
              </button>
            </div>
          ) : null}
        </ActivityFooter>
      ) : null}

    </div>
  );
}
