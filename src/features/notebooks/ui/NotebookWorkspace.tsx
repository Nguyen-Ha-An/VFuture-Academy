"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { registerNavigationGuard } from "@/lib/navigation-guard";
import { NotebookBridge } from "../bridge";
import {
  NotebookAssignmentSchema,
  validateNotebookDocument,
  type NotebookAssignment,
} from "../contracts";
import { NotebookViewer } from "./NotebookViewer";
import {
  EMPTY_NOTEBOOK,
  NotebookApiError,
  downloadNotebook,
  notebookApi,
  notebookJson,
  sameNotebookSnapshot,
  uploadNotebookFile,
  type NotebookSession,
} from "../client";
import type { NotebookLocator } from "../upload-contract";
import type { AssignmentSubmitResult } from "@/features/submissions/contracts";

type Dataset = {
  assetId: string;
  checksum: string;
  filename: string;
  sizeBytes: number;
  content: string;
};
type RecoverySnapshot = {
  notebook: unknown;
  mode?: "jupyterlite" | "colab_external";
  reason?: string;
  datasets?: Dataset[];
};
const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const primary = button + " !bg-primary !text-primary-foreground";
export function NotebookWorkspace({
  locator,
  studio = false,
  runtimeUrl,
}: {
  locator: NotebookLocator;
  studio?: boolean;
  runtimeUrl: string | null;
}) {
  const t = useTranslations("notebook");
  const locale = useLocale() === "en" ? "en" : "vi";
  // The learner route always renders the refined workspace; Studio keeps its own layout.
  const refined = !studio;
  const [session, setSession] = useState<NotebookSession | null>(null);
  const [notebook, setNotebook] = useState<unknown>(EMPTY_NOTEBOOK);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mode, setMode] = useState<"jupyterlite" | "colab_external">(
    "jupyterlite",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [recoverable, setRecoverable] = useState<RecoverySnapshot | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<NotebookBridge | null>(null);
  const notebookRef = useRef(notebook);
  const datasetsRef = useRef(datasets);
  const sessionRef = useRef(session);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const editRevision = useRef(0);
  const autoSavePaused = useRef(false);
  const modeRef = useRef(mode);
  const reasonRef = useRef(reason);
  const api = useCallback(
    (action: string) => notebookApi(locator, studio, action),
    [locator, studio],
  );
  const recoveryKey = session
    ? `vfuture:notebook:${session.userId}:${session.courseVersionId ?? "studio"}:${locator.courseId}:${locator.itemId}:${locator.blockId ?? ""}`
    : null;
  const recoveryRef = useRef<string | null>(null);
  recoveryRef.current = recoveryKey;
  const report = useCallback(
    (err: unknown) => {
      const sessionFailure =
        err instanceof NotebookApiError &&
        err.status === 401 &&
        (err.code === "UNAUTHENTICATED" ||
          err.code === "NOTEBOOK_ACTOR_CHANGED");
      if (sessionFailure) {
        bridgeRef.current?.dispose();
        bridgeRef.current = null;
        setRuntimeReady(false);
        sessionRef.current = null;
        setSession(null);
        autoSavePaused.current = true;
        if (err.code === "NOTEBOOK_ACTOR_CHANGED") {
          notebookRef.current = structuredClone(EMPTY_NOTEBOOK);
          setNotebook(notebookRef.current);
          datasetsRef.current = [];
          setDatasets([]);
          dirtyRef.current = false;
          setDirty(false);
          setRecoverable(null);
          recoveryRef.current = null;
        }
      }
      setError(
        sessionFailure
          ? t("sessionExpired")
          : err instanceof NotebookApiError
            ? t(({
                NOTEBOOK_INVALID: "invalidFile",
                NOTEBOOK_TEMPLATE_PRIVATE_CELLS: "privateCells",
                NOTEBOOK_TOO_LARGE: "tooLarge",
                NOTEBOOK_CHECKSUM_MISMATCH: "checksumMismatch",
                NOTEBOOK_SIZE_MISMATCH: "checksumMismatch",
                NOTEBOOK_DRAFT_CONFLICT: "conflictMessage",
                NOTEBOOK_TEMPLATE_CONFLICT: "conflictMessage",
                DRAFT_CONFLICT: "conflictMessage",
                NOTEBOOK_ASSET_NOT_FOUND: "fileUnavailable",
                NOTEBOOK_DEPENDENCIES_INVALID: "fileUnavailable",
                FORBIDDEN: "accessDenied",
                ACCOUNT_SUSPENDED: "accessDenied",
              } as Record<string,string>)[err.code] ?? "failed")
            : err instanceof Error
              ? err.message
              : t("failed"),
      );
      if (err instanceof NotebookApiError && err.status === 409) {
        setConflict(true);
        autoSavePaused.current = true;
      }
    },
    [t],
  );
  const persistRecovery = useCallback(
    (value: unknown = notebookRef.current) => {
      const key = recoveryRef.current;
      if (!key) return;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            notebook: value,
            mode: modeRef.current,
            reason: reasonRef.current,
            datasets: datasetsRef.current,
            savedAt: Date.now(),
          }),
        );
      } catch {
        setNotice(t("localRecoveryUnavailable"));
      }
    },
    [t],
  );
  const markEdited = useCallback(() => {
    editRevision.current++;
    autoSavePaused.current = false;
    dirtyRef.current = true;
    setDirty(true);
    setNotice(null);
    persistRecovery();
  }, [persistRecovery]);
  const updateNotebook = useCallback(
    (value: unknown) => {
      if (sameNotebookSnapshot(value, notebookRef.current)) return;
      notebookRef.current = value;
      setNotebook(value);
      markEdited();
      persistRecovery(value);
    },
    [markEdited, persistRecovery],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConflict(false);
    setRuntimeReady(false);
    setRuntimeFailed(false);
    bridgeRef.current?.dispose();
    bridgeRef.current = null;
    try {
      const data = await notebookJson<NotebookSession>(api("session"));
      const file = data.draft?.artifact ?? data.template;
      const value = file
        ? await fetch(file.url).then((r) => {
            if (!r.ok) throw new Error(t("fileUnavailable"));
            return r.json();
          })
        : structuredClone(EMPTY_NOTEBOOK);
      const checked = validateNotebookDocument(value);
      const files = await Promise.all(
        data.datasets.map(async (d) => {
          const response = await fetch(d.url);
          if (!response.ok) throw new Error(t("fileUnavailable"));
          return { ...d, content: await response.text() };
        }),
      );
      if (!mounted.current) return;
      const loadedMode = data.config?.runtimeMode ?? "jupyterlite";
      const loadedReason = data.config?.colabReason ?? "";
      sessionRef.current = data;
      setSession(data);
      notebookRef.current = checked;
      setNotebook(checked);
      datasetsRef.current = files;
      setDatasets(files);
      modeRef.current = loadedMode;
      setMode(loadedMode);
      reasonRef.current = loadedReason;
      setReason(loadedReason);
      dirtyRef.current = false;
      autoSavePaused.current = false;
      setDirty(false);
      setRecoverable(null);
      setFrameKey((x) => x + 1);
      const key = `vfuture:notebook:${data.userId}:${data.courseVersionId ?? "studio"}:${locator.courseId}:${locator.itemId}:${locator.blockId ?? ""}`;
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const candidate = JSON.parse(cached) as RecoverySnapshot;
          if (
            JSON.stringify({
              notebook: candidate.notebook,
              mode: candidate.mode ?? loadedMode,
              reason: candidate.reason ?? loadedReason,
              datasets: candidate.datasets ?? files,
            }) !==
            JSON.stringify({
              notebook: checked,
              mode: loadedMode,
              reason: loadedReason,
              datasets: files,
            })
          )
            setRecoverable(candidate);
        }
      } catch {
        /* Remote draft remains authoritative. */
      }
    } catch (err) {
      if (mounted.current) report(err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api, locator, report, t]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      bridgeRef.current?.dispose();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [load]);
  useEffect(() => {
    const signedOut = (event: StorageEvent) => {
      if (event.key !== "vfuture:auth:signed-out") return;
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      sessionRef.current = null;
      setSession(null);
      setRuntimeReady(false);
      autoSavePaused.current = true;
      setError(t("sessionExpired"));
    };
    window.addEventListener("storage", signedOut);
    return () => window.removeEventListener("storage", signedOut);
  }, [t]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  // Learner: leaving with unsaved work (the focus bar, outline or pager) asks in-page first, the
  // same navigation-guard pattern the item player uses. Studio keeps its own back link.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pendingLeave = useRef<((leave: boolean) => void) | null>(null);
  const askLeave = useCallback(() => new Promise<boolean>((resolve) => {
    pendingLeave.current?.(false);
    pendingLeave.current = resolve;
    setLeaveOpen(true);
  }), []);
  const decideLeave = (leave: boolean) => {
    const resolve = pendingLeave.current;
    pendingLeave.current = null;
    setLeaveOpen(false);
    resolve?.(leave);
  };
  useEffect(() => {
    if (studio) return;
    const remove = registerNavigationGuard(async () => !dirtyRef.current || askLeave());
    return () => {
      remove();
      pendingLeave.current?.(false);
      pendingLeave.current = null;
    };
  }, [askLeave, studio]);
  const failRuntime = useCallback((message?: string) => {
    const bridge = bridgeRef.current;
    bridgeRef.current = null;
    bridge?.dispose();
    setRuntimeReady(false);
    setRuntimeFailed(true);
    if (message) setError(message);
  }, []);
  const connect = useCallback(() => {
    const frame = frameRef.current?.contentWindow;
    if (!frame || !runtimeUrl) return;
    if (bridgeRef.current && !bridgeRef.current.isClosed) return;
    bridgeRef.current?.dispose();
    setRuntimeReady(false);
    setRuntimeFailed(false);
    let initializing = false;
    const bridge = new NotebookBridge(
      frame,
      new URL(runtimeUrl).origin,
      updateNotebook,
      () => {
        if (initializing) return;
        initializing = true;
        void bridge
          .request("INIT", {
            notebook: notebookRef.current,
            datasets: datasetsRef.current.map((d) => ({
              filename: d.filename,
              content: d.content,
              format: "text",
            })),
            readOnly: false,
          })
          .then(() => setRuntimeReady(true))
          .catch(() => failRuntime(t("failed")));
      },
      (_message, code) => {
        if (code === "PAYLOAD_TOO_LARGE") {
          // The full source still lives in the frame. Never dispose it for a size error.
          autoSavePaused.current = true;
          dirtyRef.current = true;
          setDirty(true);
          setError(t("tooLarge"));
        } else failRuntime(t("failed"));
      },
    );
    bridgeRef.current = bridge;
  }, [failRuntime, runtimeUrl, updateNotebook, t]);
  const runtimeVisible = Boolean(
    session && runtimeUrl && (mode === "jupyterlite" || studio),
  );
  useEffect(() => {
    if (loading || !runtimeVisible || runtimeFailed) return;
    connect();
    const attached = bridgeRef.current;
    return () => {
      if (attached && bridgeRef.current === attached) {
        attached.dispose();
        bridgeRef.current = null;
      }
    };
  }, [connect, frameKey, loading, runtimeFailed, runtimeVisible]);
  useEffect(() => {
    if (loading || !runtimeVisible || runtimeFailed || runtimeReady) return;
    const timer = setTimeout(() => failRuntime(), 20_000);
    return () => clearTimeout(timer);
  }, [
    failRuntime,
    frameKey,
    loading,
    runtimeFailed,
    runtimeReady,
    runtimeVisible,
  ]);
  useEffect(() => {
    if (!runtimeUrl) return;
    const recover = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      const message = event.data as {
        channel?: unknown;
        version?: unknown;
        type?: unknown;
      } | null;
      if (
        event.origin !== new URL(runtimeUrl).origin ||
        event.source !== frame ||
        message?.channel !== "vfuture:notebook:v1" ||
        message.version !== 1 ||
        message.type !== "HELLO"
      )
        return;
      if (!bridgeRef.current || bridgeRef.current.isClosed) connect();
    };
    window.addEventListener("message", recover);
    return () => window.removeEventListener("message", recover);
  }, [connect, runtimeUrl]);
  const captureNotebook = useCallback(async () => {
    const bridge = bridgeRef.current;
    if (bridge) {
      const result = (await bridge.request("EXPORT")) as { notebook?: unknown };
      if (!result?.notebook) throw new Error(t("failed"));
      updateNotebook(result.notebook);
    }
    return validateNotebookDocument(notebookRef.current);
  }, [t, updateNotebook]);
  const save = useCallback(
    async (automatic = false): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      if (!automatic) autoSavePaused.current = false;
      try {
        const value = await captureNotebook();
        const sequence = editRevision.current;
        const blob = new Blob([JSON.stringify(value)], {
          type: "application/x-ipynb+json",
        });
        if (blob.size > 5 * 1024 * 1024) throw new Error(t("tooLarge"));
        const artifact = await uploadNotebookFile(
          locator,
          studio,
          blob,
          "notebook.ipynb",
          studio ? "template" : "draft",
          current.userId,
        );
        if (studio) {
          const profile =
            mode === "jupyterlite" ? "python-data-v1" : "colab-python-data-v1";
          const config = NotebookAssignmentSchema.parse({
            runtimeMode: mode,
            templateAssetId: artifact.id,
            templateChecksum: artifact.checksum,
            runtimeProfileId: profile,
            runtimeProfileVersion: "1",
            datasets: datasetsRef.current.map(
              ({ assetId, checksum, filename }) => ({
                assetId,
                checksum,
                filename,
              }),
            ),
            ...(mode === "colab_external" ? { colabReason: reason } : {}),
          });
          const result = await notebookJson<{
            revision: string;
            config: NotebookAssignment;
          }>(api("config"), {
            method: "PUT",
            headers: {
              "If-Match": current.studioRevision ?? "",
              "X-Notebook-Actor": current.userId,
            },
            body: JSON.stringify(config),
          });
          sessionRef.current = {
            ...current,
            config: result.config,
            studioRevision: result.revision,
          };
          setSession(sessionRef.current);
        } else {
          const result = await notebookJson<{ revision: number }>(
            api("draft"),
            {
              method: "PUT",
              headers: { "X-Notebook-Actor": current.userId },
              body: JSON.stringify({
                artifactId: artifact.id,
                expectedRevision: current.draft?.revision ?? 0,
              }),
            },
          );
          sessionRef.current = {
            ...current,
            draft: {
              revision: result.revision,
              artifact: {
                assetId: artifact.id,
                checksum: artifact.checksum,
                filename: artifact.filename,
                mime: "application/x-ipynb+json",
                sizeBytes: artifact.size_bytes,
                url: "",
              },
            },
          };
          setSession(sessionRef.current);
        }
        if (sequence === editRevision.current) {
          dirtyRef.current = false;
          setDirty(false);
          if (recoveryRef.current) localStorage.removeItem(recoveryRef.current);
        }
        setNotice(t("saved"));
        return true;
      } catch (err) {
        autoSavePaused.current = true;
        report(err);
        return false;
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [api, captureNotebook, locator, mode, reason, report, studio, t],
  );
  useEffect(() => {
    if (studio || !dirty || conflict || busy || autoSavePaused.current) return;
    saveTimer.current = setTimeout(() => {
      void save(true);
    }, 3000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [notebook, dirty, conflict, busy, save, studio]);
  const run = async (
    action: "RUN_SELECTED" | "RUN_ALL" | "INTERRUPT" | "RESTART",
  ) => {
    try {
      setError(null);
      await bridgeRef.current?.request(action);
    } catch {
      setError(t("failed"));
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(t("tooLarge"));
      if (!file.name.toLowerCase().endsWith(".ipynb"))
        throw new Error(t("invalidFile"));
      const value = validateNotebookDocument(JSON.parse(await file.text()));
      const meta = value.metadata.vfuture as
        | Record<string, unknown>
        | undefined;
      if (
        meta &&
        (meta.courseId !== locator.courseId ||
          meta.itemId !== locator.itemId ||
          (meta.blockId ?? null) !== locator.blockId)
      )
        throw new Error(t("wrongAssignment"));
      updateNotebook(value);
      setFrameKey((x) => x + 1);
      setNotice(t("imported"));
    } catch (err) {
      report(err);
    }
  };
  const uploadDataset = async (file: File | undefined) => {
    const current = sessionRef.current;
    if (!file || !current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (
        datasetsRef.current.length >= 20 ||
        file.size > 10 * 1024 * 1024 ||
        datasetsRef.current.reduce((n, d) => n + d.sizeBytes, 0) + file.size >
          20 * 1024 * 1024
      )
        throw new Error(t("datasetTooLarge"));
      if (datasetsRef.current.some((d) => d.filename === file.name))
        throw new Error(t("duplicateDataset"));
      const asset = await uploadNotebookFile(
        locator,
        true,
        file,
        file.name,
        "dataset",
        current.userId,
      );
      const next = [
        ...datasetsRef.current,
        {
          assetId: asset.id,
          checksum: asset.checksum,
          filename: asset.filename,
          sizeBytes: asset.size_bytes,
          content: await file.text(),
        },
      ];
      updateNotebook(await captureNotebook());
      datasetsRef.current = next;
      setDatasets(next);
      markEdited();
      setFrameKey((x) => x + 1);
    } catch (err) {
      report(err);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const submit = async () => {
    const current = sessionRef.current;
    const action = current?.assignment?.action;
    if (!current?.config || !action?.allowed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await captureNotebook();
      const sequence = editRevision.current;
      const artifact = await uploadNotebookFile(
        locator,
        false,
        new Blob([JSON.stringify(value)], { type: "application/x-ipynb+json" }),
        "submission.ipynb",
        "submission",
        current.userId,
      );
      const result = await notebookJson<AssignmentSubmitResult>(
        "/api/v1/assignments/submit",
        {
          method: "POST",
          headers: { "X-Notebook-Actor": current.userId },
          body: JSON.stringify({
            ...locator,
            expectedLatestSubmissionId: action.expectedLatestSubmissionId,
            payload: {
              notebook: {
                assetId: artifact.id,
                checksum: artifact.checksum,
                format: "ipynb",
                templateChecksum: current.config.templateChecksum,
                runtimeProfileId: current.config.runtimeProfileId,
                runtimeProfileVersion: current.config.runtimeProfileVersion,
              },
            },
          }),
        },
      );
      sessionRef.current = { ...current, assignment: result.session };
      setSession(sessionRef.current);
      setConfirmSubmit(false);
      setNotice(t("submitted"));
      if (sequence === editRevision.current) {
        dirtyRef.current = false;
        setDirty(false);
        if (recoveryRef.current) localStorage.removeItem(recoveryRef.current);
      }
    } catch (err) {
      report(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const downloadCurrent = async () => {
    const provenance = {
      ...locator,
      templateChecksum: sessionRef.current?.config?.templateChecksum,
    };
    const bridge = bridgeRef.current;
    if (bridge && !bridge.isClosed && runtimeReady) {
      try {
        await bridge.request("DOWNLOAD", {
          filename: "notebook.ipynb",
          provenance,
        });
      } catch (error) {
        report(error);
      }
      return;
    }
    const value = validateNotebookDocument(notebookRef.current);
    downloadNotebook({
      ...value,
      metadata: { ...value.metadata, vfuture: provenance },
    });
  };
  const back = studio
    ? `/studio/courses/${encodeURIComponent(locator.courseId)}`
    : `/app/courses/${encodeURIComponent(locator.courseId)}/items/${encodeURIComponent(locator.itemId)}`;
  const latestSubmission = session?.assignment?.submissions[0];
  const awaitingFeedback = refined && latestSubmission && !latestSubmission.grade &&
    (latestSubmission.status === "submitted" || latestSubmission.status === "in_review");
  const saveState = busy ? t("saving") : dirty ? t("unsaved") : (notice ?? t("ready"));
  return (
    <div className={refined
      ? "w-full min-w-0 space-y-6 text-foreground"
      : "mx-auto w-full max-w-7xl space-y-5 text-foreground"}>
      {refined ? (
        // The activity frame owns the heading (the item title) and the way back.
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
            {session ? <>{t("runtime")} · {mode === "jupyterlite" ? "JupyterLite" : "Google Colab"}</> : null}
          </p>
          <p role="status" className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground">
            {saveState}
          </p>
        </div>
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={back}
              className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
              onClick={(e) => {
                if (dirtyRef.current && !window.confirm(t("leaveUnsaved")))
                  e.preventDefault();
              }}
            >
              {t("back")}
            </Link>
            <h1 className="text-2xl font-semibold">{t("studioTitle")}</h1>
          </div>
          <p role="status" className="text-sm text-muted-foreground">{saveState}</p>
        </header>
      )}
      {refined ? (
        <Dialog.Root open={leaveOpen} onOpenChange={(open) => { if (!open) decideLeave(false); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-[8px] border border-border border-l-2 border-l-warning-border bg-card p-6 text-card-foreground">
              <Dialog.Title className="text-xl font-medium">{t("leaveTitle")}</Dialog.Title>
              <Dialog.Description className="text-sm leading-6 text-muted-foreground">{t("leaveUnsaved")}</Dialog.Description>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="vf-btn vf-btn-primary vf-btn-lg" onClick={() => decideLeave(false)}>{t("stay")}</button>
                <button type="button" className="vf-btn vf-btn-lg" onClick={() => decideLeave(true)}>{t("leaveAnyway")}</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
      {awaitingFeedback ? <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t("submitted")}</div> : null}
      {error ? (
        <div
          role="alert"
          className={refined
            ? "rounded-lg border border-destructive/40 border-l-[3px] bg-card p-4 min-[760px]:p-5"
            : "rounded-lg border border-destructive/40 bg-card p-4"}
        >
          <p className="text-sm text-destructive">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={button} onClick={() => void downloadCurrent()}>
              {t("downloadCopy")}
            </button>
            <button
              className={button}
              onClick={() => {
                if (!dirtyRef.current) void load();
                else if (refined) void askLeave().then((leave) => { if (leave) void load(); });
                else if (window.confirm(t("leaveUnsaved"))) void load();
              }}
            >
              {t("reload")}
            </button>
            {!conflict && session ? (
              <button
                className={button}
                onClick={() => void save(false)}
                disabled={busy}
              >
                {t("retrySave")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {recoverable ? (
        <div
          role="status"
          className={refined
            ? "rounded-lg border border-primary/50 bg-card p-4 min-[760px]:p-5"
            : "rounded-lg border border-border bg-card p-4"}
        >
          <p>{t("recoveryFound")}</p>
          <button
            className={button}
            onClick={() => {
              if (recoverable.mode) {
                modeRef.current = recoverable.mode;
                setMode(recoverable.mode);
              }
              if (recoverable.reason !== undefined) {
                reasonRef.current = recoverable.reason;
                setReason(recoverable.reason);
              }
              if (recoverable.datasets) {
                datasetsRef.current = recoverable.datasets;
                setDatasets(recoverable.datasets);
              }
              updateNotebook(recoverable.notebook);
              setRecoverable(null);
              setFrameKey((x) => x + 1);
            }}
          >
            {t("restore")}
          </button>
          <button
            className={button}
            onClick={() => {
              setRecoverable(null);
              if (recoveryRef.current)
                localStorage.removeItem(recoveryRef.current);
            }}
          >
            {t("keepCloud")}
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className={refined
          ? "h-96 rounded-md border border-border bg-card"
          : "h-96 rounded-xl bg-muted"} aria-label={t("loading")} />
      ) : session ? (
        <>
          {studio ? (
            <section className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
              <label className="text-sm font-medium">
                {t("runtime")}
                <select
                  className="mt-2 block min-h-11 rounded-lg border border-input bg-background px-3"
                  value={mode}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as typeof mode;
                    modeRef.current = next;
                    setMode(next);
                    markEdited();
                  }}
                >
                  <option value="jupyterlite">JupyterLite</option>
                  <option value="colab_external">Google Colab</option>
                </select>
              </label>
              {mode === "colab_external" ? (
                <label className="min-w-64 flex-1 text-sm font-medium">
                  {t("reason")}
                  <input
                    className="mt-2 block min-h-11 w-full rounded-lg border border-input bg-background px-3"
                    value={reason}
                    disabled={busy}
                    onChange={(e) => {
                      reasonRef.current = e.target.value;
                      setReason(e.target.value);
                      markEdited();
                    }}
                  />
                </label>
              ) : null}
              <label className={button}>
                {t("addDataset")}
                <input
                  type="file"
                  accept=".csv,.json"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => void uploadDataset(e.target.files?.[0])}
                />
              </label>
            </section>
          ) : null}
          <div className={refined
            ? "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between"
            : "flex flex-wrap gap-2"}>
            <div role={refined ? "group" : undefined} aria-label={refined ? `${t("import")} / ${t("download")}` : undefined} className="flex flex-wrap gap-2">
              <label className={refined
                ? `${button} focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring`
                : button}>
                {t("import")}
                <input
                  type="file"
                  accept=".ipynb"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button className={button} onClick={() => void downloadCurrent()}>
                {t("download")}
              </button>
            </div>
            <div role={refined ? "group" : undefined} aria-label={refined ? `${t("save")} / ${t("submit")}` : undefined} className="flex flex-wrap gap-2">
              <button
                className={refined ? button : primary}
                onClick={() => void save(false)}
                disabled={busy || conflict}
              >
                {studio ? t("saveTemplate") : t("save")}
              </button>
              {!studio ? (
                <button
                  className={primary}
                  onClick={() => setConfirmSubmit(true)}
                  disabled={
                    busy || conflict || !session.assignment?.action.allowed
                  }
                >
                  {t("submit")}
                </button>
              ) : null}
            </div>
          </div>
          {confirmSubmit ? (
            <section
              role="region"
              aria-label={t("confirmTitle")}
              className={refined
                ? "rounded-lg border border-primary bg-card p-5"
                : "rounded-lg border border-primary bg-card p-5"}
            >
              <h2 className="font-semibold">{t("confirmTitle")}</h2>
              <p className="my-3 text-sm">{t("confirmBody")}</p>
              <div className={refined ? "flex flex-wrap gap-2" : undefined}>
                <button
                  className={primary}
                  onClick={() => void submit()}
                  disabled={busy}
                >
                  {t("confirmSubmit")}
                </button>
                <button
                  className={button}
                  onClick={() => setConfirmSubmit(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </section>
          ) : null}
          {datasets.length ? (
            <section className={refined ? "rounded-lg border border-border bg-card p-4 min-[760px]:p-5" : undefined}>
              <h2 className={refined ? "text-base font-semibold" : "text-sm font-semibold"}>{t("datasets")}</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {datasets.map((d) => (
                  <li
                    key={d.assetId}
                    className={refined
                      ? "min-w-0 max-w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      : "rounded-lg border border-border px-3 py-2 text-sm"}
                  >
                    <button
                      className={refined
                        ? "min-h-11 break-all text-left underline underline-offset-4"
                        : "min-h-11 underline"}
                      onClick={() => {
                        const url = URL.createObjectURL(new Blob([d.content]));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = d.filename;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      {d.filename}
                    </button>
                    {studio ? (
                      <button
                        className="ml-3 min-h-11 text-destructive"
                        aria-label={t("removeDataset", { name: d.filename })}
                        disabled={busy}
                        onClick={async () => {
                          if (busyRef.current) return;
                          busyRef.current = true;
                          setBusy(true);
                          try {
                            updateNotebook(await captureNotebook());
                            const next = datasetsRef.current.filter(
                              (x) => x.assetId !== d.assetId,
                            );
                            datasetsRef.current = next;
                            setDatasets(next);
                            markEdited();
                            setFrameKey((x) => x + 1);
                          } catch (error) {
                            report(error);
                          } finally {
                            busyRef.current = false;
                            setBusy(false);
                          }
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {mode === "colab_external" ? (
            <section className={refined
              ? "space-y-4 rounded-lg border border-border bg-card p-5"
              : "space-y-4 rounded-xl border border-border bg-card p-5"}>
              <h2 className="text-lg font-semibold">{t("colabTitle")}</h2>
              <p className="max-w-3xl text-sm leading-7">
                {t("colabInstructions")}
              </p>
              <a
                href="https://colab.research.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={button}
              >
                {t("openColab")}
              </a>
              <p className="text-sm text-muted-foreground">
                {t("colabNotice")}
              </p>
            </section>
          ) : null}
          {runtimeFailed ? (
            <section className={refined
              ? "space-y-3 rounded-lg border border-border bg-card p-5"
              : "space-y-3 rounded-xl border border-border bg-card p-5"}>
              <p className="text-sm text-muted-foreground">
                {t("runtimeUnavailable")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  onClick={() => void downloadCurrent()}
                >
                  {t("download")}
                </button>
                <button
                  className={button}
                  onClick={() => {
                    setError(null);
                    setRuntimeFailed(false);
                    setRuntimeReady(false);
                    setFrameKey((x) => x + 1);
                  }}
                >
                  {t("retryRuntime")}
                </button>
              </div>
              <NotebookViewer notebook={notebook} locale={locale} />
            </section>
          ) : (mode === "jupyterlite" || studio) && runtimeUrl ? (
            <section
              aria-label={refined ? t("editor") : undefined}
              className={refined
                ? "min-w-0 space-y-4 rounded-lg border border-border bg-card p-3 min-[760px]:p-5"
                : "space-y-3"}
            >
              {refined ? <h2 className="text-base font-semibold">{t("editor")}</h2> : null}
              {mode === "jupyterlite" ? (
                <>
                  <div className={refined
                    ? "flex flex-wrap gap-2 border-b border-border pb-4"
                    : "flex flex-wrap gap-2"}>
                    <button
                      className={button}
                      disabled={!runtimeReady}
                      onClick={() => void run("RUN_SELECTED")}
                    >
                      {t("run")}
                    </button>
                    <button
                      className={button}
                      disabled={!runtimeReady}
                      onClick={() => void run("RUN_ALL")}
                    >
                      {t("runAll")}
                    </button>
                    <button
                      className={button}
                      disabled={!runtimeReady}
                      onClick={() => void run("INTERRUPT")}
                    >
                      {t("stop")}
                    </button>
                    <button
                      className={button}
                      disabled={!runtimeReady}
                      onClick={() => {
                        if (window.confirm(t("restartConfirm")))
                          void run("RESTART");
                      }}
                    >
                      {t("restart")}
                    </button>
                  </div>
                  <p className={refined
                    ? "text-xs leading-5 text-muted-foreground"
                    : "text-xs text-muted-foreground"}>
                    {t("kernelNotice")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("previewOnly")}
                </p>
              )}
              <iframe
                key={frameKey}
                ref={frameRef}
                title={t("editor")}
                src={runtimeUrl}
                sandbox="allow-scripts allow-same-origin allow-downloads"
                allow="cross-origin-isolated"
                referrerPolicy="no-referrer"
                onError={() => failRuntime()}
                className={refined
                  ? "h-[70dvh] min-h-96 w-full rounded-md border border-border bg-background"
                  : "h-[70dvh] min-h-96 w-full rounded-xl border border-border bg-card"}
              />
            </section>
          ) : (
            <section className={refined ? "min-w-0 space-y-3 rounded-lg border border-border bg-card p-5" : undefined}>
              <p className="text-sm text-muted-foreground">
                {mode === "jupyterlite"
                  ? t("runtimeUnavailable")
                  : t("previewOnly")}
              </p>
              <NotebookViewer notebook={notebook} locale={locale} />
            </section>
          )}
          {session.assignment?.submissions[0]?.grade ? (
            <section className={refined
              ? "rounded-lg border border-border bg-card p-5"
              : "rounded-lg border border-border bg-card p-4"}>
              <h2 className="font-semibold">{t("feedback")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {typeof session.assignment.submissions[0].grade.feedback ===
                "string"
                  ? session.assignment.submissions[0].grade.feedback
                  : session.assignment.submissions[0].grade.feedback[locale]}
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
