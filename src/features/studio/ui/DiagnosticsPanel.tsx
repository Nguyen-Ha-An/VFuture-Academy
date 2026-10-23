"use client";

import { Check, Clipboard, CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDiagnostic, type Diagnostic, type Range, type ValidationReport } from "@/content-engine/diagnostics";

export function DiagnosticsPanel({ report, locale, onSelect }: {
  report: ValidationReport;
  locale: "vi" | "en";
  /** The diagnostic itself comes last, so a path-only diagnostic can be opened exactly. */
  onSelect: (docId: string, range: Range | undefined, diagnostic: Diagnostic) => void;
}) {
  const t = useTranslations("workspace.diagnostics");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const diagnostics = [...report.errors, ...report.warnings];

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const copyReport = async () => {
    const text = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, locale)).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, 2_000);
    } catch {
      setCopied(false);
      setCopyError(t("copyError"));
    }
  };

  return (
    <section aria-label={t("label")} className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <span className="text-xs tabular-nums text-destructive">{report.errors.length} {t("error")}</span>
          <span className="text-xs tabular-nums text-warning-foreground">{report.warnings.length} {t("warning")}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void copyReport()} disabled={!diagnostics.length}>
          {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </header>
      {copyError ? <p role="alert" className="border-b border-destructive/40 px-3 py-2 text-xs text-destructive">{copyError}</p> : null}
      <p className="sr-only" aria-live="polite">{copied ? t("copied") : ""}</p>

      {diagnostics.length ? (
        <div className="min-h-0 overflow-auto">
          <table className="w-full min-w-[42rem] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t("severity")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("document")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("location")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("message")}</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((diagnostic, index) => {
                const isError = diagnostic.severity === "error";
                const location = diagnostic.range
                  ? t("line", { line: diagnostic.range.start.line, col: diagnostic.range.start.col })
                  : t("pathOnly", { path: diagnostic.path || "/" });
                return (
                  <tr key={`${diagnostic.docId}-${diagnostic.code}-${diagnostic.path}-${index}`} className="border-b border-border/70 align-top hover:bg-muted/60">
                    <td className={isError ? "px-3 py-2 text-destructive" : "px-3 py-2 text-warning-foreground"}>
                      <span className="inline-flex items-center gap-1.5">
                        {isError ? <CircleAlert aria-hidden="true" className="size-3.5" /> : <TriangleAlert aria-hidden="true" className="size-3.5" />}
                        {t(isError ? "error" : "warning")}
                      </span>
                    </td>
                    <td className="break-all px-3 py-2">{diagnostic.docId}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{location}</td>
                    <td className="p-0">
                      <button
                        type="button"
                        aria-label={t("select", { code: diagnostic.code, docId: diagnostic.docId })}
                        onClick={() => onSelect(diagnostic.docId, diagnostic.range, diagnostic)}
                        className="min-h-10 w-full px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring"
                      >
                        <span className="mr-2 font-medium">{diagnostic.code}</span>
                        {diagnostic.message[locale]}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"><Check aria-hidden="true" className="size-4 text-success-foreground" />{t("empty")}</div>
      )}
    </section>
  );
}
