"use client";

import { FileJson2, Import } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Diagnostic } from "@/content-engine/diagnostics";
import {
  decodeAnyImport, decodeItemImport, decodeRawSourceRecovery,
  type DecodedImport, type ImportSnapshot,
} from "../content-transfer";
import { readApiData, workspaceErrorMessage } from "./client";
import { dialogMessages, itemKindLabels, replaceMessage } from "./dialog-messages";
import { cn } from "@/lib/ui-cn";

type ItemKind = "lesson" | "exam" | "assignment";
type ItemDocument = Record<string, unknown> & { id: string; kind: ItemKind };
type ChangeSummary = { additions: string[]; changes: string[]; removals: string[] };
type ImportMode = "course" | "item" | "recovery";
type RecoverySources = { courseId: string; sources: Record<string, string> };
/**
 * The HTTP/file envelope limit, deliberately larger than the 1 MiB limit on one
 * content document: a recovery or workspace envelope legitimately carries several
 * documents, while each document inside it is still capped individually.
 */
const MAX_JSON_FILE_BYTES = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function localizedText(value: unknown, locale: "en" | "vi"): string | null {
  if (typeof value === "string") return value;
  const row = object(value);
  return typeof row?.[locale] === "string" ? row[locale] as string : typeof row?.en === "string" ? row.en as string : null;
}

function itemKind(value: unknown): ItemKind | null {
  const kind = object(value)?.kind;
  return kind === "lesson" || kind === "exam" || kind === "assignment" ? kind : null;
}

function referencedKind(manifest: unknown, id: string): ItemKind | null {
  const modules = object(manifest)?.modules;
  if (!Array.isArray(modules)) return null;
  for (const moduleValue of modules) {
    const entries = object(moduleValue)?.items;
    if (!Array.isArray(entries)) continue;
    const match = entries.map(object).find((entry) => entry?.id === id);
    const type = match?.type;
    if (type === "lesson" || type === "exam" || type === "assignment") return type;
  }
  return null;
}

function ids(manifest: unknown, items: Record<string, unknown>): Set<string> {
  const result = new Set(Object.keys(items));
  const modules = object(manifest)?.modules;
  if (Array.isArray(modules)) for (const moduleValue of modules) {
    const entries = object(moduleValue)?.items;
    if (Array.isArray(entries)) for (const entry of entries) {
      const id = object(entry)?.id;
      if (typeof id === "string") result.add(id);
    }
  }
  return result;
}

function summarize(current: ImportSnapshot, next: ImportSnapshot): ChangeSummary {
  const currentIds = ids(current.manifest, current.items);
  const nextIds = ids(next.manifest, next.items);
  const additions = [...nextIds].filter((id) => !currentIds.has(id)).sort();
  const removals = [...currentIds].filter((id) => !nextIds.has(id)).sort();
  const changes = [...nextIds].filter((id) => currentIds.has(id) && JSON.stringify(current.items[id]) !== JSON.stringify(next.items[id])).sort().map((id) => `item:${id}`);
  const currentManifest = object(current.manifest) ?? {};
  const nextManifest = object(next.manifest) ?? {};
  const manifestKeys = new Set([...Object.keys(currentManifest), ...Object.keys(nextManifest)]);
  changes.unshift(...[...manifestKeys].filter((key) => JSON.stringify(currentManifest[key]) !== JSON.stringify(nextManifest[key])).sort().map((key) => `course.${key}`));
  return { additions, changes, removals };
}

export function manifestWithImportedItem(manifest: unknown, itemValue: unknown, moduleId: string): unknown {
  const item = object(itemValue) as ItemDocument | null;
  const root = object(manifest);
  if (!root || !item || !itemKind(item)) return manifest;
  const next = structuredClone(root);
  const modules = Array.isArray(next.modules) ? next.modules : [];
  const existingStub = modules.flatMap((moduleValue) => Array.isArray(object(moduleValue)?.items) ? object(moduleValue)!.items as unknown[] : []).map(object).find((entry) => entry?.id === item.id);
  let inserted = false;
  next.modules = modules.map((moduleValue) => {
    const moduleRow = object(moduleValue);
    if (!moduleRow) return moduleValue;
    const entries = Array.isArray(moduleRow.items) ? moduleRow.items.filter((entry) => object(entry)?.id !== item.id) : [];
    if (moduleRow.id === moduleId) {
      inserted = true;
      entries.push({ ...existingStub, id: item.id, type: item.kind, ...(item.title === undefined ? {} : { title: item.title }) });
    }
    return { ...moduleRow, items: entries };
  });
  return inserted ? next : manifest;
}

