'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ExamRequestError, type ExamClient } from './client';
import { canonicalAnswers, sameCanonicalAnswer } from '@/features/learning/answer-canonical';
import type { PendingExamDraftStore } from './pending-draft';
import { answerBatches, ExamAnswerTooLargeError } from './answer-batches';

export type SaveStatus = 'saved' | 'saving' | 'retrying' | 'failed';
export type TerminalResolution = {confirmed:boolean;preserveRecovery?:boolean};

/** After n consecutive failures the automatic wait is random(0, min(30s, 1s * 2^(n - 1))). */
const AUTOSAVE_BACKOFF_BASE_MS = 1_000;
export const AUTOSAVE_MAX_BACKOFF_MS = 30_000;
/** A server Retry-After is honored, but never for longer than this. */
export const AUTOSAVE_MAX_RETRY_AFTER_MS = 120_000;

/**
 * How long automatic saves stay deferred after the `consecutiveFailures`-th failure:
 * full-jitter exponential backoff, raised to the server's Retry-After when it sent a usable
 * one. Explicit saves (retry button, pre-submit flush) ignore this and run at once.
 */
export function autosaveBackoffMs(
  consecutiveFailures: number,
  random: () => number,
  retryAfterMs?: number,
): number {
  const window = Math.min(
    AUTOSAVE_MAX_BACKOFF_MS,
    AUTOSAVE_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
  );
  const unit = Math.min(Math.max(random(), 0), 0.999999);
  const jittered = Math.floor(unit * window);
  const requested = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(retryAfterMs, AUTOSAVE_MAX_RETRY_AFTER_MS)
    : 0;
  return Math.max(jittered, requested);
}

interface UseAutosaveOptions {
  answerGroups: Record<string, string>;
  answersRef: RefObject<Record<string, unknown>>;
  client: Pick<ExamClient, 'save'>;
  draftStore: PendingExamDraftStore;
  initialAcceptedAnswers: Record<string, unknown>;
  onTerminal?: () => void | TerminalResolution | Promise<void | TerminalResolution>;
  /** Jitter source in [0, 1); injectable so tests are deterministic. */
  random?: () => number;
  revision: number;
  submittingRef: RefObject<boolean>;
}

function sameAnswer(left: unknown, right: unknown): boolean {
  try {
    return sameCanonicalAnswer(left,right);
  } catch {
    return false;
  }
}

function pendingAnswers(
  answers: Record<string, unknown>,
  accepted: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(answers).filter(([questionId, answer]) => (
    !Object.hasOwn(accepted, questionId) || !sameAnswer(answer, accepted[questionId])
  )));
}

function terminalSaveError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ATTEMPT_NOT_ACTIVE' || error.code === 'DEADLINE_PASSED';
}

