"use client";

import { ArchiveRestore, Download, History, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/classic";
import { readApiData, workspaceErrorMessage } from "./client";

type CourseVersion = {
  id?: string;
  version: number;
  checksum?: string;
  summary?: unknown;
  published_by?: string;
  published_at?: string;
  notes?: string | null;
};

export function VersionsDrawer({ courseId, refreshKey, disabled = false, restoreDisabled = false, readOnly = false, onRestored, beforeRestore, className }: {
  courseId: string;
  refreshKey: number;
  disabled?: boolean;
  readOnly?: boolean;
  restoreDisabled?: boolean;
  onRestored: (snapshot: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null }) => boolean | Promise<boolean>;
  beforeRestore?: () => Promise<boolean>;
  className?: string;
}) {
  const t = useTranslations("workspace.versions");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<CourseVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  const identity = useRef(courseId);
  if (identity.current !== courseId) {
    identity.current = courseId;
    operation.current += 1;
  }
  const current = useRef({ courseId, open, disabled, restoreDisabled, readOnly, onRestored, beforeRestore });
  current.current = { courseId, open, disabled, restoreDisabled, readOnly, onRestored, beforeRestore };
  useEffect(() => () => { operation.current += 1; current.current.open = false; }, []);
  useEffect(() => { setRestoring(null); }, [courseId]);
  const changeOpen = (next: boolean) => {
    if (next !== current.current.open) {
      operation.current += 1;
      setRestoring(null);
    }
    current.current.open = next;
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/v1/studio/courses/${encodeURIComponent(courseId)}/versions`, { signal: controller.signal })
      .then((response) => readApiData<CourseVersion[]>(response))
      .then(setVersions)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(workspaceErrorMessage(cause, t("genericError")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, open, refreshKey, t]);

  const restore = async (version: number) => {
    const allowed = () => current.current.open && !current.current.disabled && !current.current.restoreDisabled && !current.current.readOnly;
    if (!allowed()) { setError(t("restoreBlocked")); return; }
    if (!window.confirm(t("confirmRestore", { version }))) { setError(t("restoreCancelled")); return; }
    const token = ++operation.current;
    const isCurrent = () => token === operation.current && current.current.courseId === courseId;
    setRestoring(version);
    setError(null);
    try {
      const guard = current.current.beforeRestore;
      const permitted = !guard || await guard();
      if (!isCurrent()) return;
      if (!permitted) { setError(t("restoreCancelled")); return; }
      if (!allowed()) { if (current.current.open) setError(t("restoreBlocked")); return; }
      const snapshot = await readApiData<{ manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null }>(await fetch(`/api/v1/studio/courses/${encodeURIComponent(courseId)}/versions/${version}`));
      if (!isCurrent()) return;
      if (!allowed()) { if (current.current.open) setError(t("restoreBlocked")); return; }
      const applied = await current.current.onRestored(snapshot);
      if (!isCurrent()) return;
      if (applied === true) changeOpen(false);
      else if (current.current.open) setError(t("restoreNotApplied"));
    } catch (cause) {
      if (isCurrent() && current.current.open) setError(workspaceErrorMessage(cause, t("restoreError")));
    } finally {
      if (isCurrent()) setRestoring(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild><Button disabled={disabled} className={className ?? "bg-secondary text-secondary-foreground shadow-none hover:bg-accent"}><History aria-hidden="true" className="mr-2 size-4" />{t("trigger")}</Button></SheetTrigger>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-50 bg-black/45" />
        <SheetContent className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,32rem)] flex-col border-l border-border bg-card p-6 shadow-2xl focus:outline-none">
          <SheetTitle className="text-xl font-semibold">{t("title")}</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted-foreground">{t("description")}</SheetDescription>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
            {restoreDisabled && !readOnly ? <p role="status" className="mb-3 text-sm text-muted-foreground">{t("restoreBlocked")}</p> : null}
            {loading ? <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{t("loading")}</p> : null}
            {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
            {!loading && !versions.length && !error ? <p className="py-8 text-sm text-muted-foreground">{t("empty")}</p> : null}
            <ol className="space-y-3">
              {versions.map((version) => (
                <li key={version.id ?? version.version} className="rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{t("version", { version: version.version })}</h3>
                      {version.published_at ? <p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.published_at))}</p> : null}
                      {version.checksum ? <p className="mt-2 truncate font-mono text-[0.65rem] text-muted-foreground" title={version.checksum}>{version.checksum}</p> : null}
                    </div>
                    {!readOnly ? <Button onClick={() => void restore(version.version)} disabled={disabled || restoreDisabled || restoring !== null} className="min-h-9 bg-secondary px-3 text-secondary-foreground shadow-none hover:bg-accent"><ArchiveRestore aria-hidden="true" className="mr-1.5 size-3.5" />{restoring === version.version ? t("restoring") : t("restore")}</Button> : null}
                  </div>
                  {version.notes ? <p className="mt-3 text-sm text-muted-foreground">{version.notes}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                    <a download href={`/api/v1/studio/courses/${encodeURIComponent(courseId)}/export?version=${version.version}&format=bundle`} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Download aria-hidden="true" className="mr-1.5 size-3.5" />{t("exportBundle")}</a>
                    <a download href={`/api/v1/studio/courses/${encodeURIComponent(courseId)}/export?version=${version.version}&format=single`} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Download aria-hidden="true" className="mr-1.5 size-3.5" />{t("exportSingle")}</a>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-5 flex justify-end border-t border-border pt-4"><SheetClose asChild><Button className="bg-secondary text-secondary-foreground shadow-none hover:bg-accent">{t("close")}</Button></SheetClose></div>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
