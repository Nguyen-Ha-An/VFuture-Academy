"use client";

import { ArchiveRestore, Download, History, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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

export function VersionsDrawer({ courseId, refreshKey, disabled = false, readOnly = false, onRestored, beforeRestore, className }: {
  courseId: string;
  refreshKey: number;
  disabled?: boolean;
  readOnly?: boolean;
  onRestored: (snapshot: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null }) => void | Promise<void>;
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
    if (disabled || !window.confirm(t("confirmRestore", { version }))) return;
    setRestoring(version);
    setError(null);
    try {
      if (beforeRestore && !await beforeRestore()) return;
      const snapshot = await readApiData<{ manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null }>(await fetch(`/api/v1/studio/courses/${encodeURIComponent(courseId)}/versions/${version}`));
      await onRestored(snapshot);
      setOpen(false);
    } catch (cause) {
      setError(workspaceErrorMessage(cause, t("genericError")));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button disabled={disabled} className={className ?? "bg-secondary text-secondary-foreground shadow-none hover:bg-accent"}><History aria-hidden="true" className="mr-2 size-4" />{t("trigger")}</Button></SheetTrigger>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-50 bg-black/45" />
        <SheetContent className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,32rem)] flex-col border-l border-border bg-card p-6 shadow-2xl focus:outline-none">
          <SheetTitle className="text-xl font-semibold">{t("title")}</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted-foreground">{t("description")}</SheetDescription>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
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
                    {!readOnly ? <Button onClick={() => void restore(version.version)} disabled={disabled || restoring !== null} className="min-h-9 bg-secondary px-3 text-secondary-foreground shadow-none hover:bg-accent"><ArchiveRestore aria-hidden="true" className="mr-1.5 size-3.5" />{restoring === version.version ? t("restoring") : t("restore")}</Button> : null}
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
