"use client";

import { ChevronDown, ChevronUp, FileJson2, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Badge, Button } from "@/components/ui/classic";
import { COURSE_REF, itemRef, refKey, refOf, type DocumentRef, type ValidationReport } from "@/content-engine/diagnostics";
import {
  addItemReference,
  addModule as addModuleDocument,
  moveItemReference,
  moveModule as moveModuleDocument,
  removeItemReference,
  removeModule as removeModuleDocument,
  renameItemReference,
  renameModule,
} from "@/features/studio/structure-updates";
import { cn } from "@/lib/utils";

export type OutlineStatus = { kind: "valid" | "warning" | "error" | "stub"; count: number };
type DiagnosticCounts = { errors: number; warnings: number };

type ItemKind = "lesson" | "exam" | "assignment";
type OutlineItem = Record<string, unknown> & { id: string; type: ItemKind; title?: unknown };
type OutlineModule = Record<string, unknown> & { id: string; title?: unknown; items: OutlineItem[] };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function titleOf(value: unknown, locale: string, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  const localized = object(value);
  const preferred = localized?.[locale];
  if (typeof preferred === "string" && preferred.trim()) return preferred;
  const first = localized && Object.values(localized).find((entry) => typeof entry === "string" && entry.trim());
  return typeof first === "string" ? first : fallback;
}

function modulesOf(manifest: unknown): OutlineModule[] {
  const modules = object(manifest)?.modules;
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((value) => {
    const moduleRow = object(value);
    if (!moduleRow || typeof moduleRow.id !== "string") return [];
    const items = Array.isArray(moduleRow.items)
      ? moduleRow.items.flatMap((entry) => {
        const item = object(entry);
        if (!item || typeof item.id !== "string" || !["lesson", "exam", "assignment"].includes(String(item.type))) return [];
        return [{ ...item, id: item.id, type: item.type as ItemKind, title: item.title }];
      })
      : [];
    return [{ ...moduleRow, id: moduleRow.id, title: moduleRow.title, items }];
  });
}

export function outlineStatus(itemId: string, hasDocument: boolean, report: ValidationReport): OutlineStatus {
  if (!hasDocument) return { kind: "stub", count: 0 };
  // Counted by reference, not by label: an item whose id is `manifest` must not
  // absorb the course manifest's diagnostics.
  const key = refKey(itemRef(itemId));
  const errors = report.errors.filter((diagnostic) => refKey(refOf(diagnostic)) === key).length;
  if (errors) return { kind: "error", count: errors };
  const warnings = report.warnings.filter((diagnostic) => refKey(refOf(diagnostic)) === key).length;
  if (warnings) return { kind: "warning", count: warnings };
  return { kind: "valid", count: 0 };
}

function statusFromCounts(hasDocument: boolean, counts?: DiagnosticCounts): OutlineStatus {
  if (!hasDocument) return { kind: "stub", count: 0 };
  if (counts?.errors) return { kind: "error", count: counts.errors };
  if (counts?.warnings) return { kind: "warning", count: counts.warnings };
  return { kind: "valid", count: 0 };
}