function errorRetryAfterMs(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number'
    ? error.retryAfterMs
    : undefined;
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export function useAutosave({
  answerGroups,
  answersRef,
  client,
  draftStore,
  initialAcceptedAnswers,
  onTerminal,
  random = Math.random,
  revision,
  submittingRef,
}: UseAutosaveOptions) {
  const acceptedAnswersRef = useRef(structuredClone(initialAcceptedAnswers));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => (
    Object.keys(pendingAnswers(answersRef.current, acceptedAnswersRef.current)).length > 0 ? 'saving' : 'saved'
  ));
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  const [oversizedQuestionId, setOversizedQuestionId] = useState<string | null>(null);
  const oversizedRef = useRef<string | null>(null);
  const saveGenerationRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const terminalHandledRef = useRef(false);
  const lastSaveErrorCodeRef = useRef<string | null>(null);
  // Backoff applies to automatic triggers only; it is cleared by the first acknowledged save.
  const consecutiveFailuresRef = useRef(0);
  const automaticBlockedUntilRef = useRef(0);
  const deferredTimerRef = useRef<number | undefined>(undefined);
  const automaticSaveInFlightRef = useRef(false);
  const automaticSavePendingRef = useRef(false);
  const mountedRef = useRef(true);

  const retainPendingDraft = useCallback((answers: Record<string, unknown>) => {
    const pending = pendingAnswers(canonicalAnswers(answers), acceptedAnswersRef.current);
    const retained = draftStore.write(pending);
    setRecoveryUnavailable(Object.keys(pending).length > 0 && !retained);
    return pending;
  }, [draftStore]);

  const handleTerminal = useCallback(async () => {
    if (terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    let resolution:void | TerminalResolution;
    try { resolution=await onTerminal?.(); }
    catch { terminalHandledRef.current=false;return; }
    if(resolution && !resolution.confirmed) { terminalHandledRef.current=false;return; }
    if(!resolution || !resolution.preserveRecovery) {
      draftStore.clear();
      setRecoveryUnavailable(false);
    }
    setClosedGroups(new Set());
  }, [draftStore, onTerminal]);

  const recordSaveSuccess = useCallback(() => {
    consecutiveFailuresRef.current = 0;
    automaticBlockedUntilRef.current = 0;
  }, []);

  const recordSaveFailure = useCallback((error: unknown) => {
    consecutiveFailuresRef.current += 1;
    automaticBlockedUntilRef.current = Date.now() + autosaveBackoffMs(
      consecutiveFailuresRef.current,
      random,
      errorRetryAfterMs(error),
    );
  }, [random]);

  const persistAnswers = useCallback((retrying = false): Promise<boolean> => {
    if (oversizedRef.current !== null) return Promise.resolve(false);
    if (Object.keys(answersRef.current).length === 0) {
      setSaveStatus('saved');
      return Promise.resolve(true);
    }
    const snapshot = canonicalAnswers(structuredClone(answersRef.current));
    const generation = ++saveGenerationRef.current;
    retainPendingDraft(snapshot);
    setSaveStatus(retrying ? 'retrying' : 'saving');
    const save = saveQueueRef.current.then(async () => {
      const delta = pendingAnswers(snapshot, acceptedAnswersRef.current);
      let sectionFailure = false;
      lastSaveErrorCodeRef.current = null;
      let batches: ReturnType<typeof answerBatches>;
      try { batches=answerBatches(delta, answerGroups); }
      catch(error) {
        if (!(error instanceof ExamAnswerTooLargeError)) throw error;
        retainPendingDraft(answersRef.current);
        if(saveGenerationRef.current===generation) {
          oversizedRef.current=error.questionId;
          setOversizedQuestionId(error.questionId);
          lastSaveErrorCodeRef.current=error.code;
          setSaveStatus('failed');
        }
        return false;
      }
      for (const { group, answers: batch } of batches) {
        try {
          const records = await client.save(batch);
          const received=new Map<string,unknown>();
          for(const answer of records) {
            if(!Object.hasOwn(batch,answer.questionId)) continue;
            if(received.has(answer.questionId)) throw new ExamRequestError(200,'INVALID_RESPONSE','Duplicate answer acknowledgement',{ambiguous:true});
            received.set(answer.questionId,answer.answer);
          }
          if(Object.entries(batch).some(([id,value])=>!received.has(id) || !sameAnswer(value,received.get(id)))) {
            throw new ExamRequestError(200, 'INVALID_RESPONSE', 'Exam API did not acknowledge saved answers', { ambiguous: true });
          }
          acceptedAnswersRef.current={...acceptedAnswersRef.current,...Object.fromEntries(received)};
          retainPendingDraft(answersRef.current);
          recordSaveSuccess();
          setClosedGroups((current) => {
            if (!current.has(group)) return current;
            const next = new Set(current);
            next.delete(group);
            return next;
          });
        } catch (error) {
          const code = errorCode(error);
          lastSaveErrorCodeRef.current = code;
          if (terminalSaveError(error)) {
            await handleTerminal();
            if (saveGenerationRef.current === generation) setSaveStatus('failed');
            return false;
          }
          if (code === 'SECTION_DEADLINE_PASSED') {
            sectionFailure = true;
            setClosedGroups((current) => new Set(current).add(group));
            continue;
          }
          // Timeouts and other unacknowledged writes land here too: the draft stays, nothing is "saved".
          recordSaveFailure(error);
          retainPendingDraft(answersRef.current);
          if (saveGenerationRef.current === generation) setSaveStatus('failed');
          return false;
        }
      }
      const remaining = retainPendingDraft(answersRef.current);
      if (saveGenerationRef.current === generation) {
        setSaveStatus(sectionFailure ? 'failed' : Object.keys(remaining).length === 0 ? 'saved' : 'saving');
      }
      return !sectionFailure;
    });
    saveQueueRef.current = save;
    return save;
  }, [answerGroups, answersRef, client, handleTerminal, recordSaveFailure, recordSaveSuccess, retainPendingDraft]);

  const markDirty = useCallback(() => {
    saveGenerationRef.current += 1;
    oversizedRef.current=null;
    setOversizedQuestionId(null);
    lastSaveErrorCodeRef.current=null;
    retainPendingDraft(answersRef.current);
    // While a failure is outstanding the edit is not being sent yet; do not claim progress.
    setSaveStatus(consecutiveFailuresRef.current > 0 ? 'failed' : 'saving');
  }, [answersRef, retainPendingDraft]);

  const markSubmitted = useCallback((options?:{preserveRecovery?:boolean}) => {
    saveGenerationRef.current += 1;
    oversizedRef.current=null;
    setOversizedQuestionId(null);
    if(!options?.preserveRecovery) draftStore.clear();
    setClosedGroups(new Set());
    if(!options?.preserveRecovery) setRecoveryUnavailable(false);
    setSaveStatus('saved');
  }, [draftStore]);

  const retryNow = useCallback(() => persistAnswers(true), [persistAnswers]);
  const lastSaveErrorCode = useCallback(() => lastSaveErrorCodeRef.current, []);

  /**
   * Runs an automatic save now, or, when a backoff is in force, schedules exactly one
   * deferred attempt for when it ends (the save is postponed, never dropped).
   */
  const requestAutomaticSave = useCallback((retrying: boolean) => {
    if (submittingRef.current || !mountedRef.current || oversizedRef.current !== null) return;
    if (automaticSaveInFlightRef.current) {
      automaticSavePendingRef.current = true;
      return;
    }
    const blockedUntil = automaticBlockedUntilRef.current;
    const remaining = blockedUntil - Date.now();
    // A wall clock that moved backwards must not freeze autosave beyond the longest backoff.
    const wait = remaining > AUTOSAVE_MAX_RETRY_AFTER_MS ? 0 : remaining;
    if (wait > 0) {
      deferredTimerRef.current ??= window.setTimeout(() => {
        deferredTimerRef.current = undefined;
        requestAutomaticSave(true);
      }, wait);
      return;
    }
    // Do not queue snapshots behind an outstanding automatic request: its result
    // may impose a new backoff. Edits remain in the draft and the next trigger
    // reads the latest answers after rechecking that backoff.
    automaticSaveInFlightRef.current = true;
    const settled = () => {
      automaticSaveInFlightRef.current = false;
      if (automaticSavePendingRef.current) {
        automaticSavePendingRef.current = false;
        requestAutomaticSave(true);
      }
    };
    void persistAnswers(retrying).then(settled, settled);
  }, [persistAnswers, submittingRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      automaticSavePendingRef.current = false;
      window.clearTimeout(deferredTimerRef.current);
      deferredTimerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (revision === 0) return;
    const timeout = window.setTimeout(() => requestAutomaticSave(false), 1_000);
    return () => window.clearTimeout(timeout);
  }, [requestAutomaticSave, revision]);

  useEffect(() => {
    const interval = window.setInterval(() => requestAutomaticSave(saveStatus === 'failed'), 30_000);
    return () => window.clearInterval(interval);
  }, [requestAutomaticSave, saveStatus]);

  return {
    closedGroups,
    markDirty,
    lastSaveErrorCode,
    markSubmitted,
    persistAnswers,
    recoveryUnavailable,
    retryNow,
    saveStatus,
    oversizedQuestionId,
  };
}