export function ImportDialog({ courseId, manifest, items, disabled = false, beforeReplace, onApply, onApplyItem, onApplySources, className, canCreate = false, createOnly = false }: {
  courseId: string;
  manifest: unknown;
  items: Record<string, unknown>;
  disabled?: boolean;
  beforeReplace?: () => Promise<boolean>;
  /** Whole-course replace: the workspace is rebuilt from this snapshot. */
  onApply: (snapshot: ImportSnapshot) => void;
  /**
   * Single item: only this document and the manifest change. Without it the
   * dialog falls back to rebuilding a snapshot, which would discard unrelated
   * invalid text, so the workspace always passes this.
   */
  onApplyItem?: (document: unknown, moduleId: string) => void;
  /** Explicit raw-source recovery import; the text stays local until it is valid. */
  onApplySources?: (sources: Record<string, string>) => void;
  className?: string;
  canCreate?: boolean;
  createOnly?: boolean;
}) {
  const router = useRouter();
  const locale = useLocale() === "vi" ? "vi" : "en";
  const m = dialogMessages[locale].import;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("course");
  const [courseIntent, setCourseIntent] = useState<"replace" | "create">(createOnly ? "create" : "replace");
  const [source, setSource] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const fileReadId = useRef(0);
  const busyRef = useRef(false);
  const modules = useMemo(() => {
    const rows = object(manifest)?.modules;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((value) => {
      const row = object(value);
      return row && typeof row.id === "string" ? [{ id: row.id, label: localizedText(row.title, locale) ?? row.id }] : [];
    });
  }, [manifest, locale]);

  /**
   * All decoding lives in `content-transfer`: one strict implementation shared with
   * export, the server and the CLI. The dialog only chooses which shapes the
   * selected action accepts and how to phrase a rejection — it never parses
   * authored text itself, so there is no second, laxer acceptance path.
   */
  const parsed = useMemo(() => {
    const describe = (diagnostics: readonly Diagnostic[]): string => {
      const first = diagnostics[0];
      if (!first) return mode === "item" ? m.invalidItem : m.invalidCourse;
      const detail = first.message[locale];
      switch (first.code) {
        case "E_JSON_PARSE": case "E_JSON_DUPLICATE_KEY": case "E_JSON_NUMBER_RANGE": case "E_JSON_ROOT_NOT_OBJECT":
          return `${m.invalidJson} ${detail}`.trim();
        case "E_MISSING_ITEM_DOCUMENT": case "E_ITEM_NOT_DECLARED": case "E_ORPHAN_ITEM_DOCUMENT":
          return m.missingItems;
        case "E_DUPLICATE_ID": case "E_DUPLICATE_ITEM_DOCUMENT":
          return m.duplicateIds;
        case "E_LIMIT_EXCEEDED":
          return detail;
        case "E_UNKNOWN_KIND": case "E_ITEM_KIND_MISMATCH": case "E_SCHEMA": case "E_ID_FORMAT": case "E_SCHEMA_VERSION_UNSUPPORTED":
          return mode === "item" ? m.invalidItem : `${m.invalidCourse} ${first.path.replace(/^\//, "").replaceAll("/", ".")}`.trim();
        default:
          return detail;
      }
    };

    const empty = { value: null as ImportSnapshot | ItemDocument | RecoverySources | null, error: null as string | null, warnings: [] as Diagnostic[] };
    if (!source.trim()) return empty;

    if (mode === "item") {
      const result = decodeItemImport(source);
      if (!result.ok) return { ...empty, error: describe(result.diagnostics) };
      return { value: { ...(result.value.document as Record<string, unknown>), id: result.value.id, kind: result.value.kind } as ItemDocument, error: null, warnings: result.warnings };
    }

    if (mode === "recovery") {
      const result = decodeRawSourceRecovery(source);
      if (!result.ok) {
        const version = result.diagnostics.some((diagnostic) => diagnostic.code === "E_SCHEMA_VERSION_UNSUPPORTED");
        return { ...empty, error: version ? m.recoveryVersion : `${m.recoveryInvalid} ${result.diagnostics[0]?.message[locale] ?? ""}`.trim() };
      }
      if (result.value.courseId !== courseId) {
        return { ...empty, error: replaceMessage(m.recoveryCourseMismatch, { id: courseId }) };
      }
      return { value: { courseId: result.value.courseId, sources: result.value.sources } as RecoverySources, error: null, warnings: result.warnings };
    }

    // Course mode takes the existing inline single-file course *and* a workspace
    // backup, kinded or bare, so a lossless backup restores through the same door.
    const result = decodeAnyImport(source);
    if (!result.ok) return { ...empty, error: describe(result.diagnostics) };
    const decoded: DecodedImport = result.value;
    if (decoded.form !== "course" && decoded.form !== "workspace") {
      return { ...empty, error: decoded.form === "recovery" ? m.recoveryWrongMode : m.invalidCourse };
    }
    return { value: decoded.snapshot, error: null, warnings: result.warnings };
  }, [courseId, locale, m, mode, source]);

  const recoverySources = mode === "recovery" ? parsed.value as RecoverySources | null : null;
  const courseSnapshot = mode === "course" ? parsed.value as ImportSnapshot | null : null;
  const importedCourseId = courseSnapshot && typeof object(courseSnapshot.manifest)?.id === "string" ? object(courseSnapshot.manifest)!.id as string : null;
  const courseIdMatches = importedCourseId === courseId;
  const importedItem = mode === "item" ? parsed.value as ItemDocument | null : null;
  const existingModuleId = importedItem ? modules.find((module) => {
    const rows = object(manifest)?.modules;
    const row = Array.isArray(rows) ? rows.map(object).find((entry) => entry?.id === module.id) : null;
    return Array.isArray(row?.items) && row.items.some((entry) => object(entry)?.id === importedItem.id);
  })?.id : null;
  const selectedModuleId = moduleId || existingModuleId || modules[0]?.id || "";
  const existingKind = importedItem ? itemKind(items[importedItem.id]) ?? referencedKind(manifest, importedItem.id) : null;
  const crossKind = importedItem && existingKind && existingKind !== importedItem.kind ? existingKind : null;
  const summary = courseSnapshot ? summarize({ manifest, items }, courseSnapshot) : null;
  const confirmationRequired = Boolean(mode === "course" ? courseIntent === "replace" && courseIdMatches : existingKind);
  const replaceIdMismatch = mode === "course" && courseIntent === "replace" && Boolean(importedCourseId) && !courseIdMatches;
  const canSubmit = Boolean(parsed.value) && !parsed.error && !crossKind
    && (mode !== "item" || Boolean(selectedModuleId))
    && (mode !== "recovery" || Boolean(recoverySources))
    && (mode !== "course" || (courseIntent === "replace" ? courseIdMatches : canCreate))
    && !replaceIdMismatch
    && (!confirmationRequired || replaceConfirmed);

  const reset = () => {
    fileReadId.current += 1;
    setMode("course"); setCourseIntent(createOnly ? "create" : "replace");
    setSource(""); setError(null); setReplaceConfirmed(false); setReadingFile(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const readId = ++fileReadId.current;
    setError(null);
    if (file.size > MAX_JSON_FILE_BYTES) {
      setError(m.fileTooLarge);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setReadingFile(true);
    try {
      const text = await file.text();
      if (fileReadId.current !== readId) return;
      setSource(text); setReplaceConfirmed(false);
    } catch {
      if (fileReadId.current === readId) setError(m.fileReadError);
    } finally {
      if (fileReadId.current === readId) setReadingFile(false);
    }
  };

  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    try {
      if (mode === "course" && courseSnapshot && importedCourseId) {
        if (beforeReplace && !await beforeReplace()) return;
        if (courseIntent === "replace") onApply(courseSnapshot);
        else {
          const result = await readApiData<{ draft: { courseId: string } }>(await fetch("/api/v1/studio/courses/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: source }) }));
          router.push(`/studio/courses/${encodeURIComponent(result.draft.courseId || importedCourseId)}`);
        }
      } else if (mode === "recovery" && recoverySources) {
        if (beforeReplace && !await beforeReplace()) return;
        onApplySources?.(recoverySources.sources);
      } else if (importedItem) {
        // Targeted by default: a full snapshot would rewrite every source and
        // silently discard unrelated text the author has not fixed yet.
        if (onApplyItem) onApplyItem(importedItem, selectedModuleId);
        else onApply({ manifest: manifestWithImportedItem(manifest, importedItem, selectedModuleId), items: { ...items, [importedItem.id]: importedItem } });
      }
      setOpen(false); reset();
    } catch (cause) { setError(workspaceErrorMessage(cause, m.genericError)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next && busyRef.current) return; setOpen(next); if (!next) reset(); }}>
    <DialogTrigger asChild>
      <Button variant="outline" disabled={disabled} className={cn("min-h-11 sm:min-h-9", className)}>
        <Import aria-hidden="true" />{m.trigger}
      </Button>
    </DialogTrigger>
    <DialogContent showCloseButton={false} aria-busy={busy} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-4 py-4 text-left sm:px-6">
        <DialogTitle className="leading-normal">{m.title}</DialogTitle>
        <DialogDescription className="leading-normal">{m.description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        {!createOnly ? <div role="radiogroup" aria-label={m.title} className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/50 p-1">{(["course", "item", "recovery"] as const).map((value) => <label key={value} className="min-w-0 cursor-pointer"><input className="peer sr-only" type="radio" name="import-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setReplaceConfirmed(false); setError(null); }} /><span className="flex min-h-12 items-center justify-center rounded-md border border-transparent px-2 py-2 text-center text-sm leading-normal peer-checked:border-border peer-checked:bg-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{m[value]}</span></label>)}</div> : null}
        {mode === "course" && !createOnly ? <fieldset><legend className="text-sm font-medium leading-normal">{m.intentLabel}</legend><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{(["replace", "create"] as const).map((intent) => <label key={intent} className="flex min-h-11 items-center gap-2 text-sm leading-normal sm:min-h-10"><input type="radio" name="course-import-intent" checked={courseIntent === intent} onChange={() => { setCourseIntent(intent); setReplaceConfirmed(false); }} className="size-4 accent-primary" />{intent === "replace" ? m.replaceIntent : m.createIntent}</label>)}</div></fieldset> : null}
        <div className="space-y-2">
          <label htmlFor="workspace-import-json" className="flex items-center gap-2 text-sm font-medium leading-normal"><FileJson2 aria-hidden="true" className="size-4 text-muted-foreground" />{m.sourceLabel}</label>
          <Textarea id="workspace-import-json" value={source} onChange={(event) => { fileReadId.current += 1; setReadingFile(false); setSource(event.target.value); setReplaceConfirmed(false); }} rows={12} spellCheck={false} className="min-h-56 resize-y font-mono text-xs leading-normal" placeholder={m.pastePlaceholder} />
        </div>
        <div className="space-y-2">
          <label htmlFor="workspace-import-file" className="block text-sm font-medium leading-normal">{m.fileLabel}</label>
          <Input ref={fileInput} id="workspace-import-file" type="file" accept=".json,application/json" disabled={readingFile || busy} onChange={(event) => void readFile(event.target.files?.[0])} className="h-auto min-h-11 py-1.5 sm:min-h-10" />
        </div>
        {mode === "recovery" ? <p className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm leading-normal">{m.recoveryNotice}</p> : null}
        {mode === "item" ? <div className="space-y-2"><label htmlFor="workspace-import-module" className="text-sm font-medium leading-normal">{m.targetModule}</label><NativeSelect id="workspace-import-module" value={selectedModuleId} onChange={(event) => setModuleId(event.target.value)} className="min-h-11 sm:min-h-9" wrapperClassName="w-full">{modules.map((module) => <NativeSelectOption key={module.id} value={module.id}>{module.label} ({module.id})</NativeSelectOption>)}</NativeSelect>{!modules.length ? <p role="alert" className="text-sm leading-normal text-destructive">{m.noModules}</p> : null}</div> : null}
        {summary && importedCourseId ? <section aria-labelledby="import-summary" className="rounded-md border border-border p-4"><h3 id="import-summary" className="text-sm font-semibold leading-normal">{m.summaryTitle}</h3><p className="mt-1 break-words text-sm leading-normal text-muted-foreground">{replaceMessage(courseIntent === "replace" ? m.replaceNotice : m.createNotice, { id: importedCourseId })}</p><dl className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-3"><ChangeList label={m.additions} values={summary.additions} none={m.none} /><ChangeList label={m.changes} values={summary.changes} none={m.none} /><ChangeList label={m.removals} values={summary.removals} none={m.none} /></dl></section> : null}
        {confirmationRequired && !crossKind ? <label className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm leading-normal"><Checkbox checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} className="mt-0.5" /><span className="min-w-0 break-words">{importedItem && existingKind ? replaceMessage(m.replaceItem, { kind: itemKindLabels[locale][existingKind], id: importedItem.id }) : m.replaceCourse}</span></label> : null}
        {crossKind ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{replaceMessage(m.crossKind, { kind: itemKindLabels[locale][crossKind] })}</p> : null}
        {parsed.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{parsed.error}</p> : null}
        {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}
        {replaceIdMismatch ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{replaceMessage(m.replaceIdMismatch, { id: courseId })}</p> : null}
        {mode === "course" && importedCourseId && courseIntent === "create" && !canCreate ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{m.createDenied}</p> : null}
      </div>
      <DialogFooter className="shrink-0 border-t border-border px-4 py-4 sm:px-6">
        <DialogClose asChild><Button variant="outline" disabled={busy} className="min-h-11 w-full sm:min-h-9 sm:w-auto">{m.cancel}</Button></DialogClose>
        <Button onClick={() => void submit()} disabled={busy || readingFile || disabled || !canSubmit} className="min-h-11 w-full sm:min-h-9 sm:w-auto">{busy ? m.working : mode === "course" && courseIntent === "create" ? m.create : m.apply}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ChangeList({ label, values, none }: { label: string; values: string[]; none: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm leading-normal [overflow-wrap:anywhere]">{values.length ? values.join(", ") : none}</dd></div>;
}
