"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

import { routes } from '@/lib/routes';
import {
  RECOVERY_DEBOUNCE_MS, RECOVERY_SIGNED_OUT_KEY, claimTabId, clearAccountRecovery,
  clearAcknowledgedRecovery, discardRecovery, indexedDbRecoveryStorage, loadRecovery, pruneRecovery,
  sameSources, saveRecovery, serverHasMovedOn, toRecoveryExport,
  type RecoveryExport, type RecoveryRecord, type RecoveryScope, type RecoveryStorage, type TabOwnership,
} from '../recovery';

export type RecoveryStorageProblem = 'unavailable' | 'quota' | 'failed';
export type RecoveryCandidate = {
  record: RecoveryRecord;
  /** The server draft moved on since these edits; restoring would replace newer content. */
  serverIsNewer: boolean;
};

export type LocalRecoveryOptions = {
  accountId: string;
  scopeKey: string;
  courseId: string;
  /** Raw editor text keyed by `refKey`. */
  sources: Record<string, string>;
  baseUpdatedAt: string | null;
  baseVersionId: string | null;
  dirty: boolean;
  readOnly?: boolean;
  storage?: RecoveryStorage;
  debounceMs?: number;
  now?: () => number;
  /** Injectable so tests can drive the duplicate-tab handshake directly. */
  claim?: () => Promise<TabOwnership>;
};

function classify(cause: unknown): RecoveryStorageProblem {
  const name = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  if (/quota|QuotaExceeded/i.test(name)) return 'quota';
  if (/unavailable|no indexedDB|blocked/i.test(name)) return 'unavailable';
  return 'failed';
}

/**
 * Keeps this tab's unfinished raw text on the author's own device.
 *
 * Nothing here is authoritative and nothing restores itself: the server draft is
 * always what loads, and a stored record only ever becomes a Restore / Download /
 * Discard choice. A storage failure is reported and then ignored — editing must
 * never depend on local recovery working.
 */
export function useLocalRecovery(options: LocalRecoveryOptions) {
  const {
    accountId, scopeKey, courseId, sources, baseUpdatedAt, baseVersionId, dirty,
    readOnly = false, debounceMs = RECOVERY_DEBOUNCE_MS,
  } = options;
  const storageRef = useRef<RecoveryStorage | null>(options.storage ?? null);
  if (options.storage && storageRef.current !== options.storage) storageRef.current = options.storage;
  const now = options.now ?? Date.now;

  const [scope, setScope] = useState<RecoveryScope | null>(null);
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
  const [problem, setProblem] = useState<RecoveryStorageProblem | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [ready, setReady] = useState(false);

  const latest = useRef({ sources, baseUpdatedAt, baseVersionId, dirty, readOnly, scope, courseId, accountId });
  latest.current = { sources, baseUpdatedAt, baseVersionId, dirty, readOnly, scope, courseId, accountId };
  const written = useRef<Record<string, string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const storage = useCallback((): RecoveryStorage => {
    storageRef.current ??= indexedDbRecoveryStorage();
    return storageRef.current;
  }, []);

  const fail = useCallback((cause: unknown) => { setProblem(classify(cause)); }, []);

  // One-time setup: settle an identity no other live tab is writing under, drop
  // anything expired, then look for a record left behind for this tab.
  useEffect(() => {
    let cancelled = false;
    let ownership: TabOwnership | null = null;
    const claim = options.claim ?? (() => claimTabId());
    void (async () => {
      const owned = await claim().catch((): TabOwnership => ({
        tabId: `tab-${Math.random().toString(36).slice(2, 10)}`,
        rekeyed: false, durable: false, priorTabId: null, dispose: () => undefined,
      }));
      ownership = owned;
      if (cancelled) { owned.dispose(); return; }
      const next: RecoveryScope = { accountId, scopeKey, courseId, tabId: owned.tabId };
      setScope(next);
      setDegraded(!owned.durable);
      try {
        await pruneRecovery(storage(), now());
        // A tab whose identity could not be verified writes under a fresh key, so
        // its previous session's record lives under `priorTabId`. It is still the
        // author's text, so it is still offered — for restore or download.
        const record = await loadRecovery(storage(), next, now())
          ?? (owned.priorTabId ? await loadRecovery(storage(), { ...next, tabId: owned.priorTabId }, now()) : null);
        if (cancelled) return;
        if (record) setCandidate({ record, serverIsNewer: serverHasMovedOn(record, baseUpdatedAt) });
      } catch (cause) { if (!cancelled) fail(cause); }
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; ownership?.dispose(); };
    // The scope identity is fixed for the life of this editor mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, courseId, scopeKey]);

  const persist = useCallback(async (): Promise<void> => {
    const current = latest.current;
    if (current.readOnly || !current.scope || !current.dirty) return;
    if (written.current && sameSources(written.current, current.sources)) return;
    const snapshot = { ...current.sources };
    try {
      await saveRecovery(storage(), current.scope, {
        sources: snapshot,
        baseUpdatedAt: current.baseUpdatedAt,
        baseVersionId: current.baseVersionId,
      }, now());
      written.current = snapshot;
      setProblem(null);
    } catch (cause) { fail(cause); }
  }, [fail, now, storage]);

  // Debounced write. A single pending timer per tab, replaced on every keystroke.
  useEffect(() => {
    if (readOnly || !scope) return;
    if (!dirty) return;
    const mine = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (generation.current === mine) void persist();
    }, debounceMs);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [debounceMs, dirty, persist, readOnly, scope, sources]);

  // Leaving the page is the moment the debounce would otherwise lose.
  useEffect(() => {
    if (readOnly) return;
    const flush = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      void persist();
    };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist, readOnly]);

  /** Clears the record only when it still holds exactly the text the server acknowledged. */
  const acknowledge = useCallback(async (acknowledged: Record<string, string>): Promise<void> => {
    const current = latest.current;
    if (!current.scope) return;
    try {
      const cleared = await clearAcknowledgedRecovery(storage(), current.scope, acknowledged);
      if (cleared) written.current = null;
      setCandidate(value => (cleared ? null : value));
    } catch (cause) { fail(cause); }
  }, [fail, storage]);

  const discard = useCallback(async (): Promise<void> => {
    const current = latest.current;
    setCandidate(null);
    written.current = null;
    if (!current.scope) return;
    try { await discardRecovery(storage(), current.scope); }
    catch (cause) { fail(cause); }
  }, [fail, storage]);

  const download = useCallback((): RecoveryExport | null => (candidate ? toRecoveryExport(candidate.record) : null), [candidate]);

  const dismiss = useCallback(() => { setCandidate(null); }, []);

  // Sign-out clears this account's own records. The listener is registered after
  // the unsaved-changes guard, so a cancelled sign-out never reaches it.
  useEffect(() => {
    const signoutPath = routes.auth.signout();
    const submit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = form.getAttribute('action');
      if (!action || new URL(action, location.href).pathname !== signoutPath) return;
      void clearAccountRecovery(storage(), latest.current.accountId).catch(() => undefined);
    };
    const signedOutElsewhere = (event: StorageEvent) => {
      if (event.key !== RECOVERY_SIGNED_OUT_KEY) return;
      void clearAccountRecovery(storage(), latest.current.accountId).catch(() => undefined);
    };
    document.addEventListener('submit', submit, true);
    window.addEventListener('storage', signedOutElsewhere);
    return () => {
      document.removeEventListener('submit', submit, true);
      window.removeEventListener('storage', signedOutElsewhere);
    };
  }, [storage]);

  return { ready, scope, candidate, problem, degraded, acknowledge, discard, dismiss, download, flush: persist };
}
