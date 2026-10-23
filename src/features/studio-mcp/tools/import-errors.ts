import { ApiError } from '@/lib/api';

import { PatchError } from '../data/patch';
import { StudioMcpError, type StudioMcpErrorCode } from '../errors';
import { ImportPackageError } from '../import-package';
import { StudioImportFailure } from '../validation/simulate-import';
import { VerifyImportError } from '../validation/verify-import';
import { PreparationProofError } from '../validation/preparation-proof';

const IMPORT_CODES = new Set<StudioMcpErrorCode>([
  'BASE_HASH_REQUIRED', 'BASE_ITEM_CHANGED', 'BASE_DRAFT_UNSAVEABLE',
  'COURSE_NOT_FOUND_OR_FORBIDDEN', 'IMMUTABLE_KIND', 'INVALID_INPUT',
  'ITEM_NOT_FOUND', 'REFERENCE_LOOKUP_UNAVAILABLE', 'SERVICE_UNAVAILABLE',
  'VALIDATION_FAILED',
]);

/** Convert expected import failures to fixed MCP messages without returning course text. */
export function rethrowImportError(cause: unknown): never {
  if (cause instanceof StudioMcpError) throw cause;
  if (cause instanceof PatchError) throw new StudioMcpError(cause.code);
  if (cause instanceof StudioImportFailure) {
    const code = IMPORT_CODES.has(cause.code as StudioMcpErrorCode) ? cause.code as StudioMcpErrorCode : 'INVALID_INPUT';
    throw new StudioMcpError(code);
  }
  if (cause instanceof ImportPackageError) {
    throw new StudioMcpError(cause.code, cause.issues ? { issues: [...cause.issues] } : {});
  }
  if (cause instanceof VerifyImportError) throw new StudioMcpError(cause.code);
  if (cause instanceof PreparationProofError) throw new StudioMcpError(cause.code);
  if (cause instanceof ApiError) {
    if (cause.code === 'DRAFT_NOT_FOUND') throw new StudioMcpError('ITEM_NOT_FOUND');
    if (cause.code === 'DATABASE_ERROR') throw new StudioMcpError('SERVICE_UNAVAILABLE');
  }
  throw cause;
}
