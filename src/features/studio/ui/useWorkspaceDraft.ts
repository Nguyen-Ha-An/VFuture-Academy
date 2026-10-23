"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { COURSE_REF, refKey, type DocumentRef } from '@/content-engine/diagnostics';
import { sameWorkspaceSnapshot } from '@/content-engine/validate/revision';
import {
  acceptWorkspaceSave, changeWorkspaceManifest, changeWorkspaceSource, createSourceIdentityCache, createWorkspaceState,
  importWorkspaceItemLocally, materializeWorkspaceItem, mutationFailureOf, replaceWorkspaceLocally,
  restoreWorkspaceSources, workspaceIsDirty, workspacePayload,
  type MutationFailure, type WorkspaceDraft, type WorkspaceSnapshot, type WorkspaceState,
} from '../workspace-state';
import { readApiData, WorkspaceApiError } from './client';
import { measureStudioOperation, startStudioTiming } from './studio-performance';
import { useWorkspaceAnalysis } from './useWorkspaceAnalysis';

export type WorkspaceSaveStatus = 'idle' | 'saving' | 'reconciling' | 'saved' | 'conflict' | 'error' | 'uncertain';
const REQUEST_TIMEOUT_MS = 15_000;
const AUTOSAVE_DEBOUNCE_MS = 1_500;

