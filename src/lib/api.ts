import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError as BaseApiError, type ValidationIssue } from '@/lib/api-error';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { reportError } from '@/lib/observability';

export type { ValidationIssue } from '@/lib/api-error';
export { toValidationIssues } from '@/lib/api-error';

/** An expected client-facing failure with optional HTTP response metadata. */
export class ApiError extends BaseApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    issues?: ValidationIssue[],
    public readonly headers?: HeadersInit,
  ) {
    super(status, code, message, issues);
  }
}

type ErrorEnvelope = { error: { code: string; message: string; issues?: ValidationIssue[]; correlationId?: string } };

/** Creates the standard successful JSON envelope used by route handlers. */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

/** Creates the standard error JSON envelope without any internal details. */
export function fail(
  status: number,
  code: string,
  message: string,
  issues?: ValidationIssue[],
  headers?: HeadersInit,
) {
  const error: ErrorEnvelope['error'] = issues === undefined ? { code, message } : { code, message, issues };
  return NextResponse.json({ error } satisfies ErrorEnvelope, { status, headers });
}

type HandlerResult = Response | unknown;
type Handler = (request: Request, context?: unknown) => Promise<HandlerResult> | HandlerResult;

function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string'
    && (
      digest.startsWith('NEXT_REDIRECT')
      || digest.startsWith('NEXT_NOT_FOUND')
      || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
    );
}

function rethrowNextControlFlowError(error: unknown): void {
  if (typeof unstable_rethrow === 'function') {
    unstable_rethrow(error);
  }
  if (isNextControlFlowError(error)) throw error;
}

/**
 * Wraps an API route in uniform success and error envelopes. Unexpected
 * exceptions are correlated with a server log while callers receive no
 * internal or secret-bearing details.
 */
export function withHandler(handler: Handler) {
  return async (request: Request, context?: unknown): Promise<Response> => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (request.headers.get('sec-fetch-site') === 'cross-site'
          || (origin !== null && origin !== new URL(request.url).origin)) {
          throw new ApiError(403, 'FORBIDDEN', 'Cross-origin request denied');
        }
      }
      const result = await handler(request, context);
      return result instanceof Response ? result : ok(result);
    } catch (error) {
      rethrowNextControlFlowError(error);
      if (error instanceof BaseApiError) {
        const headers = 'headers' in error ? (error as BaseApiError & { headers?: HeadersInit }).headers : undefined;
        return fail(error.status, error.code, error.message, error.issues, headers);
      }
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(({ path, message }) => ({
          path: path.map((segment) => typeof segment === 'number' ? segment : String(segment)),
          message,
        }));
        return fail(400, 'VALIDATION_ERROR', 'Request validation failed', issues);
      }
      const correlationId = reportError(error, {
        area: 'api',
        method: request.method,
        pathname: new URL(request.url).pathname,
      });
      return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal error', correlationId } } satisfies ErrorEnvelope, { status: 500 });
    }
  };
}

/** Parses a JSON request body and validates it at the route boundary. */
export async function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  request: Request,
  { maxBytes = 2 * 1024 * 1024 }: { maxBytes?: number } = {},
): Promise<z.output<Schema>> {
  return schema.parse(await readJsonBodyLimited(request, maxBytes));
}
