import { createHash } from 'node:crypto';

import enMessages from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { dialogMessages, itemKindLabels, replaceMessage } from '@/features/studio/ui/dialog-messages';

const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_TEXT_BYTES = 80 * 1024;
const LARGE_PAYLOAD_BYTES = 64 * 1024;

type ItemKind = 'lesson' | 'exam' | 'assignment';
type UiLocale = 'en' | 'vi';

export type ImportPackageErrorCode =
  | 'VALIDATION_FAILED'
  | 'REVIEW_PENDING'
  | 'WORKSPACE_TOO_LARGE'
  | 'BASE_DRAFT_UNSAVEABLE'
  | 'ITEM_TOO_LARGE_TO_PASTE';

export class ImportPackageError extends Error {
  constructor(
    readonly code: ImportPackageErrorCode,
    message: string,
    readonly issues?: readonly unknown[],
  ) {
    super(message);
    this.name = 'ImportPackageError';
  }
}

export interface ImportPackageSimulation {
  valid: boolean;
  errors: readonly unknown[];
  base: { draftUpdatedAt: string | null; itemHash: string };
  proposedItemHash: string;
  reviewPending: boolean;
  changeSummary: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
  document: Record<string, unknown>;
  workspaceBytes: number;
  itemId: string;
  kind: ItemKind;
  moduleId: string;
  moduleTitle: string;
}

export interface PrepareImportPackageInput {
  simulation: ImportPackageSimulation;
  courseId: string;
  origin: string;
  ownerScopeKey: string;
  baseDraftUpdatedAt?: string;
  uiLocale?: UiLocale;
}

export interface PreparedImport {
  ready: true;
  itemId: string;
  kind: ItemKind;
  moduleId: string;
  moduleTitle: string;
  importText: string;
  importTextSha256: string;
  baseItemHash: string;
  proposedItemHash: string;
  bytes: number;
  studioUrl: string;
  ownerScopeKey: string;
  steps: string[];
  warnings: Array<{ code: 'DRAFT_MOVED_ON' | 'AUTOSAVE_AFTER_APPLY' | 'LARGE_PAYLOAD'; message: string }>;
  changeSummary: ImportPackageSimulation['changeSummary'];
}

function pasteSteps(locale: UiLocale, studioUrl: string, ownerScopeKey: string, kind: ItemKind, itemId: string): string[] {
  const workspace = locale === 'vi' ? viMessages.studioWorkspace : enMessages.studioWorkspace;
  const dialog = dialogMessages[locale].import;
  const kindLabel = itemKindLabels[locale][kind];
  const confirmation = replaceMessage(dialog.replaceItem, { kind: kindLabel, id: itemId });

  return [
    `Open ${studioUrl} signed in as this account. If the header says "${workspace.readOnly}", switch the scope to "${ownerScopeKey}".`,
    `If you have unsaved changes, click "${workspace.save}" and then ask the assistant to regenerate this package so the base includes your changes.`,
    `Optional backup: ${workspace.more} → ${workspace.export}.`,
    `Choose ${workspace.more} → ${dialog.trigger} → ${dialog.item}.`,
    'Paste importText exactly as given. The assistant must show it verbatim in one code block.',
    `Tick "${confirmation}". ${dialog.targetModule} is pre-set to the item's current module.`,
    `Click "${dialog.apply}". Studio autosaves valid changes about 1.5 seconds later, so Apply works like Save.`,
    'Ask the assistant to run verify_import.',
  ].map((step, index) => `${index + 1}. ${step}`);
}

export function prepareImportPackage({
  simulation, courseId, origin, ownerScopeKey, baseDraftUpdatedAt, uiLocale = 'en',
}: PrepareImportPackageInput): PreparedImport {
  // The simulator records envelope overflow as a validation issue too, but the
  // prepare tool promises a distinct error code for this limit.
  if (simulation.workspaceBytes > MAX_WORKSPACE_BYTES) {
    throw new ImportPackageError('WORKSPACE_TOO_LARGE', 'The resulting workspace exceeds the 2 MiB limit.');
  }
  if (simulation.errors.some((issue) => typeof issue === 'object' && issue !== null && 'code' in issue && issue.code === 'BASE_DRAFT_UNSAVEABLE')) {
    throw new ImportPackageError('BASE_DRAFT_UNSAVEABLE', 'The current draft cannot be saved by Studio.', simulation.errors);
  }
  if (!simulation.valid || simulation.errors.length > 0) {
    throw new ImportPackageError('VALIDATION_FAILED', 'The item did not pass Studio validation.', simulation.errors);
  }
  if (simulation.reviewPending) {
    throw new ImportPackageError('REVIEW_PENDING', 'This course has a pending review request.');
  }

  const importText = JSON.stringify(simulation.document, null, 2);
  const bytes = Buffer.byteLength(importText, 'utf8');
  if (bytes > MAX_IMPORT_TEXT_BYTES) {
    throw new ImportPackageError('ITEM_TOO_LARGE_TO_PASTE', 'The formatted item exceeds the 80 KiB paste limit.');
  }

  const locale = uiLocale === 'vi' ? 'vi' : 'en';
  const studioUrl = `${new URL(origin).origin}/studio/courses/${encodeURIComponent(courseId)}`;
  const warnings: PreparedImport['warnings'] = [];
  if (baseDraftUpdatedAt !== undefined && baseDraftUpdatedAt !== simulation.base.draftUpdatedAt) {
    warnings.push({
      code: 'DRAFT_MOVED_ON',
      message: 'The draft changed since the supplied timestamp. Review its changes before pasting.',
    });
  }
  warnings.push({
    code: 'AUTOSAVE_AFTER_APPLY',
    message: 'Studio autosaves valid changes about 1.5 seconds after Apply.',
  });
  if (bytes >= LARGE_PAYLOAD_BYTES) {
    warnings.push({
      code: 'LARGE_PAYLOAD',
      message: 'This is a large paste payload. Check the complete single code block before applying it.',
    });
  }

  return {
    ready: true,
    itemId: simulation.itemId,
    kind: simulation.kind,
    moduleId: simulation.moduleId,
    moduleTitle: simulation.moduleTitle,
    importText,
    importTextSha256: createHash('sha256').update(importText, 'utf8').digest('hex'),
    baseItemHash: simulation.base.itemHash,
    proposedItemHash: simulation.proposedItemHash,
    bytes,
    studioUrl,
    ownerScopeKey,
    steps: pasteSteps(locale, studioUrl, ownerScopeKey, simulation.kind, simulation.itemId),
    warnings,
    changeSummary: simulation.changeSummary,
  };
}