function sameSources(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

export type WorkspaceDraftOptions = {
  /** Receives the exact raw sources the server acknowledged, for local recovery cleanup. */
  onSaved?: (acknowledgedSources: Record<string, string>) => void;
  fetcher?: typeof fetch;
};

export function useWorkspaceDraft(initialDraft: WorkspaceDraft, readOnly: boolean, options: WorkspaceDraftOptions = {}) {
  const [state, setState] = useState(() => createWorkspaceState(initialDraft));
  const [sourceIdentityCache] = useState(() => createSourceIdentityCache());
  const current = useRef(state);
  const editVersion = useRef(0);
  const pending = useRef(false);
  const pendingPromise = useRef<Promise<boolean> | null>(null);
  const uncertainSubmission = useRef<{ snapshot: WorkspaceSnapshot; sources: Record<string, string> } | null>(null);
  const [status, setStatus] = useState<WorkspaceSaveStatus>('idle');
  const statusRef = useRef<WorkspaceSaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(() => initialDraft.updatedAt ? Date.parse(initialDraft.updatedAt) : null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<unknown[]>([]);
  const [mutation, setMutation] = useState<MutationFailure | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;

  const changeStatus = useCallback((next: WorkspaceSaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const update = useCallback((fn: (value: WorkspaceState) => WorkspaceState, authored = false, deferred = false) => {
    const previous = current.current;
    const next = fn(current.current);
    current.current = next;
    if (deferred) startTransition(() => setState(next));
    else setState(next);
    if (next.mutation !== previous.mutation) setMutation(next.mutation);
    if (authored) editVersion.current += 1;
  }, []);

  const dirty = useMemo(() => workspaceIsDirty(state, sourceIdentityCache), [sourceIdentityCache, state]);
  const analysis = useWorkspaceAnalysis(state);
  const payload = analysis.payload;
  const diagnostics = analysis.diagnostics;

  const changeSource = useCallback((ref: DocumentRef, source: string) => {
    if (readOnly) return;
    update(value => changeWorkspaceSource(value, ref, source, sourceIdentityCache), true, true);
    if (!['error', 'conflict', 'uncertain'].includes(statusRef.current)) {
      setError(null); setIssues(value => value.length === 0 ? value : []);
    }
  }, [readOnly, sourceIdentityCache, update]);

  const materialize = useCallback((itemId: string) => {
    if (readOnly) return;
    update(value => materializeWorkspaceItem(value, itemId), true);
    setIssues([]);
  }, [readOnly, update]);

  /** Mutations report why they were refused instead of silently doing nothing. */
  const attempt = useCallback((fn: (value: WorkspaceState) => WorkspaceState) => {
    if (readOnly) return false;
    try {
      update(fn, true);
      setError(null); setIssues([]);
      return true;
    } catch (cause) {
      const failure = mutationFailureOf(cause);
      if (!failure) throw cause;
      setMutation(failure);
      setError(failure.code);
      return false;
    }
  }, [readOnly, update]);

  const changeManifest = useCallback((manifest: unknown) =>
    attempt(value => changeWorkspaceManifest(value, manifest)), [attempt]);

  const importItem = useCallback((document: unknown, moduleId: string) =>
    attempt(value => importWorkspaceItemLocally(value, document, moduleId)), [attempt]);

  const replace = useCallback((snapshot: WorkspaceSnapshot) => {
    if (!attempt(value => replaceWorkspaceLocally(value, snapshot))) return false;
    changeStatus('idle');
    return true;
  }, [attempt, changeStatus]);

  /** Restored text is raw and local: it is validated like anything typed, and only a valid workspace can be saved. */
  const restoreSources = useCallback((sources: Record<string, string>) => {
    if (readOnly) return false;
    update(value => restoreWorkspaceSources(value, sources), true);
    changeStatus('idle'); setError(null); setIssues([]);
    return true;
  }, [changeStatus, readOnly, update]);

  const performSave = useCallback(async (automatic: boolean): Promise<boolean> => {
    const fetcher = callbacks.current.fetcher ?? fetch;
    if (readOnly) return false;
    if (pending.current) {
      return pendingPromise.current ?? false;
    }
    if (automatic && ['error', 'conflict', 'uncertain'].includes(statusRef.current)) return false;
    if (!automatic && ['conflict', 'uncertain'].includes(statusRef.current)) return false;
    if (!workspaceIsDirty(current.current, sourceIdentityCache)) return true;
    const url = `/api/v1/studio/courses/${encodeURIComponent(initialDraft.courseId)}/draft/workspace`;
    pending.current = true;
    const task = (async () => {
        const submittedSources = { ...current.current.sources };
        const snapshot = measureStudioOperation('studio.workspace.save.prepare', () => workspacePayload(current.current));
        if (!snapshot) { setError('INVALID_SOURCE'); setIssues([]); changeStatus('idle'); return false; }
        const revision = current.current.updatedAt;
        if (!revision) { setError('PRECONDITION_REQUIRED'); changeStatus('error'); return false; }
        const body = measureStudioOperation('studio.workspace.save.prepare', () => JSON.stringify(snapshot));
        changeStatus('saving');
        setError(null); setIssues([]);
        try {
          const finishRequestTiming = startStudioTiming('studio.workspace.save.request');
          const saved = await readApiData<WorkspaceDraft>(await fetcher(url, {
            method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': revision },
            body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }).finally(finishRequestTiming));
          if (!sameWorkspaceSnapshot(snapshot, saved)) {
            changeStatus('error'); setError('SAVE_ACK_MISMATCH'); return false;
          }
          uncertainSubmission.current = null;
          update(value => acceptWorkspaceSave(value, saved));
          setSavedAt(Date.now());
          callbacks.current.onSaved?.(submittedSources);
        } catch (cause) {
          if (cause instanceof WorkspaceApiError) {
            changeStatus(cause.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error');
            setError(cause.code);
            setIssues(cause.issues ?? []);
            return false;
          }
          // A missing response is ambiguous. Read back and compare every field of
          // the submitted snapshot; a hash is never accepted as acknowledgment.
          uncertainSubmission.current = { snapshot, sources: submittedSources };
          changeStatus('reconciling');
          try {
            const finishReconcileTiming = startStudioTiming('studio.workspace.save.reconcile');
            const stored = await readApiData<WorkspaceDraft>(await fetcher(
              `/api/v1/studio/courses/${encodeURIComponent(initialDraft.courseId)}/draft`,
              { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
            ).finally(finishReconcileTiming));
            if (!sameWorkspaceSnapshot(snapshot, stored)) {
              uncertainSubmission.current = null;
              changeStatus('error'); setError('SAVE_NOT_APPLIED'); return false;
            }
            uncertainSubmission.current = null;
            update(value => acceptWorkspaceSave(value, stored));
            setSavedAt(Date.now());
            callbacks.current.onSaved?.(submittedSources);
          } catch {
            changeStatus('uncertain'); setError('SAVE_UNCERTAIN'); return false;
          }
        }
      const clean = !workspaceIsDirty(current.current, sourceIdentityCache);
      changeStatus(clean ? 'saved' : 'idle');
      return clean;
    })();
    pendingPromise.current = task;
    try { return await task; }
    finally { pending.current = false; pendingPromise.current = null; }
  }, [changeStatus, initialDraft.courseId, readOnly, sourceIdentityCache, update]);

  const save = useCallback(() => performSave(false), [performSave]);

  /**
   * Review submission freezes an exact source boundary at click time. If an older
   * autosave is active, wait for it and then save the captured newer sources. Text
   * typed after the click is never silently included in that submission.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    const requestedSources = { ...current.current.sources };
    const requestedEditVersion = editVersion.current;
    const olderSave = pendingPromise.current;
    if (olderSave) await olderSave;
    if (requestedEditVersion !== editVersion.current || !sameSources(requestedSources, current.current.sources)) return false;
    if (['error', 'conflict', 'uncertain', 'reconciling'].includes(statusRef.current)) return false;
    if (!workspaceIsDirty(current.current, sourceIdentityCache)) return true;
    const saved = await performSave(false);
    return saved && requestedEditVersion === editVersion.current
      && sameSources(requestedSources, current.current.sources)
      && !workspaceIsDirty(current.current, sourceIdentityCache);
  }, [performSave, sourceIdentityCache]);

  const reconcile = useCallback(async (): Promise<boolean> => {
    const submitted = uncertainSubmission.current;
    if (readOnly || pending.current || statusRef.current !== 'uncertain' || !submitted) return false;
    const fetcher = callbacks.current.fetcher ?? fetch;
    pending.current = true;
    changeStatus('reconciling');
    try {
      const finishReconcileTiming = startStudioTiming('studio.workspace.save.reconcile');
      const stored = await readApiData<WorkspaceDraft>(await fetcher(
        `/api/v1/studio/courses/${encodeURIComponent(initialDraft.courseId)}/draft`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      ).finally(finishReconcileTiming));
      if (!sameWorkspaceSnapshot(submitted.snapshot, stored)) {
        uncertainSubmission.current = null;
        changeStatus('error'); setError('SAVE_NOT_APPLIED');
        return false;
      }
      uncertainSubmission.current = null;
      update(value => acceptWorkspaceSave(value, stored));
      setSavedAt(Date.now());
      setError(null); setIssues([]);
      callbacks.current.onSaved?.(submitted.sources);
      const clean = !workspaceIsDirty(current.current, sourceIdentityCache);
      changeStatus(clean ? 'saved' : 'idle');
      return clean;
    } catch {
      changeStatus('uncertain'); setError('SAVE_UNCERTAIN');
      return false;
    } finally { pending.current = false; }
  }, [changeStatus, initialDraft.courseId, readOnly, sourceIdentityCache, update]);

  useEffect(() => {
    if (readOnly || !dirty || pending.current || ['error', 'conflict', 'uncertain'].includes(status)) return;
    const timer = window.setTimeout(() => { void performSave(true); }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, performSave, readOnly, state.sources, status]);

  const reload = useCallback(async () => {
    const fetcher = callbacks.current.fetcher ?? fetch;
    if (pending.current) return;
    // Editing is disabled by the caller while this explicitly destructive reload runs.
    pending.current = true;
    changeStatus('saving');
    try {
      const next = await readApiData<WorkspaceDraft>(await fetcher(`/api/v1/studio/courses/${encodeURIComponent(initialDraft.courseId)}/draft`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
      update(() => createWorkspaceState(next));
      changeStatus('idle'); setError(null); setIssues([]); setMutation(null); setSavedAt(Date.now());
    } catch { setError('RELOAD_FAILED'); setIssues([]); changeStatus('error'); }
    finally { pending.current = false; }
  }, [changeStatus, initialDraft.courseId, update]);

  const clearMutation = useCallback(() => {
    setMutation(null);
    setError(value => (value === null ? null : value));
    update(value => (value.mutation === null ? value : { ...value, mutation: null }));
  }, [update]);

  return {
    state, current, dirty, payload, diagnostics, analysisPending: analysis.pending, status, savedAt, error, issues, mutation,
    changeSource, changeManifest, importItem, replace, restoreSources, save, flush, reconcile, reload, materialize, clearMutation,
    /** Raw source key for a document reference, for callers holding refs. */
    sourceKeyOf: refKey, courseRef: COURSE_REF,
  };
}
