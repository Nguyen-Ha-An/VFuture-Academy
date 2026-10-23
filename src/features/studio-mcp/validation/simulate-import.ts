import { createHash } from 'node:crypto';

import { stableStringify } from '@/content-engine/compile/checksum';
import type { Diagnostic } from '@/content-engine/diagnostics';
import { profileContextFromDraft, checkAuthoringProfile } from '@/content-engine/authoring';
import { ID_PATTERN } from '@/content-engine/schema/common';
import { MAX_ENVELOPE_BYTES, utf8ByteLength } from '@/content-engine/validate';
import { workspaceRevision } from '@/content-engine/validate/revision';
import { decodeItemImport } from '@/features/studio/content-transfer';
import { saveabilityReport, type CourseDraft, type StudioDatabase } from '@/features/studio/drafts';
import {
  createWorkspaceState, importWorkspaceItemLocally, mutationFailureOf, workspacePayload,
} from '@/features/studio/workspace-state';
import { MAX_WIRE_BODY_BYTES } from '@/lib/body-limit';

import { applyItemEdits, type ItemEdit, PatchError, parsePointer } from '../data/patch';

export type ImportIssueLayer = 'profile' | 'patch' | 'parse' | 'document' | 'import' | 'workspace' | 'save';
export type ImportIssue = {
  layer: ImportIssueLayer;
  code: string;
  severity: 'error' | 'warning';
  pointer: string;
  message: string;
  hint?: string;
  rule?: string;
  meta?: { count: number; paths: string[] };
};
export type ChangeSummary = { addedIds: string[]; removedIds: string[]; changedIds: string[] };
export type SimulationResult = {
  valid: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  truncated: boolean;
  base: { draftUpdatedAt: string | null; revision: string; itemHash: string };
  proposedItemHash: string;
  proposedBytes: number;
  reviewPending: boolean;
  changeSummary: ChangeSummary;
  document: Record<string, unknown>;
  importText: string;
  workspaceBytes: number;
  workspaceTooLarge: boolean;
  itemId: string;
  kind: 'lesson' | 'exam' | 'assignment';
  moduleId: string;
  moduleTitle: string;
};

export class StudioImportFailure extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'StudioImportFailure';
  }
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ISSUE_LIMIT = 100;
const SUMMARY_ID_LIMIT = 100;

export function itemHash(item: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(item)).digest('hex')}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function genericIssue(layer: ImportIssueLayer, code: string, pointer = '', severity: 'error' | 'warning' = 'error'): ImportIssue {
  // All messages are fixed. Untrusted course text and database errors stay out of diagnostics.
  const message = code === 'REVIEW_PENDING'
    ? 'This course has a pending review. Studio will not save changes until the review is resolved.'
    : code === 'WORKSPACE_TOO_LARGE'
      ? 'The workspace exceeds the Studio save size limit.'
      : code === 'BASE_DRAFT_UNSAVEABLE'
        ? 'The current draft cannot be saved by Studio.'
        : code === 'E_REFERENCE_LOOKUP_FAILED'
          ? 'A reference could not be checked. Try again later.'
          : `Validation failed (${code}).`;
  return { layer, code, severity, pointer, message };
}

function storageIssue(diagnostic: Diagnostic, layer: ImportIssueLayer): ImportIssue {
  return genericIssue(layer, diagnostic.code, diagnostic.path, diagnostic.severity === 'error' ? 'error' : 'warning');
}

const SAFE_LEGACY_TOKEN = /^(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63}|0|[1-9][0-9]{0,5})$/;

function legacyMeta(issue: { code: string; meta?: Record<string, string | number> }): ImportIssue['meta'] {
  if (issue.code !== 'W_PROFILE_LEGACY_UNCHANGED') return undefined;
  const count = issue.meta?.count;
  const rawPaths = issue.meta?.paths;
  if (!Number.isSafeInteger(count) || typeof count !== 'number' || count < 0 || typeof rawPaths !== 'string') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(rawPaths); } catch { return undefined; }
  if (!Array.isArray(parsed)) return undefined;
  const paths = parsed.slice(0, 20).filter((path): path is string => {
    if (typeof path !== 'string' || path.length > 512) return false;
    try { return parsePointer(path).every(token => SAFE_LEGACY_TOKEN.test(token)); }
    catch { return false; }
  });
  return { count, paths };
}

function profileIssue(issue: { code: string; path: string; severity: 'error' | 'warning'; meta?: Record<string, string | number> }): ImportIssue {
  const layer = issue.code.startsWith('E_PROFILE_') || issue.code.startsWith('W_PROFILE_') ? 'profile' : 'document';
  const meta = legacyMeta(issue);
  return { ...genericIssue(layer, issue.code, issue.path, issue.severity), ...(meta ? { meta } : {}) };
}

