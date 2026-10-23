"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { NotebookViewer } from "./NotebookViewer";
import {
  notebookJson,
  downloadNotebook,
  type SignedNotebookFile,
} from "../client";
export function NotebookSubmissionPreview({
  submissionId,
}: {
  submissionId: string;
}) {
  const t = useTranslations("notebook");
  const locale = useLocale() === "en" ? "en" : "vi";
  const [value, setValue] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function open() {
    setBusy(true);
    setError(false);
    try {
      const file = await notebookJson<SignedNotebookFile>(
        `/api/v1/notebooks/submissions/${encodeURIComponent(submissionId)}`,
      );
      const r = await fetch(file.url);
      if (!r.ok) throw new Error();
      setValue(await r.json());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {value ? (
        <>
          <button
            className="min-h-11 text-sm text-primary underline"
            onClick={() => downloadNotebook(value)}
          >
            {t("download")}
          </button>
          <NotebookViewer notebook={value} locale={locale} />
        </>
      ) : (
        <button
          className="min-h-11 rounded-lg border border-border px-4 text-sm"
          disabled={busy}
          onClick={() => void open()}
        >
          {busy ? t("loading") : t("reviewNotebook")}
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("fileUnavailable")}
        </p>
      ) : null}
    </div>
  );
}
