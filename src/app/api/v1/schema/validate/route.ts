import { z } from 'zod';

import { emptySummary, itemRef, type ValidationReport } from '@/content-engine/diagnostics';
import { detectKind } from '@/content-engine/schema/document';
import {
  InMemoryResolver,
  validateStandaloneDocument,
  validateWorkspace,
  workspaceFromDocuments,
} from '@/content-engine/validate';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import {
  RATE_LIMITS,
  enforceRequestRateLimit,
} from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const ValidateRequestSchema = z.object({
  documents: z.array(z.unknown()).min(1).max(50),
}).strict();

const MAX_VALIDATE_BODY_BYTES = 512 * 1024;

/**
 * Public validation resolves nothing. An empty in-memory resolver keeps this route
 * away from the protected reference tables entirely: a caller cannot use it to
 * probe which bank questions, assets, resources or branches exist. Unresolvable
 * references are reported as unresolved, which is the honest answer here.
 */
const resolver = new InMemoryResolver({});

async function validateDocuments(documents: unknown[]): Promise<ValidationReport> {
  if (documents.some((document) => detectKind(document) === 'course')) {
    const workspace = workspaceFromDocuments(documents);
    const report = await validateWorkspace(workspace, resolver);
    // Documents that collided or could not be classified never reach the workspace
    // map, so their diagnostics are merged back in rather than lost.
    if (!workspace.duplicates.length) return report;
    const errors = [...workspace.duplicates.filter((d) => d.severity === 'error'), ...report.errors];
    const warnings = [...workspace.duplicates.filter((d) => d.severity !== 'error'), ...report.warnings];
    return { ...report, ok: errors.length === 0, errors, warnings };
  }

  const reports = await Promise.all(documents.map(async (document, index) => {
    const value = typeof document === 'object' && document !== null ? document as { id?: unknown } : {};
    const docId = typeof value.id === 'string' ? value.id : `document-${index + 1}`;
    return (await validateStandaloneDocument(document, itemRef(docId), resolver)).report;
  }));
  const errors = reports.flatMap((report) => report.errors);
  const warnings = reports.flatMap((report) => report.warnings);
  return { ok: errors.length === 0, errors, warnings, summary: emptySummary() };
}

/** Validates public content without resolving references through application tables. */
export const POST = withHandler(async (request) => {
  const database = supabaseService();
  await enforceRequestRateLimit(
    database,
    'schema:validate',
    request,
    RATE_LIMITS.validation,
  );
  // Public endpoint: strict parsing, its own smaller budget, and no reference tables.
  const { documents } = ValidateRequestSchema.parse(await readStrictJsonBodyLimited(request, {
    maxBytes: MAX_VALIDATE_BODY_BYTES,
    contentBytes: MAX_VALIDATE_BODY_BYTES,
  }));
  return Response.json(await validateDocuments(documents));
});