function capped(errors: ImportIssue[], warnings: ImportIssue[]): { errors: ImportIssue[]; warnings: ImportIssue[]; truncated: boolean } {
  const allowedErrors = errors.slice(0, ISSUE_LIMIT);
  const allowedWarnings = warnings.slice(0, ISSUE_LIMIT - allowedErrors.length);
  return { errors: allowedErrors, warnings: allowedWarnings, truncated: errors.length + warnings.length > ISSUE_LIMIT };
}

function idNodes(value: unknown): Map<string, string> {
  const nodes = new Map<string, string>();
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    const row = record(node);
    if (!row) return node;
    const direct = Object.fromEntries(Object.entries(row).map(([key, child]) => [key, visit(child)]));
    const id = row.id;
    if (typeof id === 'string' && ID_PATTERN.test(id)) {
      nodes.set(id, stableStringify(direct));
      return { id };
    }
    return direct;
  };
  visit(value);
  return nodes;
}

export function summarizeItemChanges(base: unknown, proposed: unknown): ChangeSummary & { truncated: boolean } {
  const before = idNodes(base);
  const after = idNodes(proposed);
  const changed = [...after.keys()].filter(id => before.has(id) && before.get(id) !== after.get(id)).sort();
  const added = [...after.keys()].filter(id => !before.has(id)).sort();
  const removed = [...before.keys()].filter(id => !after.has(id)).sort();
  // Keep the complete response small even for malformed or unusually dense items.
  let remaining = SUMMARY_ID_LIMIT;
  const changedIds = changed.slice(0, remaining); remaining -= changedIds.length;
  const addedIds = added.slice(0, remaining); remaining -= addedIds.length;
  const removedIds = removed.slice(0, remaining);
  return {
    addedIds, removedIds, changedIds,
    truncated: changed.length + added.length + removed.length > SUMMARY_ID_LIMIT,
  };
}

function itemLocation(manifest: unknown, itemId: string): { moduleId: string; moduleTitle: string } | null {
  const course = record(manifest);
  const modules = course?.modules;
  if (!Array.isArray(modules)) return null;
  for (const candidate of modules) {
    const moduleRow = record(candidate);
    if (!moduleRow || !Array.isArray(moduleRow.items)) continue;
    if (!moduleRow.items.some((entry: unknown) => record(entry)?.id === itemId)) continue;
    if (typeof moduleRow.id !== 'string') return null;
    const title = moduleRow.title;
    const localized = record(title);
    const defaultLanguage = typeof course?.defaultLanguage === 'string' ? course.defaultLanguage : 'en';
    return { moduleId: moduleRow.id, moduleTitle: typeof title === 'string' ? title : typeof localized?.[defaultLanguage] === 'string' ? localized[defaultLanguage] as string : '' };
  }
  return null;
}

export async function reviewPending(client: StudioDatabase, courseId: string): Promise<boolean> {
  const { data, error } = await client.from('cms_review_requests').select('id')
    .eq('content_type', 'course').eq('content_id', courseId).eq('status', 'pending').limit(1);
  if (error || !Array.isArray(data)) throw new StudioImportFailure('SERVICE_UNAVAILABLE', true);
  return data.length > 0;
}

export type SimulateImportInput = {
  draft: CourseDraft;
  courseId: string;
  itemId: string;
  baseItemHash: string;
  edits?: readonly ItemEdit[];
  document?: Record<string, unknown>;
  client: StudioDatabase;
};

