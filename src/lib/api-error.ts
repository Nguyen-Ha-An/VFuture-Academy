/**
 * The public issue contract. `path` and `message` are the original fields and stay
 * exactly as they were; the rest is additive, carrying the structured diagnostic
 * through the envelope instead of flattening a code and a JSON Pointer into a string
 * the UI then has to guess at. Every field beyond `path`/`message` is optional, so
 * unrelated producers of `ValidationIssue` keep compiling.
 */
export type ValidationIssue = {
  path: (string | number)[];
  message: string;
  /** Diagnostic code, e.g. `E_JSON_DUPLICATE_KEY`. */
  code?: string;
  severity?: 'error' | 'warning' | 'info';
  /** Which document the issue belongs to. */
  ref?: { kind: 'course' } | { kind: 'item'; id: string };
  /** Legacy document label; `'manifest'` means the course document. */
  docId?: string;
  /** JSON Pointer within that document. */
  pointer?: string;
  /** Bilingual message, when the producer had one. */
  localizedMessage?: { vi: string; en: string };
  range?: { start: { line: number; col: number }; end: { line: number; col: number } };
  /** Source revision the issue was computed from. */
  revision?: string;
};

/** An expected client-facing failure from an API route. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function issuePath(value: unknown): (string | number)[] {
  if (Array.isArray(value)) {
    return value.map((segment) => typeof segment === 'number' || typeof segment === 'string'
      ? segment
      : String(segment));
  }
  if (typeof value !== 'string') return [];
  return value.split('/').filter(Boolean).map((segment) => {
    const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
  });
}

function issueRef(value: unknown): ValidationIssue['ref'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const ref = value as { kind?: unknown; id?: unknown };
  if (ref.kind === 'course') return { kind: 'course' };
  if (ref.kind === 'item' && typeof ref.id === 'string') return { kind: 'item', id: ref.id };
  return undefined;
}

function issueRange(value: unknown): ValidationIssue['range'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const range = value as { start?: { line?: unknown; col?: unknown }; end?: { line?: unknown; col?: unknown } };
  const point = (p?: { line?: unknown; col?: unknown }) => typeof p?.line === 'number' && typeof p?.col === 'number' ? { line: p.line, col: p.col } : undefined;
  const start = point(range.start), end = point(range.end);
  return start && end ? { start, end } : undefined;
}

/**
 * Converts validator-specific diagnostics to the public API issue contract.
 *
 * `path` and `message` keep their exact previous shape, including the leading
 * document segment, so existing clients and tests are unaffected. Everything the
 * diagnostic knew and the envelope used to discard — the code, the severity, the
 * document reference, the JSON Pointer, both languages, the source range and the
 * revision — now rides along beside it.
 */
export function toValidationIssues(issues: readonly unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const value = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : {};
    const localized = typeof value.message === 'object' && value.message !== null
      ? value.message as Record<string, unknown>
      : null;
    const message = typeof value.message === 'string'
      ? value.message
      : typeof localized?.en === 'string'
        ? localized.en
        : 'Invalid value';
    const path = issuePath(value.path);
    if (typeof value.docId === 'string' && path[0] !== value.docId) path.unshift(value.docId);
    const ref = issueRef(value.ref);
    const range = issueRange(value.range);
    const localizedMessage = typeof localized?.vi === 'string' && typeof localized?.en === 'string'
      ? { vi: localized.vi, en: localized.en }
      : undefined;
    return {
      path,
      message,
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(value.severity === 'error' || value.severity === 'warning' || value.severity === 'info' ? { severity: value.severity } : {}),
      ...(ref ? { ref } : {}),
      ...(typeof value.docId === 'string' ? { docId: value.docId } : {}),
      ...(typeof value.path === 'string' ? { pointer: value.path } : {}),
      ...(localizedMessage ? { localizedMessage } : {}),
      ...(range ? { range } : {}),
      ...(typeof value.revision === 'string' ? { revision: value.revision } : {}),
    };
  });
}
