import { CURRENT_SCHEMA_VERSION, DOCUMENT_KINDS, type DocumentKind } from '../schema/common';
import { detectKind, SCHEMAS_BY_KIND, type AnyDocument } from '../schema/document';
import { fromZodError, makeDiagnostic, toRef, type Diagnostic, type DocumentRef } from '../diagnostics';
import type { z } from 'zod';

export type ValidatedDocument = { [K in DocumentKind]: { ok: true; kind: K; doc: z.infer<(typeof SCHEMAS_BY_KIND)[K]>; diagnostics: Diagnostic[] } }[DocumentKind];
export type StructuralResult = ValidatedDocument | { ok: false; diagnostics: Diagnostic[] };

export function validateDocument(raw: unknown, doc: string | DocumentRef): StructuralResult {
  const ref = toRef(doc);
  const kind = detectKind(raw);
  if (!kind) {
    const received = typeof raw === 'object' && raw !== null ? String((raw as { kind?: unknown }).kind ?? 'missing') : typeof raw;
    return { ok: false, diagnostics: [makeDiagnostic('E_UNKNOWN_KIND', { ref, path: '/kind', meta: { received, valid: DOCUMENT_KINDS.join(', ') } })] };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, diagnostics: [makeDiagnostic('E_SCHEMA_VERSION_UNSUPPORTED', { ref, path: '/schemaVersion', meta: { received: String(version ?? 'missing'), expected: CURRENT_SCHEMA_VERSION } })] };
  }
  const parsed = SCHEMAS_BY_KIND[kind].safeParse(raw);
  if (!parsed.success) return { ok: false, diagnostics: fromZodError(parsed.error, ref) };
  return { ok: true, kind, doc: parsed.data as AnyDocument, diagnostics: [] } as ValidatedDocument;
}
