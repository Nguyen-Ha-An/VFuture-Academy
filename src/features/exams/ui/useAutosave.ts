'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ExamClient } from './client';
import type { PendingExamDraftStore } from './pending-draft';

export type SaveStatus = 'saved' | 'saving' | 'retrying' | 'failed';

interface UseAutosaveOptions {
  answerGroups: Record<string, string>;
  answersRef: RefObject<Record<string, unknown>>;
  client: Pick<ExamClient, 'save'>;
  draftStore: PendingExamDraftStore;
  initialAcceptedAnswers: Record<string, unknown>;
  onTerminal?: () => void | Promise<void>;
  revision: number;
  submittingRef: RefObject<boolean>;
}

function sameAnswer(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
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

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

function answerBatches(delta: Record<string, unknown>, groups: Record<string, string>) {
  const batches = new Map<string, Record<string, unknown>>();
  for (const [questionId, answer] of Object.entries(delta)) {
    const group = groups[questionId] ?? questionId;
    batches.set(group, { ...(batches.get(group) ?? {}), [questionId]: answer });
  }
  return [...batches.entries()].map(([group, answers]) => ({ group, answers }));
}

export function useAutosave({
  answerGroups,
  answersRef,
  client,
  draftStore,
  initialAcceptedAnswers,
  onTerminal,
  revision,
  submittingRef,
}: UseAutosaveOptions) {
  const acceptedAnswersRef = useRef(structuredClone(initialAcceptedAnswers));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => (
    Object.keys(pendingAnswers(answersRef.current, acceptedAnswersRef.current)).length > 0 ? 'saving' : 'saved'
  ));
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  const saveGenerationRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const terminalHandledRef = useRef(false);
  const lastSaveErrorCodeRef = useRef<string | null>(null);

  const retainPendingDraft = useCallback((answers: Record<string, unknown>) => {
    const pending = pendingAnswers(answers, acceptedAnswersRef.current);
    const retained = draftStore.write(pending);
    setRecoveryUnavailable(Object.keys(pending).length > 0 && !retained);
    return pending;
  }, [draftStore]);

  const handleTerminal = useCallback(async () => {
    draftStore.clear();
    setClosedGroups(new Set());
    setRecoveryUnavailable(false);
    if (terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    await onTerminal?.();
  }, [draftStore, onTerminal]);

  const persistAnswers = useCallback((retrying = false): Promise<boolean> => {
    if (Object.keys(answersRef.current).length === 0) {
      setSaveStatus('saved');
      return Promise.resolve(true);
    }
    const snapshot = structuredClone(answersRef.current);
    const generation = ++saveGenerationRef.current;
    retainPendingDraft(snapshot);
    setSaveStatus(retrying ? 'retrying' : 'saving');
    const save = saveQueueRef.current.then(async () => {
      const delta = pendingAnswers(snapshot, acceptedAnswersRef.current);
      let sectionFailure = false;
      lastSaveErrorCodeRef.current = null;
      for (const { group, answers: batch } of answerBatches(delta, answerGroups)) {
        try {
          const records = await client.save(batch);
          acceptedAnswersRef.current = Object.fromEntries(records.map((answer) => [answer.questionId, answer.answer]));
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
  }, [answerGroups, answersRef, client, handleTerminal, retainPendingDraft]);

  const markDirty = useCallback(() => {
    saveGenerationRef.current += 1;
    retainPendingDraft(answersRef.current);
    setSaveStatus('saving');
  }, [answersRef, retainPendingDraft]);

  const markSubmitted = useCallback(() => {
    saveGenerationRef.current += 1;
    draftStore.clear();
    setClosedGroups(new Set());
    setRecoveryUnavailable(false);
    setSaveStatus('saved');
  }, [draftStore]);

  const retryNow = useCallback(() => persistAnswers(true), [persistAnswers]);
  const lastSaveErrorCode = useCallback(() => lastSaveErrorCodeRef.current, []);

  useEffect(() => {
    if (revision === 0) return;
    const timeout = window.setTimeout(() => {
      if (!submittingRef.current) void persistAnswers();
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [persistAnswers, revision, submittingRef]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!submittingRef.current) void persistAnswers(saveStatus === 'failed');
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [persistAnswers, saveStatus, submittingRef]);

  return {
    closedGroups,
    markDirty,
    lastSaveErrorCode,
    markSubmitted,
    persistAnswers,
    recoveryUnavailable,
    retryNow,
    saveStatus,
  };
}
