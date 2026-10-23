'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/classic';
import { QuestionRenderer, registerAll, RenderScope, RichContentView } from '@/content-engine/render';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { ExamStartResult, ExamSubmitResult } from '../service';
import type { ExamClient } from './client';
import { ExamPalette, hasAnswer } from './ExamPalette';
import { createPendingExamDraftStore } from './pending-draft';
import type { PendingExamDraftStore } from './pending-draft';
import type { LearnerExam } from './types';
import { useAutosave } from './useAutosave';
import { useExamTimer } from './useExamTimer';
import { useIntegrityLog } from './useIntegrityLog';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { useActivityLock } from '@/features/workspace-ui/learner/activity/ActivityProgress';

registerAll();

export interface ExamPlayerProps {
  exam: LearnerExam;
  attempt: ExamStartResult;
  client: ExamClient;
  runtime: LessonRuntime;
  onSubmitted: (result: ExamSubmitResult) => void | Promise<void>;
  onTerminal?: () => void | Promise<void>;
  draftStore?: PendingExamDraftStore;
  headingLevel?: 1 | 2;
  hideTitle?: boolean;
}

export function ExamPlayer(props: ExamPlayerProps) {
  const t = useTranslations('exam.player');
  if (props.exam.sections.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-md border border-destructive bg-card p-6 text-center">
        <p role="alert">{t('emptyExam')}</p>
      </div>
    );
  }
  return <ExamPlayerContent {...props} />;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

