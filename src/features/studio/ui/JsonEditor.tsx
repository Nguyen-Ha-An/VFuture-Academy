"use client";

import { json } from "@codemirror/lang-json";
import { forceLinting, linter, type Diagnostic as CodeMirrorDiagnostic } from "@codemirror/lint";
import { EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { ClipboardPaste, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/classic";
import { refKey, refLabel, refOf, toRef, type Diagnostic, type DocumentRef, type Range } from "@/content-engine/diagnostics";
import { validateDocument } from "@/content-engine/validate";
import { parseJsonDocument, pointerToRange } from "@/content-engine/validate/parse";

/**
 * Editor diagnostics for one raw document, from the same strict parser and schema
 * the server uses. There is deliberately no separate editor parser: a duplicate
 * key, a BOM, a code fence or an overflowing number has to look exactly as wrong
 * in the gutter as it does on save, and `pointerToRange` reuses the syntax tree
 * that parse already built to point at the offending text.
 */
export function structuralDiagnosticsForSource(source: string, doc: string | DocumentRef): Diagnostic[] {
  const ref = toRef(doc);
  const parsed = parseJsonDocument(source, ref);
  if (parsed.errors.length) return parsed.errors.slice(0, 5);
  const result = validateDocument(parsed.value, refLabel(ref));
  if (result.ok) return [];
  return result.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    ref,
    range: diagnostic.range ?? pointerToRange(parsed, diagnostic.path),
  }));
}

function positionOffset(doc: Text, line: number, col: number): number {
  const editorLine = doc.line(Math.max(1, Math.min(doc.lines, line)));
  return Math.min(editorLine.to, editorLine.from + Math.max(0, col - 1));
}

function focusDiagnostic(view: EditorView, range: Range): void {
  const from = positionOffset(view.state.doc, range.start.line, range.start.col);
  const to = Math.max(from, positionOffset(view.state.doc, range.end.line, range.end.col));
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
}

export function mapDiagnosticsToCodeMirror(
  doc: Text,
  diagnostics: readonly Diagnostic[],
  doc_: string | DocumentRef,
  locale: "vi" | "en",
): CodeMirrorDiagnostic[] {
  const key = refKey(toRef(doc_));
  return diagnostics.filter((diagnostic) => refKey(refOf(diagnostic)) === key).map((diagnostic) => {
    const from = diagnostic.range
      ? positionOffset(doc, diagnostic.range.start.line, diagnostic.range.start.col)
      : 0;
    const requestedTo = diagnostic.range
      ? positionOffset(doc, diagnostic.range.end.line, diagnostic.range.end.col)
      : Math.min(1, doc.length);
    return {
      from,
      to: Math.max(from, requestedTo),
      severity: diagnostic.severity,
      source: diagnostic.code,
      message: diagnostic.message[locale],
    };
  });
}

const EDITOR_SETUP = { foldGutter: true, lineNumbers: true, highlightActiveLine: true };

export function JsonEditor({
  source,
  docRef,
  diagnostics,
  locale,
  focusRange,
  readOnly = false,
  onChange,
}: {
  source: string;
  docRef: DocumentRef;
  diagnostics: readonly Diagnostic[];
  locale: "vi" | "en";
  saveState: string;
  focusRange?: Range;
  readOnly?: boolean;
  onChange: (source: string) => void;
}) {
  const t = useTranslations("workspace.editor");
  const viewRef = useRef<EditorView | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const docId = refLabel(docRef);
  const docKey = refKey(docRef);
  // The clipboard read is asynchronous; the author may select a different document
  // before it resolves. The key captured at click time decides whether the text is
  // still destined for the document that is on screen.
  const activeKey = useRef(docKey);
  activeKey.current = docKey;
  const lintContext = useRef({ diagnostics, docRef, locale });
  lintContext.current = { diagnostics, docRef, locale };
  const changeCallback = useRef(onChange);
  changeCallback.current = onChange;
  const changeSource = useCallback((value: string) => changeCallback.current(value), []);
  const extensions = useMemo(() => [
    json(),
    linter((view) => {
      const currentSource = view.state.doc.toString();
      const current = lintContext.current;
      return mapDiagnosticsToCodeMirror(view.state.doc, [
        ...current.diagnostics,
        ...structuralDiagnosticsForSource(currentSource, current.docRef),
      ], current.docRef, current.locale);
    }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      "aria-label": t("accessibleName", { docId }),
      "aria-readonly": String(readOnly),
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "13px" },
      ".cm-scroller": { overflow: "auto", overscrollBehavior: "contain", fontFamily: "var(--font-mono)" },
      ".cm-gutters": { backgroundColor: "var(--muted)", borderRight: "1px solid var(--border)" },
      "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" },
    }),
  ], [docId, readOnly, t]);

  useEffect(() => {
    // Refresh diagnostics without rebuilding CodeMirror's parser, theme and view.
    const timer = window.setTimeout(() => {
      const view = viewRef.current;
      if (view?.dom.isConnected) forceLinting(view);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [diagnostics, docKey, locale]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focusRange) return;
    focusDiagnostic(view, focusRange);
  }, [focusRange]);

  /**
   * Re-indents without reinterpreting. The strict parser runs first, because
   * `JSON.parse` would quietly discard the losing half of a duplicate key and turn
   * an overflowing literal into `Infinity` — the reformatted text would then look
   * clean while the author's own content had been thrown away. Text the strict
   * parser rejects is left byte-for-byte as typed and the reason is shown instead.
   *
   * Schema validity is a separate question: syntactically sound text still formats,
   * with every field it declares, valid or not, preserved.
   */
  const format = () => {
    const parsed = parseJsonDocument(source, docRef);
    if (parsed.errors.length) {
      setLocalError(`${t("formatError")} ${parsed.errors[0].message[locale]}`.trim());
      return;
    }
    onChange(JSON.stringify(parsed.value, null, 2));
    setLocalError(null);
  };

  const pasteReplace = async () => {
    const requestedKey = docKey;
    try {
      const value = await navigator.clipboard.readText();
      // A late clipboard result must never be written into whatever document
      // happens to be selected now.
      if (activeKey.current !== requestedKey) return;
      onChange(value);
      setLocalError(null);
    } catch {
      if (activeKey.current !== requestedKey) return;
      setLocalError(t("pasteError"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-xs font-medium [.vf-staff_&]:font-sans [.vf-staff_&]:leading-[1.4] [.vf-staff_&]:text-muted-foreground">{docId}</h2>

        </div>
        {!readOnly ? <div className="flex gap-1">
          <Button onClick={format} className="min-h-9 bg-secondary px-3 text-secondary-foreground shadow-none hover:bg-accent"><WandSparkles aria-hidden="true" className="mr-1.5 size-3.5" />{t("format")}</Button>
          <Button onClick={() => void pasteReplace()} className="min-h-9 bg-secondary px-3 text-secondary-foreground shadow-none hover:bg-accent"><ClipboardPaste aria-hidden="true" className="mr-1.5 size-3.5" />{t("pasteReplace")}</Button>
        </div> : null}
      </header>
      {localError ? <p role="alert" className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{localError}</p> : null}
      <div className="min-h-0 flex-1 overflow-hidden bg-card">
        <CodeMirror
          className="h-full min-h-0"
          value={source}
          height="100%"
          extensions={extensions}
          indentWithTab={false}
          basicSetup={EDITOR_SETUP}
          onCreateEditor={(view) => {
            viewRef.current = view;
            if (focusRange) focusDiagnostic(view, focusRange);
          }}
          onChange={changeSource}
        />
      </div>
    </div>
  );
}