/** Replays the Studio paste, local import and save preflight without mutating storage. */
export async function simulateStudioImport(input: SimulateImportInput): Promise<SimulationResult> {
  const { draft, courseId, itemId, client } = input;
  if (!input.baseItemHash) throw new StudioImportFailure('BASE_HASH_REQUIRED');
  if (!SHA256.test(input.baseItemHash)) throw new StudioImportFailure('INVALID_INPUT');
  if (draft.courseId !== courseId) throw new StudioImportFailure('COURSE_NOT_FOUND_OR_FORBIDDEN');
  const baseItem = draft.items[itemId];
  const base = record(baseItem);
  const location = itemLocation(draft.manifest, itemId);
  if (!base || !location) throw new StudioImportFailure('ITEM_NOT_FOUND');
  const currentHash = itemHash(base);
  if (currentHash !== input.baseItemHash) throw new StudioImportFailure('BASE_ITEM_CHANGED');
  if ((input.edits === undefined) === (input.document === undefined)) throw new StudioImportFailure('INVALID_INPUT');

  let candidate: unknown;
  try {
    candidate = input.edits ? applyItemEdits(base, input.edits) : input.document;
  } catch (cause) {
    if (cause instanceof PatchError) throw cause;
    throw new StudioImportFailure('PATCH_FAILED');
  }
  const row = record(candidate);
  if (!row) throw new StudioImportFailure('INVALID_INPUT');
  if (row.kind !== base.kind) throw new StudioImportFailure('IMMUTABLE_KIND');
  if (base.kind !== 'lesson' && base.kind !== 'exam' && base.kind !== 'assignment') throw new StudioImportFailure('BASE_DRAFT_UNSAVEABLE');
  const targetMismatch = row.id !== itemId || row.schemaVersion !== base.schemaVersion;

  let importText: string;
  try { importText = JSON.stringify(row, null, 2); }
  catch { throw new StudioImportFailure('INVALID_INPUT'); }
  if (typeof importText !== 'string') throw new StudioImportFailure('INVALID_INPUT');
  const parsed = decodeItemImport(importText);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  if (targetMismatch) errors.push(genericIssue('profile', 'E_PROFILE_TARGET_MISMATCH', row.id !== itemId ? '/id' : '/schemaVersion'));
  if (!parsed.ok) {
    errors.push(...parsed.diagnostics.map(diagnostic => storageIssue(diagnostic,
      diagnostic.code.startsWith('E_JSON_') || diagnostic.code === 'E_NESTING_TOO_DEEP' ? 'parse' : 'document')));
  } else {
    warnings.push(...parsed.warnings.map(diagnostic => storageIssue(diagnostic, 'import')));
    const context = profileContextFromDraft({ manifest: draft.manifest, items: draft.items }, {
      target: { id: itemId, kind: base.kind as 'lesson' | 'exam' | 'assignment' },
    });
    const profile = checkAuthoringProfile(parsed.value.document, baseItem, context);
    errors.push(...profile.errors.map(profileIssue));
    warnings.push(...profile.warnings.map(profileIssue));
  }

  let workspaceBytes = 0;
  let workspaceTooLarge = false;
  if (parsed.ok && !targetMismatch) {
    try {
      const state = createWorkspaceState(draft);
      const imported = importWorkspaceItemLocally(state, parsed.value.document, location.moduleId);
      const payload = workspacePayload(imported);
      if (!payload) errors.push(genericIssue('workspace', 'BASE_DRAFT_UNSAVEABLE'));
      else {
        workspaceBytes = utf8ByteLength(JSON.stringify(payload));
        workspaceTooLarge = workspaceBytes > MAX_ENVELOPE_BYTES || workspaceBytes > MAX_WIRE_BODY_BYTES;
        if (workspaceTooLarge) errors.push(genericIssue('workspace', 'WORKSPACE_TOO_LARGE'));
        else {
          const save = await saveabilityReport(courseId, payload.manifest, payload.items, { client });
          if (save.errors.some(diagnostic => diagnostic.code === 'E_REFERENCE_LOOKUP_FAILED')) {
            throw new StudioImportFailure('REFERENCE_LOOKUP_UNAVAILABLE', true);
          }
          errors.push(...save.errors.map(diagnostic => storageIssue(diagnostic, 'save')));
          warnings.push(...save.warnings.map(diagnostic => storageIssue(diagnostic, 'save')));
        }
      }
    } catch (cause) {
      const mutation = mutationFailureOf(cause);
      if (!mutation) throw cause;
      // Studio's local import refuses an invalid stored manifest before it can
      // apply the proposed item. Preparation must identify the base as unsaveable.
      errors.push(mutation.code === 'INVALID_MANIFEST'
        ? genericIssue('workspace', 'BASE_DRAFT_UNSAVEABLE')
        : genericIssue('import', mutation.code));
    }
  }

  const pending = await reviewPending(client, courseId);
  if (pending) warnings.push(genericIssue('workspace', 'REVIEW_PENDING', '', 'warning'));
  const limited = capped(errors, warnings);
  const summary = parsed.ok
    ? summarizeItemChanges(base, parsed.value.document)
    : { addedIds: [], removedIds: [], changedIds: [], truncated: false };
  return {
    valid: errors.length === 0,
    ...limited,
    truncated: limited.truncated || summary.truncated,
    base: { draftUpdatedAt: draft.updatedAt, revision: draft.revision ?? workspaceRevision(draft.manifest, draft.items), itemHash: currentHash },
    proposedItemHash: itemHash(row), proposedBytes: utf8ByteLength(importText),
    reviewPending: pending, changeSummary: {
      addedIds: summary.addedIds, removedIds: summary.removedIds, changedIds: summary.changedIds,
    },
    document: row, importText, workspaceBytes, workspaceTooLarge,
    itemId, kind: base.kind as 'lesson' | 'exam' | 'assignment',
    moduleId: location.moduleId, moduleTitle: location.moduleTitle,
  };
}
