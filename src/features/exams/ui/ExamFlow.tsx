'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { ExamReviewResult, ExamStartResult } from '../service';
import type { ExamClient } from './client';
import { examAvailability, ExamIntro } from './ExamIntro';
import { ExamPlayer } from './ExamPlayer';
import { createPendingExamDraftStore } from './pending-draft';
import { ExamReview } from './ExamReview';
import { examSections, type LearnerExam } from './types';
import { differingOwnAnswers, isTerminalExamStatus, type ExamAnswerRecovery } from './answer-recovery';
import { ExamAnswerRecoveryNotice } from './ExamAnswerRecoveryNotice';

type Phase = 'restoring' | 'restore_error' | 'intro' | 'player' | 'reviewing' | 'review' | 'review_error';

export interface ExamFlowProps {
  exam: LearnerExam;
  attemptsUsed: number;
  client: ExamClient;
  runtime: LessonRuntime;
  headingLevel?: 1 | 2;
  hideTitle?: boolean;
  onConfirmedTerminal?: (review: ExamReviewResult) => void | Promise<void>;
  onConfirmedActive?: (attempt: ExamStartResult) => void | Promise<void>;
}

export function ExamFlow({ exam, attemptsUsed: initialAttemptsUsed, client, runtime, headingLevel = 1, hideTitle = false, onConfirmedTerminal, onConfirmedActive }: ExamFlowProps) {
  const t = useTranslations('exam.flow');
  const [phase, setPhase] = useState<Phase>('restoring');
  const [attemptsUsed, setAttemptsUsed] = useState(initialAttemptsUsed);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ExamStartResult | null>(null);
  const [activeExam, setActiveExam] = useState(exam);
  const [review, setReview] = useState<ExamReviewResult | null>(null);
  const [availabilityNow, setAvailabilityNow] = useState<Date | null>(null);
  const restoringRef = useRef(false);
  const reviewingRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const confirmedAttempts = useRef(new Set<string>());
  const confirmedActiveAttempts = useRef(new Set<string>());
  const [recoveries, setRecoveries] = useState<ExamAnswerRecovery[]>([]);
  const recoveryAttempts = useRef(new Map<string, ExamAnswerRecovery>());
  const boundAttempt = useRef<ExamStartResult | null>(null);
  const rememberRecovery = useCallback((recovery: ExamAnswerRecovery) => {
    if (Object.keys(recovery.answers).length === 0) return;
    recoveryAttempts.current.set(recovery.attemptId, recovery);
    setRecoveries(previous => [...previous.filter(copy => copy.attemptId !== recovery.attemptId), recovery]);
  }, []);
  const retainTerminalRecovery = useCallback((terminal: Pick<ExamStartResult, 'attemptId' | 'attemptNo' | 'answers'>) => {
    // A live capture may be newer than the last valid journal (for example after quota failure).
    const candidate = recoveryAttempts.current.get(terminal.attemptId);
    if (candidate?.verified) return;
    const store = createPendingExamDraftStore(terminal.attemptId);
    const pending = candidate?.answers ?? store.read();
    const answers = pending ? differingOwnAnswers(pending, terminal.answers) : {};
    if (Object.keys(answers).length > 0) {
      rememberRecovery({ attemptId: terminal.attemptId, attemptNo: terminal.attemptNo, answers, verified: true, storageUnavailable: candidate?.storageUnavailable });
    } else {
      store.clear();
      recoveryAttempts.current.delete(terminal.attemptId);
      setRecoveries(previous => previous.filter(copy => copy.attemptId !== terminal.attemptId));
    }
  }, [rememberRecovery]);
  const withRecovery = (content: ReactNode) => <><ExamAnswerRecoveryNotice recoveries={recoveries} protectExit={phase !== 'player'} />{content}</>;

  const bindAttempt = useCallback((result: ExamStartResult) => {
    const restoredExam: LearnerExam = { ...exam, sections: examSections(result.learner) };
    boundAttempt.current = result;
    setAttempt(result);
    setActiveExam(restoredExam);
    setAttemptsUsed((used) => Math.max(used, result.attemptNo));
    if (result.status === 'in_progress' && !confirmedActiveAttempts.current.has(result.attemptId)) {
      confirmedActiveAttempts.current.add(result.attemptId);
      void Promise.resolve().then(() => onConfirmedActive?.(result)).catch(() => undefined);
    }
    return restoredExam;
  }, [exam, onConfirmedActive]);

  const loadReview = useCallback(async () => {
    const requestedAttempt = boundAttempt.current?.attemptId;
    if (!requestedAttempt || reviewingRef.current === requestedAttempt) return;
    reviewingRef.current = requestedAttempt;
    setPhase('reviewing');
    try {
      const result = await client.review();
      if (boundAttempt.current?.attemptId !== requestedAttempt) return;
      const active = boundAttempt.current;
      if (!active || result.attemptId !== active.attemptId || !isTerminalExamStatus(result.status)) throw new TypeError('The review does not match a terminal bound attempt.');
      retainTerminalRecovery({ attemptId: result.attemptId, attemptNo: active.attemptNo, answers: result.answers });
      const now = await client.serverNow();
      if (boundAttempt.current?.attemptId !== requestedAttempt) return;
      setAvailabilityNow(now);
      setReview(result);
      setPhase('review');
      if (!confirmedAttempts.current.has(result.attemptId)) {
        confirmedAttempts.current.add(result.attemptId);
        // A refresh failure must not turn a server-confirmed submission into a failed submit.
        void Promise.resolve().then(() => onConfirmedTerminal?.(result)).catch(() => undefined);
      }
    } catch {
      if (boundAttempt.current?.attemptId === requestedAttempt) setPhase('review_error');
    } finally {
      if (reviewingRef.current === requestedAttempt) reviewingRef.current = null;
    }
  }, [client, onConfirmedTerminal, retainTerminalRecovery]);

  const restore = useCallback(async () => {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setPhase('restoring');
    try {
      const session = await client.session();
      setAttemptsUsed(session.attemptsUsed);
      setReview(null);
      if (!session.attempt) {
        setAvailabilityNow(await client.serverNow());
        boundAttempt.current = null;
        setAttempt(null);
        setActiveExam(exam);
        setPhase('intro');
        return;
      }
      bindAttempt(session.attempt);
      if (session.attempt.status === 'in_progress') {
        setPhase('player');
      } else {
        if (!isTerminalExamStatus(session.attempt.status)) throw new TypeError('The exam session has an invalid status.');
        retainTerminalRecovery(session.attempt);
        await loadReview();
      }
    } catch {
      setPhase('restore_error');
    } finally {
      restoringRef.current = false;
    }
  }, [bindAttempt, client, exam, loadReview, retainTerminalRecovery]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const start = async () => {
    if (startingRef.current || attemptsUsed >= exam.settings.attemptsAllowed) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      const result = await client.start();
      bindAttempt(result);
      setReview(null);
      if (result.status === 'in_progress') setPhase('player');
      else {
        if (!isTerminalExamStatus(result.status)) throw new TypeError('The exam start has an invalid status.');
        retainTerminalRecovery(result);
        await loadReview();
      }
    } catch {
      setStartError(t('startError'));
      setPhase('intro');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  if (phase === 'player' && attempt) {
    return withRecovery(
      <ExamPlayer
        key={attempt.attemptId}
        exam={activeExam}
        attempt={attempt}
        client={client}
        runtime={runtime}
        onSubmitted={loadReview}
        onTerminal={restore}
        headingLevel={headingLevel}
        hideTitle={hideTitle}
        onRecoverySnapshot={rememberRecovery}
        hasUnavailableRecovery={recoveries.some(recovery => recovery.storageUnavailable)}
      />
    );
  }

  if (phase === 'review' && review) {
    const canStartNext = attemptsUsed < exam.settings.attemptsAllowed
      && examAvailability(exam, availabilityNow) === 'open';
    return withRecovery(
      <ExamReview
        exam={activeExam}
        review={review}
        runtime={runtime}
        onStartNext={canStartNext ? start : undefined}
        startingNext={starting}
        headingLevel={headingLevel}
        hideTitle={hideTitle}
      />
    );
  }

  if (phase === 'restoring') {
    return withRecovery(<p className="py-6 text-muted-foreground" role="status">{t('restoring')}</p>);
  }

  if (phase === 'restore_error') {
    return withRecovery(
      <div className="grid justify-items-start gap-4 rounded-[8px] border border-border border-l-2 border-l-destructive bg-card p-6">
        <p className="m-0" role="alert">{t('restoreError')}</p>
        <button type="button" className="vf-btn vf-btn-lg" onClick={() => void restore()}>{t('retryRestore')}</button>
      </div>
    );
  }

  if (phase === 'reviewing') {
    return withRecovery(<p className="py-6 text-muted-foreground" role="status">{t('loadingReview')}</p>);
  }

  if (phase === 'review_error') {
    return withRecovery(
      <div className="grid justify-items-start gap-4 rounded-[8px] border border-border border-l-2 border-l-destructive bg-card p-6">
        <p className="m-0" role="alert">{t('reviewError')}</p>
        <button type="button" className="vf-btn vf-btn-lg" onClick={() => void loadReview()}>{t('retryReview')}</button>
      </div>
    );
  }

  return withRecovery(
    <ExamIntro
      exam={exam}
      attemptsUsed={attemptsUsed}
      onStart={start}
      runtime={runtime}
      starting={starting}
      error={startError}
      now={availabilityNow}
      headingLevel={headingLevel}
      hideTitle={hideTitle}
    />
  );
}