function ExamPlayerContent({ exam, attempt, client, runtime, onSubmitted, onTerminal, draftStore: providedDraftStore, headingLevel = 1, hideTitle = false }: ExamPlayerProps) {
  const t = useTranslations('exam.player');
  // While an attempt runs the activity frame hides its pager; Back and Outline go through the guard below.
  useActivityLock(true);
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const SectionTitle = headingLevel === 1 ? 'h2' : 'h3';
  const sectionLevel = headingLevel === 1 ? 2 : 3;
  const QuestionTitle = headingLevel === 1 ? 'h3' : 'h4';
  const entries = exam.sections.flatMap((section, sectionIndex) =>
    section.questions.map((question) => ({ question, sectionIndex })),
  );
  const questions = entries.map((entry) => entry.question);
  const [answerGroups] = useState(() => Object.fromEntries(exam.sections.flatMap((section) => (
    section.questions.map((question) => [question.id, section.id])
  ))));
  const [draftStore] = useState(() => providedDraftStore ?? createPendingExamDraftStore(attempt.attemptId));
  const [pendingDraft] = useState(() => draftStore.read());
  const questionIds = new Set(questions.map(({ id }) => id));
  const restoredDraft = Object.fromEntries(Object.entries(pendingDraft ?? {}).filter(([id]) => questionIds.has(id)));
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({
    ...structuredClone(attempt.answers),
    ...restoredDraft,
  }));
  const answersRef = useRef(answers);
  const [answerRevision, setAnswerRevision] = useState(Object.keys(restoredDraft).length > 0 ? 1 : 0);
  const [submitError, setSubmitError] = useState(false);
  const [sectionSubmitPending, setSectionSubmitPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const submittingRef = useRef(false);
  const terminalTransitionRef = useRef(false);
  const containerRef = useRef<HTMLElement>(null);
  const questionHeadingRefs = useRef(new Map<string, HTMLHeadingElement>());
  const sectionHeadingRefs = useRef(new Map<string, HTMLHeadingElement>());
  const palettePanelRef = useRef<HTMLDivElement>(null);
  const paletteToggleRef = useRef<HTMLButtonElement>(null);
  const focusTargetRef = useRef<'question' | 'section' | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = entries[currentIndex];
  const currentSectionIndex = current?.sectionIndex ?? 0;
  const currentSection = exam.sections[currentSectionIndex] ?? null;
  const currentSectionId = currentSection?.id;
  const displayedEntries = exam.settings.layout === 'single_page'
    ? entries
    : exam.settings.layout === 'section_per_page'
      ? entries.filter((entry) => entry.sectionIndex === currentSectionIndex)
      : current ? [current] : [];
  const unansweredCount = questions.filter((question) => !hasAnswer(answers[question.id])).length;
  const {
    flushBeforeSubmit,
    fullscreenRetry,
    requestFullscreen,
    resume: resumeIntegrity,
  } = useIntegrityLog({
    client,
    containerRef,
    settings: exam.settings.integrity,
    submittingRef,
  });
  const handleAutosaveTerminal = useCallback(async () => {
    terminalTransitionRef.current = true;
    submittingRef.current = true;
    setSubmitting(true);
    await onTerminal?.();
  }, [onTerminal]);
  const {
    closedGroups,
    markDirty,
    markSubmitted,
    lastSaveErrorCode,
    persistAnswers,
    recoveryUnavailable,
    retryNow,
    saveStatus,
  } = useAutosave({
    answerGroups,
    answersRef,
    client,
    draftStore,
    initialAcceptedAnswers: attempt.answers,
    onTerminal: handleAutosaveTerminal,
    revision: answerRevision,
    submittingRef,
  });

  const submitAttempt = useCallback(async (expired = false, acceptedOnly = false) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(false);
    setSectionSubmitPending(false);
    try {
      if (!acceptedOnly) {
        const saved = await persistAnswers();
        if (!saved) {
          if (terminalTransitionRef.current) return;
          if (lastSaveErrorCode() === 'SECTION_DEADLINE_PASSED' && !expired) {
            setSectionSubmitPending(true);
            setSubmitDialogOpen(false);
            submittingRef.current = false;
            setSubmitting(false);
            resumeIntegrity();
            return;
          }
          if (lastSaveErrorCode() !== 'SECTION_DEADLINE_PASSED') {
            throw new Error('Final exam save failed.');
          }
        }
      }
      await flushBeforeSubmit();
      const result = await client.submit();
      markSubmitted();
      await onSubmitted(result);
      setSubmitDialogOpen(false);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (code === 'ATTEMPT_NOT_ACTIVE' || code === 'DEADLINE_PASSED') {
        markSubmitted();
        await onTerminal?.();
        return;
      }
      setSubmitError(true);
      submittingRef.current = false;
      setSubmitting(false);
      resumeIntegrity();
    }
  }, [client, flushBeforeSubmit, lastSaveErrorCode, markSubmitted, onSubmitted, onTerminal, persistAnswers, resumeIntegrity]);

  const { announcement: timerAnnouncement, remainingSeconds } = useExamTimer({
    deadlineAt: attempt.deadlineAt,
    serverNow: client.serverNow,
    onExpired: () => submitAttempt(true),
    announcements: {
      fiveMinutes: t('warningFiveMinutes'),
      oneMinute: t('warningOneMinute'),
      expired: t('timeExpired'),
    },
  });
  const timeExpired = remainingSeconds === 0 && timerAnnouncement === t('timeExpired');

  useEffect(() => {
    const target = focusTargetRef.current;
    if (!target || !current || !currentSectionId) return;
    focusTargetRef.current = null;
    if (target === 'section') sectionHeadingRefs.current.get(currentSectionId)?.focus();
    else questionHeadingRefs.current.get(current.question.id)?.focus();
  }, [current, currentSectionId]);

  useEffect(() => {
    if (paletteOpen) {
      const palette = palettePanelRef.current;
      (palette?.querySelector<HTMLButtonElement>('nav button[aria-current="page"]')
        ?? palette?.querySelector<HTMLButtonElement>('nav button:not([aria-disabled="true"])'))?.focus();
    }
  }, [paletteOpen]);

  // Leaving an active attempt (Back, the outline, the pager) asks first: answers are kept but the
  // timer keeps running. Submitting or a terminal transition leaves without asking.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDecision = useRef<((leave: boolean) => void) | null>(null);
  const decideLeave = useCallback((leave: boolean) => {
    const resolve = leaveDecision.current;
    leaveDecision.current = null;
    setLeaveOpen(false);
    resolve?.(leave);
  }, []);
  useEffect(() => {
    const remove = registerNavigationGuard(() => {
      if (submittingRef.current || terminalTransitionRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        leaveDecision.current?.(false);
        leaveDecision.current = resolve;
        setLeaveOpen(true);
      });
    });
    return () => {
      remove();
      leaveDecision.current?.(false);
      leaveDecision.current = null;
    };
  }, []);

  const toggleFlag = (questionId: string) => {
    setFlagged((previous) => {
      const next = new Set(previous);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  if (!current || !currentSection) return null;

  const firstQuestionInSection = (sectionIndex: number) =>
    entries.findIndex((entry) => entry.sectionIndex === sectionIndex);
  const isSinglePage = exam.settings.layout === 'single_page';
  const isSectionPage = exam.settings.layout === 'section_per_page';
  const atStart = isSectionPage ? currentSectionIndex === 0 : currentIndex === 0;
  const atEnd = isSectionPage
    ? currentSectionIndex === exam.sections.length - 1
    : currentIndex === entries.length - 1;
  const navigateTo = (index: number) => {
    const bounded = Math.max(0, Math.min(entries.length - 1, index));
    setPaletteOpen(false);
    const focusTarget = entries[bounded]?.sectionIndex === currentSectionIndex
      ? 'question'
      : 'section';
    if (bounded === currentIndex) {
      focusTargetRef.current = null;
      if (focusTarget === 'section') sectionHeadingRefs.current.get(currentSectionId)?.focus();
      else questionHeadingRefs.current.get(current.question.id)?.focus();
      return;
    }
    focusTargetRef.current = focusTarget;
    setCurrentIndex(bounded);
  };
  const move = (direction: -1 | 1) => {
    if (isSectionPage) {
      const index = firstQuestionInSection(currentSectionIndex + direction);
      if (index >= 0) navigateTo(index);
      return;
    }
    navigateTo(currentIndex + direction);
  };

  const renderQuestion = (entry: (typeof entries)[number]) => {
    const index = entries.indexOf(entry);
    const { question } = entry;
    const sectionClosed = closedGroups.has(answerGroups[question.id]);
    return (
      <div key={question.id} className="min-w-0 space-y-4" data-exam-question={question.id}>
        <QuestionTitle
          ref={(node) => {
            if (node) questionHeadingRefs.current.set(question.id, node);
            else questionHeadingRefs.current.delete(question.id);
          }}
          className="sr-only"
          tabIndex={-1}
        >
          {t('questionHeading', { number: index + 1 })}
        </QuestionTitle>
        <QuestionRenderer
          question={question}
          index={index}
          value={answers[question.id]}
          onChange={(value) => {
            if (submittingRef.current || timeExpired) return;
            setSectionSubmitPending(false);
            setCurrentIndex(index);
            const next = { ...answersRef.current, [question.id]: value };
            answersRef.current = next;
            setAnswers(next);
            markDirty();
            setAnswerRevision((revision) => revision + 1);
          }}
          disabled={submitting || timeExpired || sectionClosed}
          runtime={runtime}
          // The question sits inside the exam card, so its frame renders flat (cards do not nest).
          depth={1}
        />
        <button
          type="button"
          className="vf-btn vf-btn-lg w-full min-[760px]:w-auto"
          // The label names the action (Flag / Remove flag), so no aria-pressed to contradict it.
          disabled={submitting || timeExpired || sectionClosed}
          onClick={() => toggleFlag(question.id)}
        >
          {flagged.has(question.id)
            ? t('unflagQuestion', { number: index + 1 })
            : t('flagQuestion', { number: index + 1 })}
        </button>
      </div>
    );
  };
  const timerText = attempt.deadlineAt && remainingSeconds !== null
    ? formatDuration(remainingSeconds)
    : t('noDeadline');

  return (
    <article
      ref={containerRef}
      // In the activity frame the palette, timer and save state sit in the 280px aside from 1100px.
      className={hideTitle
        ? 'vf-l-split vf-exam-split min-w-0 pb-40 min-[1100px]:pb-0'
        : 'mx-auto grid max-w-6xl min-w-0 gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_18rem]'}
      data-aside={hideTitle ? '' : undefined}
    >
      <section
        aria-labelledby={hideTitle ? undefined : 'exam-player-title'}
        aria-label={hideTitle ? exam.title : undefined}
        data-area={hideTitle ? 'main' : undefined}
        className={hideTitle
          ? 'min-w-0 rounded-[8px] border border-border bg-card p-4 min-[760px]:p-6'
          : 'min-w-0 rounded-xl border border-border bg-card p-6 shadow-sm'}
      >
        {!hideTitle ? (
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <Title id="exam-player-title" className="text-xl font-semibold leading-snug">{exam.title}</Title>
            <div role="timer" aria-label={t('timerLabel')} className="font-mono text-lg font-semibold tabular-nums">
              {timerText}
            </div>
          </header>
        ) : null}
        <p className="sr-only" aria-live="polite" aria-atomic="true">{timerAnnouncement}</p>
        {fullscreenRetry ? (
          <div className="mb-5 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground" role="alert">
            <p>{t('fullscreenRequired')}</p>
            <button type="button" className="vf-btn vf-btn-lg mt-2" onClick={() => void requestFullscreen()}>{t('enterFullscreen')}</button>
          </div>
        ) : null}
        {closedGroups.size > 0 ? (
          <div className="mb-5 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground" role="alert">
            <p>{t('sectionClosed')}</p>
            {sectionSubmitPending ? (
              <button type="button" className="vf-btn vf-btn-lg mt-3 w-full min-[760px]:w-auto" disabled={submitting} onClick={() => void submitAttempt(false, true)}>
                {t('submitSaved')}
              </button>
            ) : null}
          </div>
        ) : null}
        {recoveryUnavailable ? <p className="mb-5 text-sm text-destructive" role="alert">{t('recoveryUnavailable')}</p> : null}
        {exam.settings.layout === 'one_per_page' ? (
          <section aria-labelledby={`exam-section-${currentSection?.id}`} className="space-y-5">
            <SectionTitle
              ref={(node) => {
                if (node) sectionHeadingRefs.current.set(currentSection.id, node);
                else sectionHeadingRefs.current.delete(currentSection.id);
              }}
              id={`exam-section-${currentSection.id}`}
              className="text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              tabIndex={-1}
            >
              {currentSection?.title}
            </SectionTitle>
            {currentSection.instructions ? (
              <RenderScope ownerLevel={sectionLevel} blocks={currentSection.instructions.blocks}>
                <RichContentView
                  content={currentSection.instructions}
                  runtime={runtime}
                  path={`/exam/sections/${currentSection.id}/instructions`}
                  depth={1}
                />
              </RenderScope>
            ) : null}
            {renderQuestion(current)}
          </section>
        ) : (
          <div className="space-y-8">
            {(isSinglePage ? exam.sections.map((_, index) => index) : [currentSectionIndex]).map((sectionIndex) => {
              const section = exam.sections[sectionIndex];
              return (
                <section key={section.id} aria-labelledby={`exam-section-${section.id}`} className="space-y-5">
                  <SectionTitle
                    ref={(node) => {
                      if (node) sectionHeadingRefs.current.set(section.id, node);
                      else sectionHeadingRefs.current.delete(section.id);
                    }}
                    id={`exam-section-${section.id}`}
                    className="text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    tabIndex={-1}
                  >
                    {section.title}
                  </SectionTitle>
                  {section.instructions ? (
                    <RenderScope ownerLevel={sectionLevel} blocks={section.instructions.blocks}>
                      <RichContentView
                        content={section.instructions}
                        runtime={runtime}
                        path={`/exam/sections/${section.id}/instructions`}
                        depth={1}
                      />
                    </RenderScope>
                  ) : null}
                  {displayedEntries
                    .filter((entry) => entry.sectionIndex === sectionIndex)
                    .map(renderQuestion)}
                </section>
              );
            })}
          </div>
        )}
        {!isSinglePage ? (
          <footer className="mt-6 flex flex-col gap-3 border-t border-border pt-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
            <span className="text-sm text-muted-foreground">
              {isSectionPage
                ? t('sectionProgress', { current: currentSectionIndex + 1, total: exam.sections.length })
                : t('questionProgress', { current: currentIndex + 1, total: questions.length })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="vf-btn vf-btn-lg min-w-0 flex-1 min-[760px]:flex-none"
                disabled={submitting || timeExpired || atStart || exam.settings.navigation === 'sequential'}
                onClick={() => move(-1)}
              >
                {t('previous')}
              </button>
              <button type="button" className="vf-btn vf-btn-lg min-w-0 flex-1 min-[760px]:flex-none" disabled={submitting || timeExpired || atEnd} onClick={() => move(1)}>
                {t('next')}
              </button>
            </div>
          </footer>
        ) : null}
        {submitError ? <p className="mt-4 text-sm text-destructive" role="alert">{t('submitError')}</p> : null}
      </section>

      <aside
        data-area={hideTitle ? 'aside' : undefined}
        className={hideTitle
          ? 'fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 min-[1100px]:static min-[1100px]:inset-auto min-[1100px]:max-h-none min-[1100px]:overflow-visible min-[1100px]:rounded-[8px] min-[1100px]:border min-[1100px]:p-4'
          : ''}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && paletteOpen && !submitDialogOpen) {
            setPaletteOpen(false);
            paletteToggleRef.current?.focus();
          }
        }}
      >
        <div
          id="exam-question-palette"
          ref={palettePanelRef}
          className={hideTitle
            ? `${paletteOpen ? 'block' : 'hidden'} mb-3 max-h-[48dvh] overflow-y-auto border-b border-border pb-3 min-[1100px]:mb-4 min-[1100px]:block min-[1100px]:max-h-none min-[1100px]:overflow-visible min-[1100px]:border-0 min-[1100px]:pb-0`
            : 'mb-3 rounded-xl border border-border bg-card p-4'}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t('palette')}</h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t('answeredProgress', { answered: questions.length - unansweredCount, total: questions.length })}
            </span>
          </div>
          <ExamPalette
            answers={answers}
            currentIndex={currentIndex}
            currentSectionIndex={currentSectionIndex}
            entries={entries}
            flagged={flagged}
            labels={{
              navigation: t('palette'),
              answered: t('answered'),
              unanswered: t('unanswered'),
              flagged: t('flagged'),
              notFlagged: t('notFlagged'),
              question: (number, answerState, flagState) => t('paletteQuestion', {
                number,
                answerState,
                flagState,
              }),
            }}
            layout={exam.settings.layout}
            navigation={exam.settings.navigation}
            onNavigate={navigateTo}
            submitting={submitting || timeExpired}
          />
        </div>
        <div role="group" aria-label={t('actions')} className="space-y-2">
          <div className="flex min-w-0 items-center justify-between gap-3">
            {hideTitle ? (
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t('timerLabel')}</p>
                <div role="timer" aria-label={t('timerLabel')} className="min-w-0 font-mono text-sm font-semibold tabular-nums min-[760px]:text-base">
                  {timerText}
                </div>
              </div>
            ) : null}
            <p className={`min-w-0 text-right text-xs ${saveStatus === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`} role="status" aria-live="polite">
              {t(saveStatus === 'saved'
                ? 'saveSaved'
                : saveStatus === 'saving'
                  ? 'saveSaving'
                  : saveStatus === 'retrying' ? 'saveRetrying' : 'saveFailed')}
            </p>
          </div>
          {saveStatus === 'failed' && !timeExpired && closedGroups.size === 0 ? (
            <button type="button" className="vf-btn vf-btn-lg w-full" disabled={submitting} onClick={() => void retryNow()}>
              {t('retrySave')}
            </button>
          ) : null}
          {submitting ? <p className="text-sm text-muted-foreground" aria-live="polite">{t('submitting')}</p> : null}
          <div className="flex gap-2">
            {hideTitle ? (
              <button
                ref={paletteToggleRef}
                className="vf-btn vf-btn-lg vf-exam-palette-toggle min-w-0 flex-1"
                type="button"
                aria-controls="exam-question-palette"
                aria-expanded={paletteOpen}
                disabled={submitting}
                onClick={() => setPaletteOpen((open) => !open)}
              >
                {t('questionsButton')}
              </button>
            ) : null}
            <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
              <DialogTrigger asChild>
                <button type="button" className="vf-btn vf-btn-primary vf-btn-lg min-w-0 flex-1 min-[1100px]:w-full" disabled={submitting || timeExpired}>{t('submit')}</button>
              </DialogTrigger>
              <DialogPortal container={containerRef.current}>
                <DialogOverlay className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
                <DialogContent className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-foreground focus:outline-none min-[760px]:p-6">
                  <DialogTitle className="text-xl font-semibold">{t('dialogTitle')}</DialogTitle>
                  <DialogDescription className="mt-2 text-sm text-muted-foreground">
                    {t('dialogDescription', { count: unansweredCount })}
                  </DialogDescription>
                  <div className="mt-6 flex flex-col-reverse gap-2 min-[760px]:flex-row min-[760px]:justify-end">
                    <DialogClose asChild>
                      <button type="button" className="vf-btn vf-btn-lg" disabled={submitting}>
                        {t('cancel')}
                      </button>
                    </DialogClose>
                    <button type="button" className="vf-btn vf-btn-primary vf-btn-lg" disabled={submitting} onClick={() => void submitAttempt()}>
                      {submitting ? t('submitting') : t('confirm')}
                    </button>
                  </div>
                </DialogContent>
              </DialogPortal>
            </Dialog>
          </div>
          {timeExpired && submitError ? (
            <button type="button" className="vf-btn vf-btn-primary vf-btn-lg w-full" disabled={submitting} onClick={() => void submitAttempt(true)}>
              {submitting ? t('submitting') : t('retrySubmit')}
            </button>
          ) : null}
        </div>
      </aside>
      <Dialog open={leaveOpen} onOpenChange={(open) => { if (!open) decideLeave(false); }}>
        <DialogPortal container={containerRef.current}>
          <DialogOverlay className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
          <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-[8px] border border-border border-l-2 border-l-warning-border bg-card p-6 text-foreground focus:outline-none">
            <DialogTitle className="text-xl font-medium">{t('leaveTitle')}</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">{t('leaveBody')}</DialogDescription>
            <div className="mt-2 flex flex-col gap-2 min-[760px]:flex-row-reverse">
              <button type="button" className="vf-btn vf-btn-primary vf-btn-lg" onClick={() => decideLeave(false)}>{t('stay')}</button>
              <button type="button" className="vf-btn vf-btn-lg" onClick={() => decideLeave(true)}>{t('leave')}</button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </article>
  );
}
