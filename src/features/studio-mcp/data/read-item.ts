import { checksumOf } from '@/content-engine/compile/checksum';
import { checkAuthoringProfile, profileContextFromDraft } from '@/content-engine/authoring';
import type { Actor } from '@/lib/permissions';

import { type ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { findDraftItem, courseLanguages } from './courses';
import { PatchError, parsePointer, resolvePointer } from './patch';
import { pointsIntoRedaction, redactItemDocument } from './redact';
import { readCourseState } from './read-course';

const MAX_WHOLE_ITEM_BYTES = 40 * 1024;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Never compute a reader's pointer against the original document. */
export async function mcpGetItem(
  db: ReadOnlyDatabase,
  actor: Actor,
  courseId: string,
  itemId: string,
  pointer?: string,
): Promise<{
  kind: 'lesson' | 'exam' | 'assignment';
  moduleId: string;
  document: unknown;
  pointer: string;
  itemHash?: string;
  draftUpdatedAt: string | null;
  revision: string;
  bytes: number;
  redacted: boolean;
  redactedPaths: string[];
  canEdit: boolean;
  courseLanguages: ('vi' | 'en')[];
  defaultLanguage: 'vi' | 'en';
  legacyPaths: string[];
}> {
  if (pointer !== undefined) {
    try { parsePointer(pointer); }
    catch (error) {
      if (error instanceof PatchError) throw new StudioMcpError(error.code);
      throw error;
    }
  }

  const course = await readCourseState(db, actor, courseId);
  const item = findDraftItem(course.draft, itemId);
  if (!item) throw new StudioMcpError('ITEM_NOT_FOUND');
  const itemHash = course.canEdit ? `sha256:${await checksumOf(item.document)}` : undefined;
  const readerView = course.canEdit ? null : redactItemDocument(item.document);
  const safeDocument = readerView?.document ?? item.document;
  const redactedPaths = readerView?.redactedPaths ?? [];
  const selectedPointer = pointer ?? '';
  if (pointsIntoRedaction(selectedPointer, redactedPaths)) throw new StudioMcpError('POINTER_REDACTED');

  let document: unknown;
  try { document = resolvePointer(safeDocument, selectedPointer); }
  catch (error) {
    if (error instanceof PatchError) throw new StudioMcpError(error.code);
    throw error;
  }
  const bytes = jsonBytes(document);
  if (bytes > MAX_WHOLE_ITEM_BYTES) {
    throw new StudioMcpError('ITEM_TOO_LARGE_USE_POINTER');
  }

  const { languages, defaultLanguage } = courseLanguages(course.draft.manifest);
  let legacyPaths: string[] = [];
  try {
    const context = profileContextFromDraft(
      { manifest: course.draft.manifest, items: course.draft.items },
      { target: { id: itemId, kind: item.kind } },
    );
    const verdict = checkAuthoringProfile(item.document, item.document, context);
    legacyPaths = verdict.warnings
      .filter((issue) => issue.code === 'W_PROFILE_LEGACY_UNCHANGED')
      .flatMap((issue) => {
        if (typeof issue.meta?.paths !== 'string') return [issue.path];
        try {
          const paths: unknown = JSON.parse(issue.meta.paths);
          return Array.isArray(paths) && paths.every((path) => typeof path === 'string')
            ? paths as string[] : [issue.path];
        } catch { return [issue.path]; }
      });
  } catch {
    // A legacy draft can still be read even if its authoring context is malformed.
  }
  return {
    kind: item.kind, moduleId: item.moduleId, document, pointer: selectedPointer,
    ...(itemHash ? { itemHash } : {}),
    draftUpdatedAt: course.draft.updatedAt,
    revision: course.draft.revision ?? '',
    bytes, redacted: !course.canEdit, redactedPaths, canEdit: course.canEdit,
    courseLanguages: languages, defaultLanguage, legacyPaths,
  };
}
