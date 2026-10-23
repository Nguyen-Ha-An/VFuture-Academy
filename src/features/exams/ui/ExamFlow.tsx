'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { ExamReviewResult, ExamStartResult } from '../service';
import type { ExamClient } from './client';
import { examAvailability, ExamIntro } from './ExamIntro';
import { ExamPlayer } from './ExamPlayer';
import { createPendingExamDraftStore } from './pending-draft';
import { ExamReview } from './ExamReview';
import { examSections, type LearnerExam } from './types';

type Phase = 'restoring' | 'restore_error' | 'intro' | 'player' | 'reviewing' | 'review' | 'review_error';

export interface ExamFlowProps {
  exam: LearnerExam;
  attemptsUsed: number;
  client: ExamClient;
  runtime: LessonRuntime;
  headingLevel?: 1 | 2;
  hideTitle?: boolean;
}

export function ExamFlow({ exam, attemptsUsed: initialAttemptsUsed, client, runtime, headingLevel = 1, hideTitle = false }: ExamFlowProps) {
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
  const reviewingRef = useRef(false);
  const startingRef = useRef(false);

  const bindAttempt = useCallback((result: ExamStartResult) => {
    const restoredExam: LearnerExam = { ...exam, sections: examSections(result.learner) };
    setAttempt(result);
    setActiveExam(restoredExam);
    setAttemptsUsed((used) => Math.max(used, result.attemptNo));
    return restoredExam;
  }, [exam]);

  const loadReview = useCallback(async () => {
    if (reviewingRef.current) return;
    reviewingRef.current = true;
    setPhase('reviewing');
    try {
      const result = await client.review();
      setReview(result);
      setPhase('review');
    } catch {
      setPhase('review_error');
    } finally {
      reviewingRef.current = false;
    }
  }, [client]);

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
        setAttempt(null);
        setActiveExam(exam);
        setPhase('intro');
        return;
      }
      bindAttempt(session.attempt);
      if (session.attempt.status === 'in_progress') {
        setPhase('player');
      } else {
        setAvailabilityNow(await client.serverNow());
        createPendingExamDraftStore(session.attempt.attemptId).clear();
        await loadReview();
      }
    } catch {
      setPhase('restore_error');
    } finally {
      restoringRef.current = false;
    }
  }, [bindAttempt, client, exam, loadReview]);

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
        createPendingExamDraftStore(result.attemptId).clear();
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
    return (
      <ExamPlayer
        exam={activeExam}
        attempt={attempt}
        client={client}
        runtime={runtime}
        onSubmitted={loadReview}
        onTerminal={restore}
        headingLevel={headingLevel}
        hideTitle={hideTitle}
      />
    );
  }

  if (phase === 'review' && review) {
    const canStartNext = attemptsUsed < exam.settings.attemptsAllowed
      && examAvailability(exam, availabilityNow) === 'open';
    return (
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
    return <p className="py-6 text-muted-foreground" role="status">{t('restoring')}</p>;
  }

  if (phase === 'restore_error') {
    return (
      <div className="grid justify-items-start gap-4 rounded-[8px] border border-border border-l-2 border-l-destructive bg-card p-6">
        <p className="m-0" role="alert">{t('restoreError')}</p>
        <button type="button" className="vf-btn vf-btn-lg" onClick={() => void restore()}>{t('retryRestore')}</button>
      </div>
    );
  }

  if (phase === 'reviewing') {
    return <p className="py-6 text-muted-foreground" role="status">{t('loadingReview')}</p>;
  }

  if (phase === 'review_error') {
    return (
      <div className="grid justify-items-start gap-4 rounded-[8px] border border-border border-l-2 border-l-destructive bg-card p-6">
        <p className="m-0" role="alert">{t('reviewError')}</p>
        <button type="button" className="vf-btn vf-btn-lg" onClick={() => void loadReview()}>{t('retryReview')}</button>
      </div>
    );
  }

  return (
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