export function Outline({
  manifest,
  items,
  report,
  selectedRef,
  onSelect,
  onManifestChange,
  reservedItemIds = [],
  readOnly = false,
}: {
  manifest: unknown;
  items: Record<string, unknown>;
  report: ValidationReport;
  selectedRef: DocumentRef;
  onSelect: (ref: DocumentRef) => void;
  onManifestChange: (manifest: unknown) => void;
  reservedItemIds?: Iterable<string>;
  readOnly?: boolean;
}) {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const [newKinds, setNewKinds] = useState<Record<string, ItemKind>>({});
  const modules = modulesOf(manifest);
  const diagnosticCounts = useMemo(() => {
    const counts = new Map<string, DiagnosticCounts>();
    for (const diagnostic of report.errors) {
      const key = refKey(refOf(diagnostic));
      const current = counts.get(key) ?? { errors: 0, warnings: 0 };
      current.errors += 1;
      counts.set(key, current);
    }
    for (const diagnostic of report.warnings) {
      const key = refKey(refOf(diagnostic));
      const current = counts.get(key) ?? { errors: 0, warnings: 0 };
      current.warnings += 1;
      counts.set(key, current);
    }
    return counts;
  }, [report.errors, report.warnings]);

  const moveModule = (index: number, offset: number) => {
    const courseModule = modules[index];
    if (!courseModule) return;
    const next = moveModuleDocument(manifest, courseModule.id, offset as -1 | 1);
    if (next !== manifest) onManifestChange(next);
  };

  const moveItem = (moduleIndex: number, itemIndex: number, offset: number) => {
    const courseModule = modules[moduleIndex];
    const item = courseModule?.items[itemIndex];
    if (!courseModule || !item) return;
    const next = moveItemReference(manifest, courseModule.id, item.id, offset as -1 | 1);
    if (next !== manifest) onManifestChange(next);
  };

  const addModule = () => {
    const added = addModuleDocument(manifest, t("outline.moduleUntitled"), t("outline.itemUntitled"), reservedItemIds);
    if (!added.moduleId || !added.itemId) return;
    onManifestChange(added.document);
  };

  const addItem = (moduleIndex: number) => {
    const courseModule = modules[moduleIndex];
    if (!courseModule) return;
    const kind = newKinds[courseModule.id] ?? "lesson";
    const added = addItemReference(manifest, courseModule.id, kind, t("outline.itemUntitled"), reservedItemIds);
    if (!added.itemId) return;
    onManifestChange(added.document);
  };

  const badge = (item: OutlineItem) => {
    const status = statusFromCounts(Object.hasOwn(items, item.id), diagnosticCounts.get(refKey(itemRef(item.id))));
    const label = status.kind === "valid"
      ? t("badges.valid")
      : status.kind === "stub"
        ? t("badges.stub")
        : t(status.kind === "error" ? "badges.errors" : "badges.warnings", { count: status.count });
    return (
      <Badge
        aria-label={label}
        className={cn(
          "shrink-0 rounded-sm px-1.5 font-mono text-[0.65rem] [.vf-staff_&]:font-sans [.vf-staff_&]:text-xs [.vf-staff_&]:font-medium [.vf-staff_&]:tabular-nums",
          status.kind === "error" && "bg-red-100 text-red-800",
          status.kind === "warning" && "bg-amber-100 text-amber-900",
          status.kind === "stub" && "border border-dashed border-border bg-transparent text-muted-foreground",
          status.kind === "valid" && "sr-only",
        )}
      >
        {label}
      </Badge>
    );
  };

  return (
    <nav aria-label={t("outline.label")} className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <button
          type="button"
          aria-pressed={selectedRef.kind === "course"}
          onClick={() => onSelect(COURSE_REF)}
          className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent"
        >
          <FileJson2 aria-hidden="true" className="size-4 text-primary" />
          {t("outline.manifest")}
        </button>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto p-3">
        {modules.length ? modules.map((module, moduleIndex) => {
          const moduleTitle = titleOf(module.title, locale, t("outline.moduleUntitled"));
          return (
            <li key={module.id} className="mb-4 border-l border-border pl-3">
              <div className="flex min-h-8 items-center gap-1">
                {readOnly ? <h3 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide uppercase" title={moduleTitle}>{moduleTitle}</h3> : (
                  <input
                    key={`${module.id}-${moduleTitle}`}
                    type="text"
                    defaultValue={moduleTitle}
                    aria-label={t("outline.moduleTitle", { id: module.id })}
                    onBlur={(event) => {
                      const title = event.currentTarget.value.trim();
                      if (!title) {
                        event.currentTarget.value = moduleTitle;
                        return;
                      }
                      if (title !== moduleTitle) onManifestChange(renameModule(manifest, module.id, locale as "vi" | "en", title));
                    }}
                    className="min-h-8 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-semibold tracking-wide uppercase hover:border-input focus:border-input focus:bg-background focus-visible:outline-2 focus-visible:outline-ring"
                  />
                )}
                {!readOnly ? <>
                  <button type="button" onClick={() => moveModule(moduleIndex, -1)} disabled={moduleIndex === 0} aria-label={t("outline.moveUp", { title: moduleTitle })} className="inline-flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><ChevronUp aria-hidden="true" className="size-3.5" /></button>
                  <button type="button" onClick={() => moveModule(moduleIndex, 1)} disabled={moduleIndex === modules.length - 1} aria-label={t("outline.moveDown", { title: moduleTitle })} className="inline-flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><ChevronDown aria-hidden="true" className="size-3.5" /></button>
                  <button type="button" onClick={() => {
                    if (!window.confirm(t("outline.confirmDeleteModule", { title: moduleTitle }))) return;
                    const removed = removeModuleDocument(manifest, module.id);
                    if (removed.changed) {
                      onManifestChange(removed.document);
                      onSelect(COURSE_REF);
                    }
                  }} disabled={modules.length <= 1} aria-label={t("outline.deleteModule", { title: moduleTitle })} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><Trash2 aria-hidden="true" className="size-3.5" /></button>
                </> : null}
              </div>
              <ol className="mt-1 space-y-1">
                {module.items.map((item, itemIndex) => {
                  const itemTitle = titleOf(object(items[item.id])?.title ?? item.title, locale, t("outline.itemUntitled"));
                  return (
                    <li key={item.id} className="group flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={selectedRef.kind === "item" && selectedRef.id === item.id}
                        onClick={() => onSelect(itemRef(item.id))}
                        className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{itemTitle}</span>
                          <span className="block font-mono text-[0.65rem] text-muted-foreground uppercase [.vf-staff_&]:font-sans [.vf-staff_&]:text-xs [.vf-staff_&]:font-medium [.vf-staff_&]:normal-case [.vf-staff_&]:leading-[1.4]">{t(`outline.itemKinds.${item.type}`)}</span>
                        </span>
                        {badge(item)}
                      </button>
                      {!readOnly ? <span className="hidden shrink-0 group-hover:flex group-focus-within:flex">
                        <button type="button" onClick={() => moveItem(moduleIndex, itemIndex, -1)} disabled={itemIndex === 0} aria-label={t("outline.moveUp", { title: itemTitle })} className="inline-flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><ChevronUp aria-hidden="true" className="size-3.5" /></button>
                        <button type="button" onClick={() => moveItem(moduleIndex, itemIndex, 1)} disabled={itemIndex === module.items.length - 1} aria-label={t("outline.moveDown", { title: itemTitle })} className="inline-flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><ChevronDown aria-hidden="true" className="size-3.5" /></button>
                        <button type="button" onClick={() => {
                          if (!window.confirm(t("outline.confirmDelete", { title: itemTitle }))) return;
                          const removed = removeItemReference(manifest, module.id, item.id);
                          if (removed.changed) {
                            onManifestChange(removed.document);
                            if (selectedRef.kind === "item" && selectedRef.id === item.id) onSelect(COURSE_REF);
                          }
                        }} disabled={module.items.length <= 1} aria-label={t("outline.deleteItem", { title: itemTitle })} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"><Trash2 aria-hidden="true" className="size-3.5" /></button>
                      </span> : null}
                      {!readOnly ? <input
                        key={`${item.id}-${itemTitle}`}
                        type="text"
                        defaultValue={itemTitle}
                        aria-label={t("outline.itemTitle", { id: item.id })}
                        onBlur={(event) => {
                          const currentTitle = itemTitle;
                          const title = event.currentTarget.value.trim();
                          if (!title) {
                            event.currentTarget.value = currentTitle;
                            return;
                          }
                          if (title !== currentTitle) onManifestChange(renameItemReference(manifest, module.id, item.id, locale as "vi" | "en", title));
                        }}
                        className="ml-2 hidden min-h-8 w-[calc(100%-0.5rem)] group-focus-within:block rounded border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                      /> : null}
                    </li>
                  );
                })}
              </ol>
              {!readOnly ? <div className="mt-2 flex flex-wrap gap-1">
                <label className="sr-only" htmlFor={`new-kind-${module.id}`}>{t("outline.itemKind")}</label>
                <select id={`new-kind-${module.id}`} value={newKinds[module.id] ?? "lesson"} onChange={(event) => setNewKinds((current) => ({ ...current, [module.id]: event.target.value as ItemKind }))} className="min-h-9 min-w-24 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
                  {(["lesson", "exam", "assignment"] as const).map((kind) => <option key={kind} value={kind}>{t(`outline.itemKinds.${kind}`)}</option>)}
                </select>
                <Button onClick={() => addItem(moduleIndex)} className="min-h-9 shrink-0 px-2 text-xs"><Plus aria-hidden="true" className="mr-1 size-3.5" />{t("outline.addItem")}</Button>
              </div> : null}
            </li>
          );
        }) : <li className="py-5 text-center text-sm text-muted-foreground">{t("outline.empty")}</li>}
      </ol>

      {!readOnly ? <div className="border-t border-border p-3">
        <Button onClick={addModule} className="w-full bg-secondary text-secondary-foreground shadow-none hover:bg-accent"><Plus aria-hidden="true" className="mr-2 size-4" />{t("outline.addModule")}</Button>
      </div> : null}
    </nav>
  );
}
