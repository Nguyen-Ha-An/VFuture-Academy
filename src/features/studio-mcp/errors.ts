export const MCP_ERROR_MESSAGES = {
  UNAUTHENTICATED: 'Authentication is required.',
  ACCOUNT_SUSPENDED: 'This account is suspended.',
  ACCOUNT_NOT_PROVISIONED: 'This account is not provisioned.',
  MCP_ACCESS_BLOCKED: 'Studio MCP access is blocked for this account.',
  NOT_A_TESTER: 'This account is not enabled for the test phase.',
  MCP_DISABLED: 'Studio MCP is unavailable.',
  ORIGIN_FORBIDDEN: 'This origin is not allowed.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'The request must use application/json.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  RATE_LIMIT_UNAVAILABLE: 'The rate limit service is unavailable.',
  REFERENCE_LOOKUP_UNAVAILABLE: 'A reference lookup is temporarily unavailable.',
  INVALID_INPUT: 'The input is invalid.',
  INVALID_SCOPE: 'The requested scope is unavailable.',
  PERMISSION_DENIED: 'Permission denied.',
  COURSE_NOT_FOUND_OR_FORBIDDEN: 'Course not found or access denied.',
  ITEM_NOT_FOUND: 'Item not found.',
  IMMUTABLE_KIND: 'This item kind cannot be changed.',
  POINTER_REDACTED: 'The requested pointer is unavailable.',
  E_PATCH_POINTER_INVALID: 'The patch pointer is invalid.',
  PATCH_FAILED: 'The patch could not be applied.',
  ITEM_TOO_LARGE_USE_POINTER: 'The requested item content is too large; request a narrower JSON pointer.',
  BASE_HASH_REQUIRED: 'A base item hash is required.',
  BASE_ITEM_CHANGED: 'The item changed; read it again before preparing an import.',
  VALIDATION_FAILED: 'Validation failed.',
  REVIEW_PENDING: 'A review is pending for this course.',
  WORKSPACE_TOO_LARGE: 'The workspace is too large.',
  BASE_DRAFT_UNSAVEABLE: 'The current draft cannot be saved.',
  ITEM_TOO_LARGE_TO_PASTE: 'The item is too large to paste.',
  IMPORT_TEXT_MISMATCH: 'The import text does not match the proposed item.',
  PREPARATION_PROOF_INVALID: 'The preparation proof is invalid or does not match this import.',
  PREPARATION_PROOF_EXPIRED: 'The preparation proof expired. Prepare a new import.',
  OUTPUT_TOO_LARGE: 'The result is too large; request a smaller part.',
  INTERNAL: 'An unexpected server error occurred.',
} as const;

export type StudioMcpErrorCode = keyof typeof MCP_ERROR_MESSAGES;

const HTTP_STATUS: Partial<Record<StudioMcpErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_NOT_PROVISIONED: 403,
  MCP_ACCESS_BLOCKED: 403,
  NOT_A_TESTER: 403,
  MCP_DISABLED: 404,
  ORIGIN_FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  RATE_LIMIT_UNAVAILABLE: 503,
  REFERENCE_LOOKUP_UNAVAILABLE: 503,
  INVALID_INPUT: 400,
  INTERNAL: 500,
};

export class StudioMcpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    readonly code: StudioMcpErrorCode,
    options: { retryAfterSeconds?: number; correlationId?: string; issues?: unknown[] } = {},
  ) {
    super(MCP_ERROR_MESSAGES[code]);
    this.name = 'StudioMcpError';
    this.status = HTTP_STATUS[code] ?? 400;
    this.retryable = code === 'RATE_LIMITED' || code === 'SERVICE_UNAVAILABLE'
      || code === 'RATE_LIMIT_UNAVAILABLE' || code === 'REFERENCE_LOOKUP_UNAVAILABLE';
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.correlationId = options.correlationId;
    this.issues = options.issues;
  }
  readonly retryAfterSeconds?: number;
  readonly correlationId?: string;
  readonly issues?: unknown[];
}

function safeIssue(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const issue = value as Record<string, unknown>;
  const safe: Record<string, string> = {};
  if (typeof issue.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(issue.code)) safe.code = issue.code;
  if (typeof issue.pointer === 'string' && issue.pointer.length <= 512 && /^\/(?:[A-Za-z0-9_$~.\-/]*)$/.test(issue.pointer)) safe.pointer = issue.pointer;
  if (issue.layer === 'profile' || issue.layer === 'patch' || issue.layer === 'parse' || issue.layer === 'document'
    || issue.layer === 'import' || issue.layer === 'workspace' || issue.layer === 'save') safe.layer = issue.layer;
  if (issue.severity === 'error' || issue.severity === 'warning') safe.severity = issue.severity;
  return safe;
}

export function mcpErrorPayload(error: StudioMcpError) {
  return { error: {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    ...(error.correlationId === undefined ? {} : { correlationId: error.correlationId }),
    ...(error.issues === undefined ? {} : { issues: error.issues.slice(0, 100).map(safeIssue) }),
  } };
}

export function mcpToolErrorResult(error: StudioMcpError) {
  return { isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify(mcpErrorPayload(error)) }] };
}
