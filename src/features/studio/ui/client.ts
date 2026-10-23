import {
  COURSE_REF, emptySummary, itemRef, makeDiagnostic, refFromDocId,
  type DiagnosticCode, type DocumentRef, type Range, type Severity, type ValidationReport,
} from '@/content-engine/diagnostics';

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; issues?: unknown[]; correlationId?: string } };

export class WorkspaceApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues?: unknown[],
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

export async function readApiData<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }
  if (!response.ok || envelope.data === undefined) {
    throw new WorkspaceApiError(
      envelope.error?.code ?? `HTTP_${response.status}`,
      envelope.error?.message ?? `Request failed (${response.status})`,
      envelope.error?.issues,
      envelope.error?.correlationId,
    );
  }
  return envelope.data;
}

const SEVERITIES = new Set(['error', 'warning', 'info']);

const isRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

function issueRef(value: unknown): DocumentRef | null {
  const row = isRecord(value);
  if (row?.kind === 'course') return COURSE_REF;
  if (row?.kind === 'item' && typeof row.id === 'string') return itemRef(row.id);
  return null;
}

function issueRange(value: unknown): Range | undefined {
  const row = isRecord(value);
  const start = isRecord(row?.start);
  const end = isRecord(row?.end);
  if (typeof start?.line !== 'number' || typeof start.col !== 'number') return undefined;
  if (typeof end?.line !== 'number' || typeof end.col !== 'number') return undefined;
  return { start: { line: start.line, col: start.col }, end: { line: end.line, col: end.col } };
}

/**
 * Legacy fallback only. `path` is `[docId, ...segments]`, so this cannot tell a
 * course manifest from an item whose id is literally `manifest` — which is exactly
 * why the server sends an explicit `ref` and why that is preferred whenever present.
 */
function refFromLegacyPath(parts: readonly (string | number)[], docId: unknown): DocumentRef {
  if (typeof docId === 'string') return refFromDocId(docId);
  if (parts[0] === 'items' && typeof parts[1] === 'string') return itemRef(parts[1]);
  return typeof parts[0] === 'string' && parts[0] !== 'manifest' ? itemRef(parts[0]) : COURSE_REF;
}

const encodeSegment = (segment: string | number): string =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Converts the public API validation envelope back into workspace diagnostics.
 *
 * The server already sends everything a diagnostic needs — `ref`, `code`,
 * `severity`, `pointer`, both message locales, `range` and `revision`. All of it is
 * carried through unchanged; re-deriving any of it from the `path` array would
 * downgrade every issue to a generic English error and, worse, collapse an item
 * named `manifest` onto the course document.
 */
export function workspaceIssueReport(issues: unknown[] | undefined): ValidationReport {
  const diagnostics = (issues ?? []).map((value) => {
    const issue = isRecord(value) ?? {};
    const parts = Array.isArray(issue.path)
      ? issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      : [];
    const ref = issueRef(issue.ref) ?? refFromLegacyPath(parts, issue.docId);
    const explicitPointer = typeof issue.pointer === 'string' ? issue.pointer : null;
    // Legacy payloads carry the document as the first path segment; drop it, plus
    // the `items` prefix the server used before `ref` existed.
    const tail = parts[0] === 'items' && typeof parts[1] === 'string' ? parts.slice(2) : parts.slice(1);
    const pointer = explicitPointer ?? (tail.length ? `/${tail.map(encodeSegment).join('/')}` : '');
    const localized = isRecord(issue.localizedMessage);
    const fallback = typeof issue.message === 'string' ? issue.message : 'Workspace validation failed';
    const message = typeof localized?.vi === 'string' && typeof localized?.en === 'string'
      ? { vi: localized.vi, en: localized.en }
      : { vi: fallback, en: fallback };
    const code = typeof issue.code === 'string' ? issue.code as DiagnosticCode : 'E_SCHEMA';
    const severity = typeof issue.severity === 'string' && SEVERITIES.has(issue.severity)
      ? issue.severity as Severity
      : undefined;
    return {
      ...makeDiagnostic(code, { ref, path: pointer, ...(severity ? { severity } : {}) }),
      message,
      ...(issueRange(issue.range) ? { range: issueRange(issue.range) } : {}),
      ...(typeof issue.revision === 'string' ? { revision: issue.revision } : {}),
    };
  });
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: errors.length === 0 && diagnostics.length === 0,
    errors,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity !== 'error'),
    summary: emptySummary(),
  };
}

export function workspaceErrorMessage(cause: unknown, localizedFallback: string): string {
  return cause instanceof WorkspaceApiError ? `${localizedFallback} (${cause.code})` : localizedFallback;
}
