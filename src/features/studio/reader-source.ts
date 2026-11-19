import 'server-only';

import { makeDiagnostic, refOf, type Diagnostic, type ValidationReport } from '@/content-engine/diagnostics';
import { redactItemDocument } from '@/features/studio-mcp/data/redact';
import type { CourseDraft } from './drafts';
import { PUBLISH_CHECKLIST_KEYS } from './publish-checklist';

type SourceWorkspace = Pick<CourseDraft, 'manifest' | 'items' | 'baseVersionId'>;

export function readerWorkspace(workspace: SourceWorkspace): SourceWorkspace {
  return {
    // Older manifests can contain complete inline lessons and exams.
    manifest: redactItemDocument(workspace.manifest).document,
    items: Object.fromEntries(Object.entries(workspace.items).map(([id, item]) => [id, redactItemDocument(item).document])),
    baseVersionId: workspace.baseVersionId,
  };
}

export function readerDraft(draft: CourseDraft): CourseDraft {
  const checklist = draft.checklist && typeof draft.checklist === 'object' ? draft.checklist as Record<string, unknown> : {};
  return {
    id: draft.id,
    courseId: draft.courseId,
    ...readerWorkspace(draft),
    checklist: Object.fromEntries(PUBLISH_CHECKLIST_KEYS.filter(key => typeof checklist[key] === 'boolean').map(key => [key, checklist[key]])),
    updatedAt: draft.updatedAt,
  };
}

/** Diagnostics can echo an invalid answer in their message, metadata or JSON Pointer. */
export function readerValidationReport(report: ValidationReport): ValidationReport {
  const forReader = (diagnostic: Diagnostic) => makeDiagnostic(diagnostic.code, {
    ref: refOf(diagnostic), severity: diagnostic.severity, path: '',
  });
  return { ok: report.ok, errors: report.errors.map(forReader), warnings: report.warnings.map(forReader), summary: report.summary };
}
