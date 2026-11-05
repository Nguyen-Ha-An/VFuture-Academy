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
import { useAutosave, type TerminalResolution } from './useAutosave';
import { useExamTimer } from './useExamTimer';
import { useIntegrityLog } from './useIntegrityLog';
import { registerNavigationGuard, type NavigationIntent } from '@/lib/navigation-guard';
import { useActivityLock } from '@/features/workspace-ui/learner/activity/ActivityProgress';
import { differingOwnAnswers, isTerminalExamStatus, type ExamAnswerRecovery } from './answer-recovery';
import { canonicalAnswers } from '@/features/learning/answer-canonical';
import { OwnAnswerDownload } from './ExamAnswerRecoveryNotice';
import { examUploadRuntime } from './exam-upload-runtime';

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
  onRecoverySnapshot?: (recovery: ExamAnswerRecovery) => void;
  hasUnavailableRecovery?: boolean;
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

function ExamPlayerContent({ exam, attempt, client, runtime, onSubmitted, onTerminal, onRecoverySnapshot, hasUnavailableRecovery = false, draftStore: providedDraftStore, headingLevel = 1, hideTitle = false }: ExamPlayerProps) {
  const t = useTranslations('exam.player');
  const flow = useTranslations('exam.flow');
  const recoveryCopy = useTranslations('exam.recovery');
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
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [reviewTransitionError, setReviewTransitionError] = useState(false);
  const confirmedResultRef = useRef<ExamSubmitResult | null>(null);
  const [submitOutcomeUnknown, setSubmitOutcomeUnknown] = useState(false);
  const unknownOutcomeRef = useRef(false);
  const incompleteSubmissionRef = useRef(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const pendingUploadsRef = useRef(0);
  const [terminalUnconfirmed, setTerminalUnconfirmed] = useState(false);
  const [checkingTerminal, setCheckingTerminal] = useState(false);
  const deadlineExpiredRef = useRef(false);
  const activePlayerRef = useRef(true);
  const unavailableRecoveryRef = useRef(false);
  const approvedDocument = useRef<AbortSignal | null>(null);
  const pendingLeaveIntent = useRef<NavigationIntent | undefined>(undefined);
  useEffect(() => {
    activePlayerRef.current = true;
    return () => { activePlayerRef.current = false; };
  }, []);
  const onUploadPendingChange = useCallback((delta: 1 | -1) => {
    pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current + delta);
    if (activePlayerRef.current) setPendingUploads(pendingUploadsRef.current);
  }, []);
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
  const handleAutosaveTerminal = useCallback(async (): Promise<TerminalResolution> => {
    if (!activePlayerRef.current) return { confirmed: false };
    submittingRef.current = true;
    setSubmitting(true);
    setCheckingTerminal(true);
    setSubmitError(false);
    setReviewTransitionError(false);
    try {
      const session = await client.session({ bind: false });
      if (!activePlayerRef.current) return { confirmed: false };
      const observed = session.attempt;
      if (!observed || observed.attemptId !== attempt.attemptId || !isTerminalExamStatus(observed.status)) {
        terminalTransitionRef.current = false;
        submittingRef.current = false;
        setSubmitting(false);
        setSubmitDialogOpen(unknownOutcomeRef.current);
        setTerminalUnconfirmed(true);
        resumeIntegrity();
        return { confirmed: false };
      }
      const own = differingOwnAnswers(answersRef.current, observed.answers);
      const preserveRecovery = Object.keys(own).length > 0;
      if (preserveRecovery) {
        const retained = draftStore.write(own);
        onRecoverySnapshot?.({ attemptId: attempt.attemptId, attemptNo: attempt.attemptNo, answers: own, verified: true, storageUnavailable: !retained });
      } else draftStore.clear();
      terminalTransitionRef.current = true;
      unknownOutcomeRef.current = false;
      setSubmitOutcomeUnknown(false);
      setSubmissionConfirmed(true);
      setTerminalUnconfirmed(false);
      setSubmitDialogOpen(false);
      try { await onTerminal?.(); } catch { setReviewTransitionError(true); }
      return { confirmed: true, preserveRecovery };
    } catch {
      if (!activePlayerRef.current) return { confirmed: false };
      terminalTransitionRef.current = false;
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitDialogOpen(unknownOutcomeRef.current);
      setTerminalUnconfirmed(true);
      resumeIntegrity();
      return { confirmed: false };
    } finally { if (activePlayerRef.current) setCheckingTerminal(false); }
  }, [attempt.attemptId, attempt.attemptNo, client, draftStore, onRecoverySnapshot, onTerminal, resumeIntegrity]);
  const {
    closedGroups,
    markDirty,
    markSubmitted,
    lastSaveErrorCode,
    oversizedQuestionId,
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

  const answerTooLarge = lastSaveErrorCode() === 'ANSWER_TOO_LARGE';
  const oversizedIndex = entries.findIndex(entry => entry.question.id === oversizedQuestionId);
  const sizeError = oversizedIndex >= 0 ? t('answerTooLarge', { number: oversizedIndex + 1 }) : t('answerTooLargeGeneric');
  const oversizedGroup = oversizedIndex >= 0 && entries[oversizedIndex].question.type === 'question_group';
  const recoveryAtRisk = recoveryUnavailable || hasUnavailableRecovery;
  const ownRecoveryCopy = useCallback((): ExamAnswerRecovery => ({
    attemptId: attempt.attemptId, attemptNo: attempt.attemptNo,
    answers: canonicalAnswers(answersRef.current), verified: false, storageUnavailable: true,
  }), [attempt.attemptId, attempt.attemptNo]);
  useEffect(() => { unavailableRecoveryRef.current = recoveryAtRisk; }, [recoveryAtRisk]);
  useEffect(() => {
    // The hook sets this only when unacknowledged responses could not be journaled.
    if (!recoveryAtRisk) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (approvedDocument.current && !approvedDocument.current.aborted) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [recoveryAtRisk]);

  const loadConfirmedReview = useCallback(async () => {
    const result = confirmedResultRef.current;
    if (!result) return;
    setReviewTransitionError(false);
    try { await onSubmitted(result); } catch { setReviewTransitionError(true); }
  }, [onSubmitted]);

  const submitAttempt = useCallback(async (expired = false, acceptedOnly = false) => {
    if (expired) deadlineExpiredRef.current = true;
    if (submittingRef.current) return;
    const reconciling = unknownOutcomeRef.current;
    if (!expired && !reconciling && pendingUploadsRef.current > 0) return;
    if (!expired && !acceptedOnly && !reconciling && lastSaveErrorCode() === 'ANSWER_TOO_LARGE') return;
    if (expired && !reconciling && (pendingUploadsRef.current > 0 || lastSaveErrorCode() === 'ANSWER_TOO_LARGE')) {
      await handleAutosaveTerminal();
      return;
    }
    let incompleteFlush = acceptedOnly;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(false);
    setSectionSubmitPending(false);
    try {
      if (!acceptedOnly && !reconciling) {
        const saved = await persistAnswers();
        if (!saved) {
          if (terminalTransitionRef.current) return;
          if (lastSaveErrorCode() === 'DEADLINE_PASSED' || lastSaveErrorCode() === 'ATTEMPT_NOT_ACTIVE') return;
          if (expired && lastSaveErrorCode() === 'ANSWER_TOO_LARGE') {
            await handleAutosaveTerminal();
            return;
          }
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
          incompleteFlush = true;
        }
      }
      if (!reconciling) await flushBeforeSubmit();
      if (!reconciling) incompleteSubmissionRef.current = incompleteFlush;
      const result = await client.submit();
      if (!activePlayerRef.current) return;
      if (result.attemptId !== attempt.attemptId || !['graded', 'pending_manual'].includes(result.status)) {
        throw Object.assign(new Error('The server did not confirm this attempt submission.'), { code: 'SUBMIT_OUTCOME_UNKNOWN', ambiguous: true });
      }
      unknownOutcomeRef.current = false;
      setSubmitOutcomeUnknown(false);
      setTerminalUnconfirmed(false);
      if (incompleteSubmissionRef.current) {
        onRecoverySnapshot?.({ attemptId: attempt.attemptId, attemptNo: attempt.attemptNo, answers: canonicalAnswers(answersRef.current), verified: false, storageUnavailable: recoveryUnavailable });
      }
      markSubmitted({ preserveRecovery: incompleteSubmissionRef.current });
      confirmedResultRef.current = result;
      terminalTransitionRef.current = true;
      setSubmissionConfirmed(true);
      setSubmitDialogOpen(false);
      await loadConfirmedReview();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (code === 'ATTEMPT_NOT_ACTIVE' || code === 'DEADLINE_PASSED') {
        await handleAutosaveTerminal();
        return;
      }
      const unknown = code === 'SUBMIT_OUTCOME_UNKNOWN'
        || (typeof error === 'object' && error !== null && 'ambiguous' in error && error.ambiguous === true);
      unknownOutcomeRef.current = unknown;
      setSubmitOutcomeUnknown(unknown);
      setSubmitError(!unknown);
      if (unknown) setSubmitDialogOpen(true);
      submittingRef.current = false;
      setSubmitting(false);
      if (!unknown) resumeIntegrity();
    }
  }, [attempt.attemptId, attempt.attemptNo, client, flushBeforeSubmit, handleAutosaveTerminal, lastSaveErrorCode, loadConfirmedReview, markSubmitted, onRecoverySnapshot, persistAnswers, recoveryUnavailable, resumeIntegrity]);

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
  const closingLeaveDecision = useRef<boolean | null>(null);
  const decideLeave = useCallback((leave: boolean) => {
    closingLeaveDecision.current = leave;
    setLeaveOpen(false);
  }, []);
  const finishLeaveClose = useCallback(() => {
    const leave = closingLeaveDecision.current;
    if (leave === null) return;
    closingLeaveDecision.current = null;
    const resolve = leaveDecision.current;
    leaveDecision.current = null;
    const intent = pendingLeaveIntent.current;
    pendingLeaveIntent.current = undefined;
    if (leave && intent?.kind === 'document' && !intent.signal.aborted) approvedDocument.current = intent.signal;
    resolve?.(leave);
  }, []);
  useEffect(() => {
    const remove = registerNavigationGuard((intent) => {
      if (terminalTransitionRef.current && !unavailableRecoveryRef.current) return Promise.resolve(true);
      if (!terminalTransitionRef.current && (submittingRef.current || unknownOutcomeRef.current)) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        leaveDecision.current?.(false);
        leaveDecision.current = resolve;
        pendingLeaveIntent.current = intent;
        setLeaveOpen(true);
      });
    });
    return () => {
      remove();
      leaveDecision.current?.(false);
      leaveDecision.current = null;
      closingLeaveDecision.current = null;
      pendingLeaveIntent.current = undefined;
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
            // The rendered inputs enforce the deadline. A server-accepted upload may still
            // resolve during reconciliation; ignore it only after confirmed terminal state.
            if (!activePlayerRef.current || terminalTransitionRef.current || unknownOutcomeRef.current || (submittingRef.current && !deadlineExpiredRef.current)) return;
            approvedDocument.current = null;
            if (!deadlineExpiredRef.current) setTerminalUnconfirmed(false);
            setSectionSubmitPending(false);
            setCurrentIndex(index);
            const next = { ...answersRef.current, [question.id]: value };
            answersRef.current = next;
            setAnswers(next);
            markDirty();
            setAnswerRevision((revision) => revision + 1);
          }}
          disabled={submitting || submitOutcomeUnknown || timeExpired || sectionClosed}
          runtime={examUploadRuntime(runtime, { attemptId: attempt.attemptId, rootQuestionId: question.id, onPendingChange: onUploadPendingChange })}
          // The question sits inside the exam card, so its frame renders flat (cards do not nest).
          depth={1}
        />
        <button
          type="button"
          className="vf-btn vf-btn-lg w-full min-[760px]:w-auto"
          // The label names the action (Flag / Remove flag), so no aria-pressed to contradict it.
          disabled={submitting || submitOutcomeUnknown || timeExpired || sectionClosed}
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
            <Title tabIndex={headingLevel === 1 ? -1 : undefined} id="exam-player-title" className="text-xl font-semibold leading-snug">{exam.title}</Title>
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
        {recoveryUnavailable ? <div className="mb-5 grid justify-items-start gap-3"><p className="text-sm text-destructive" role="alert">{t('recoveryUnavailable')}</p><OwnAnswerDownload getRecovery={ownRecoveryCopy} label={recoveryCopy('download', { attempt: attempt.attemptNo })} /></div> : null}
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
                disabled={submitting || submitOutcomeUnknown || timeExpired || atStart || exam.settings.navigation === 'sequential'}
                onClick={() => move(-1)}
              >
                {t('previous')}
              </button>
              <button type="button" className="vf-btn vf-btn-lg min-w-0 flex-1 min-[760px]:flex-none" disabled={submitting || submitOutcomeUnknown || timeExpired || atEnd} onClick={() => move(1)}>
                {t('next')}
              </button>
            </div>
          </footer>
        ) : null}
        {submitError && !submitDialogOpen && !answerTooLarge ? <p className="mt-4 text-sm text-destructive" role="alert">{t('submitError')}</p> : null}
        {reviewTransitionError ? <div className="mt-4 grid justify-items-start gap-3">
          <p className="text-sm text-destructive" role="alert">{flow('reviewError')}</p>
          <button type="button" className="vf-btn vf-btn-lg" onClick={() => void (confirmedResultRef.current ? loadConfirmedReview() : handleAutosaveTerminal())}>{flow('retryReview')}</button>
        </div> : null}
        {terminalUnconfirmed ? <div className="mt-4 grid justify-items-start gap-3">
          <p className="text-sm text-muted-foreground" role="alert">{t('terminalUnconfirmed')}</p>
          <button type="button" className="vf-btn vf-btn-lg" disabled={checkingTerminal || submitting} onClick={() => void handleAutosaveTerminal()}>{t('checkAttemptStatus')}</button>
          {timeExpired && pendingUploads === 0 && !answerTooLarge ? <button type="button" className="vf-btn vf-btn-lg" disabled={submitting} onClick={() => void submitAttempt(true)}>{t('retrySubmit')}</button> : null}
        </div> : null}
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
            submitting={submitting || submitOutcomeUnknown || timeExpired}
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
            <button type="button" className="vf-btn vf-btn-lg w-full" disabled={submitting || submitOutcomeUnknown || answerTooLarge} onClick={() => void retryNow()}>
              {t('retrySave')}
            </button>
          ) : null}
          {answerTooLarge && !submitDialogOpen ? <p className="text-sm text-destructive" role="alert">{sizeError}{oversizedGroup ? ` ${t('groupAnswerSizeLimit')}` : ''}</p> : null}
          {submitting && !submitDialogOpen && !reviewTransitionError ? <p className="text-sm text-muted-foreground" aria-live="polite">{checkingTerminal ? t('checkingAttemptStatus') : submissionConfirmed ? flow('loadingReview') : t('submitting')}</p> : null}
          {pendingUploads > 0 ? <p className="text-sm text-muted-foreground" role="status">{t('waitForUploads')}</p> : null}
          <div className="flex gap-2">
            {hideTitle ? (
              <button
                ref={paletteToggleRef}
                className="vf-btn vf-btn-lg vf-exam-palette-toggle min-w-0 flex-1"
                type="button"
                aria-controls="exam-question-palette"
                aria-expanded={paletteOpen}
                disabled={submitting || submitOutcomeUnknown}
                onClick={() => setPaletteOpen((open) => !open)}
              >
                {t('questionsButton')}
              </button>
            ) : null}
            <Dialog open={submitDialogOpen} onOpenChange={(open) => {
              if (!submittingRef.current && !unknownOutcomeRef.current) setSubmitDialogOpen(open);
            }}>
              <DialogTrigger asChild>
                <button type="button" className="vf-btn vf-btn-primary vf-btn-lg min-w-0 flex-1 min-[1100px]:w-full" disabled={submitting || timeExpired || pendingUploads > 0 || answerTooLarge}>{t('submit')}</button>
              </DialogTrigger>
              <DialogPortal container={containerRef.current}>
                <DialogOverlay className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
                <DialogContent aria-busy={submitting}
                  onEscapeKeyDown={(event) => { if (submittingRef.current || unknownOutcomeRef.current) event.preventDefault(); }}
                  onInteractOutside={(event) => { if (submittingRef.current || unknownOutcomeRef.current) event.preventDefault(); }}
                  className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-foreground focus:outline-none min-[760px]:p-6">
                  <DialogTitle className="text-xl font-semibold">{t('dialogTitle')}</DialogTitle>
                  <DialogDescription className="mt-2 text-sm text-muted-foreground">
                    {t('dialogDescription', { count: unansweredCount })}
                  </DialogDescription>
                  {submitError ? <p className="mt-4 text-sm text-destructive" role="alert">{answerTooLarge ? <>{sizeError}{oversizedGroup ? ` ${t('groupAnswerSizeLimit')}` : ''}</> : t('submitError')}</p> : null}
                  {submitOutcomeUnknown ? <p className="mt-4 text-sm text-muted-foreground" role="alert">{t('submissionUnknown')}</p> : null}
                  {submitting ? <p className="mt-4 text-sm text-muted-foreground" role="status">{t(submitOutcomeUnknown ? 'checkingSubmission' : 'submitting')}</p> : null}
                  <div className="mt-6 flex flex-col-reverse gap-2 min-[760px]:flex-row min-[760px]:justify-end">
                    <DialogClose asChild>
                      <button type="button" className="vf-btn vf-btn-lg" disabled={submitting || submitOutcomeUnknown}>
                        {t('cancel')}
                      </button>
                    </DialogClose>
                    <button type="button" className="vf-btn vf-btn-primary vf-btn-lg" disabled={submitting || (!submitOutcomeUnknown && (pendingUploads > 0 || answerTooLarge))} onClick={() => void submitAttempt()}>
                      {submitting ? t(submitOutcomeUnknown ? 'checkingSubmission' : 'submitting') : submitOutcomeUnknown ? t('checkSubmission') : submitError ? t('retrySubmit') : t('confirm')}
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
          <DialogContent onCloseAutoFocus={finishLeaveClose} className="fixed left-1/2 top-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-[8px] border border-border border-l-2 border-l-warning-border bg-card p-6 text-foreground focus:outline-none">
            <DialogTitle className="text-xl font-medium">{t('leaveTitle')}</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">{t(recoveryAtRisk ? 'leaveRecoveryUnavailable' : 'leaveBody')}</DialogDescription>
            {recoveryUnavailable ? <OwnAnswerDownload getRecovery={ownRecoveryCopy} label={recoveryCopy('download', { attempt: attempt.attemptNo })} /> : null}
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
