"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type ContentSaveStatus =
  | "idle"
  | "saving"
  | "reconciling"
  | "saved"
  | "error"
  | "conflict"
  | "uncertain";
export type SaveAcknowledgment = { revision: string; savedAt: string };
export class ContentSaveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export type ContentAutosaveOptions = {
  value: string;
  initialValue: string;
  initialRevision?: string;
  valid: boolean;
  enabled: boolean;
  isNew?: boolean;
  persist: (source: string, signal: AbortSignal) => Promise<SaveAcknowledgment>;
  reconcile: (
    source: string,
    signal: AbortSignal,
  ) => Promise<SaveAcknowledgment | null>;
  storageKey?: string;
  shortcutTarget?: RefObject<HTMLElement | null>;
  /** A mounted workspace navigation guard owns the native unload prompt. */
  navigationGuarded?: boolean;
  onRestore?: (source: string) => void;
};

/** One acknowledged baseline; requests never replace the editor's current value. */
export function useContentAutosave(options: ContentAutosaveOptions) {
  const latest = useRef(options);
  latest.current = options;
  const baseline = useRef(options.initialValue);
  const observed = useRef(options.value);
  const editGeneration = useRef(0);
  if (observed.current !== options.value) {
    observed.current = options.value;
    editGeneration.current += 1;
  }
  const acknowledgedRevision = useRef<string | null>(
    options.initialRevision ?? null,
  );
  const inFlight = useRef<Promise<boolean> | null>(null);
  const unresolved = useRef<string | null>(null);
  const paused = useRef(false);
  const conflict = useRef(false);
  const [, setAcknowledgedValue] = useState(options.initialValue);
  const [status, setStatus] = useState<ContentSaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const writer = useRef(crypto.randomUUID());
  const encodeRecovery = useCallback(
    (source: string) =>
      JSON.stringify({
        format: "studio-recovery-v1",
        owner: writer.current,
        source,
      }),
    [],
  );
  const readRecovery = useCallback(
    (
      stored: string | null,
    ): { source: string; owner: string | null } | null => {
      if (stored === null) return null;
      try {
        const value = JSON.parse(stored);
        if (
          value?.format === "studio-recovery-v1" &&
          typeof value.source === "string" &&
          typeof value.owner === "string"
        )
          return value;
      } catch {
        /* legacy raw source */
      }
      return { source: stored, owner: null };
    },
    [],
  );
  const dirty = options.isNew === true || options.value !== baseline.current;

  useEffect(() => {
    if (!options.storageKey) return;
    try {
      const saved = readRecovery(localStorage.getItem(options.storageKey));
      if (saved !== null && saved.source !== latest.current.initialValue)
        setRecovery(saved.source);
    } catch {
      setStorageError(true);
    }
  }, [options.storageKey, readRecovery]);

  useEffect(() => {
    if (!options.storageKey) return;
    if (!dirty) {
      try {
        if (
          readRecovery(localStorage.getItem(options.storageKey))?.owner ===
          writer.current
        )
          localStorage.removeItem(options.storageKey);
      } catch {
        setStorageError(true);
      }
      return;
    }
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          options.storageKey!,
          encodeRecovery(options.value),
        );
      } catch {
        setStorageError(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [options.storageKey, options.value, dirty, readRecovery, encodeRecovery]);

  useEffect(
    () => () => {
      const current = latest.current;
      if (!current.storageKey || current.value === baseline.current) return;
      try {
        localStorage.setItem(current.storageKey, encodeRecovery(current.value));
      } catch {
        /* UI already reports unavailable recovery while mounted. */
      }
    },
    [encodeRecovery],
  );

  const acknowledge = useCallback(
    (source: string, ack: SaveAcknowledgment) => {
      baseline.current = source;
      acknowledgedRevision.current = ack.revision;
      setAcknowledgedValue(source);
      unresolved.current = null;
      paused.current = false;
      conflict.current = false;
      setRevision(ack.revision);
      setSavedAt(ack.savedAt);
      setError(null);
      setStatus("saved");
      const key = latest.current.storageKey;
      if (key) {
        try {
          if (latest.current.value === source) {
            if (
              readRecovery(localStorage.getItem(key))?.owner === writer.current
            )
              localStorage.removeItem(key);
          } else
            localStorage.setItem(key, encodeRecovery(latest.current.value));
        } catch {
          setStorageError(true);
        }
      }
      return latest.current.value === source;
    },
    [readRecovery, encodeRecovery],
  );

  const reconcile = useCallback(
    async (source: string) => {
      setStatus("reconciling");
      try {
        const ack = await latest.current.reconcile(
          source,
          AbortSignal.timeout(15_000),
        );
        if (ack) return acknowledge(source, ack);
        // A different stored version may belong to another editor. Never overwrite it.
        unresolved.current = null;
        paused.current = true;
        conflict.current = true;
        setStatus("conflict");
        setError("SAVE_NOT_APPLIED");
      } catch {
        unresolved.current = source;
        paused.current = true;
        setStatus("uncertain");
        setError("SAVE_UNCERTAIN");
      }
      return false;
    },
    [acknowledge],
  );

  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (!latest.current.enabled || !latest.current.valid)
      return Promise.resolve(false);
    if (unresolved.current !== null) return Promise.resolve(false);
    // A known conflict requires reloading/merging the server version, not retrying a stale overwrite.
    if (conflict.current) return Promise.resolve(false);
    if (!latest.current.isNew && latest.current.value === baseline.current)
      return Promise.resolve(true);
    const source = latest.current.value;
    paused.current = false;
    setStatus("saving");
    setError(null);
    const start = performance.now();
    const operation = (async () => {
      try {
        const ack = await latest.current.persist(
          source,
          AbortSignal.timeout(15_000),
        );
        return acknowledge(source, ack);
      } catch (cause) {
        if (cause instanceof ContentSaveError && cause.status < 500) {
          paused.current = true;
          conflict.current = cause.status === 409 || cause.status === 412;
          setStatus(
            cause.status === 409 || cause.status === 412 ? "conflict" : "error",
          );
          setError(cause.message);
          return false;
        }
        return await reconcile(source);
      } finally {
        performance.measure?.("studio.content.save", {
          start,
          end: performance.now(),
        });
        inFlight.current = null;
      }
    })();
    inFlight.current = operation;
    return operation;
  }, [acknowledge, reconcile]);

  const flush = useCallback(async () => {
    const requested = latest.current.value;
    const generation = editGeneration.current;
    if (inFlight.current) await inFlight.current;
    if (
      latest.current.value !== requested ||
      editGeneration.current !== generation ||
      paused.current ||
      unresolved.current ||
      conflict.current
    )
      return false;
    const saved = await save();
    return saved && editGeneration.current === generation;
  }, [save]);

  const retryRead = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    if (unresolved.current === null) return Promise.resolve(false);
    const operation = reconcile(unresolved.current).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = operation;
    return operation;
  }, [reconcile]);

  useEffect(() => {
    if (
      (options.isNew && options.value === options.initialValue) ||
      !dirty ||
      !options.enabled ||
      !options.valid ||
      paused.current ||
      inFlight.current ||
      recovery !== null
    )
      return;
    const timer = setTimeout(() => {
      void save();
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    dirty,
    options.value,
    options.initialValue,
    options.isNew,
    options.enabled,
    options.valid,
    status,
    recovery,
    save,
  ]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = latest.current.shortcutTarget;
      if (target && !target.current?.contains(document.activeElement)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s" &&
        latest.current.enabled
      ) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", keydown);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.value === baseline.current) return;
      if (latest.current.storageKey) {
        try {
          localStorage.setItem(
            latest.current.storageKey,
            encodeRecovery(latest.current.value),
          );
        } catch {
          /* unload still warns */
        }
      }
      if (!latest.current.navigationGuarded) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [save, encodeRecovery]);

  return {
    adoptServerValue: (source: string, serverRevision: string) => {
      if (inFlight.current || latest.current.value !== baseline.current)
        return false;
      baseline.current = source;
      acknowledgedRevision.current = serverRevision;
      setAcknowledgedValue(source);
      setRevision(serverRevision);
      latest.current.onRestore?.(source);
      return true;
    },
    getRevision: () => acknowledgedRevision.current,
    status,
    dirty,
    savedAt,
    revision,
    error,
    storageError,
    recovery,
    source: options.value,
    save,
    flush,
    retryRead,
    restoreRecovery: () => {
      if (recovery !== null && latest.current.enabled) {
        if (latest.current.storageKey) {
          try {
            localStorage.setItem(
              latest.current.storageKey,
              encodeRecovery(recovery),
            );
          } catch {
            setStorageError(true);
          }
        }
        latest.current.onRestore?.(recovery);
        setRecovery(null);
      }
    },
    discardRecovery: () => {
      if (options.storageKey) {
        try {
          if (
            readRecovery(localStorage.getItem(options.storageKey))?.source ===
            recovery
          )
            localStorage.removeItem(options.storageKey);
        } catch {
          setStorageError(true);
        }
      }
      setRecovery(null);
    },
  };
}

export async function contentSaveData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new ContentSaveError(
      body.error?.message ?? "Unable to save",
      response.status,
    );
  if (body.data === undefined || body.data === null)
    throw new Error("Missing save acknowledgment");
  return body.data as T;
}
