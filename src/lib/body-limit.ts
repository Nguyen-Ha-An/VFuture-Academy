import { COURSE_REF, type DocumentRef } from '@/content-engine/diagnostics';
import { jsonDepth, MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES, MAX_JSON_DEPTH, parseJsonDocument } from '@/content-engine/validate/parse';
import { ApiError, toValidationIssues } from '@/lib/api-error';

/**
 * The HTTP envelope cap, deliberately larger than one content document's
 * 1,048,576-byte limit: a request carries a whole workspace plus JSON escaping, and
 * the per-document limit belongs to the parser, not to every API route. Nothing here
 * applies the document cap — routes that carry documents get it from
 * `parseJsonDocument`.
 */
export const MAX_WIRE_BODY_BYTES = 2 * 1024 * 1024;

const DEFAULT_MAX_BYTES = MAX_WIRE_BODY_BYTES;

function payloadTooLarge(maxBytes: number): ApiError {
  return new ApiError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds the ${maxBytes} byte limit`);
}

function assertDeclaredLength(request: Request, maxBytes: number): void {
  const raw = request.headers.get('content-length');
  if (raw === null || !/^\d+$/.test(raw.trim())) return;
  try {
    if (BigInt(raw.trim()) > BigInt(maxBytes)) throw payloadTooLarge(maxBytes);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw payloadTooLarge(maxBytes);
  }
}

/** Reads a request body while enforcing the byte cap for declared and streamed bodies. */
export async function readBodyLimited(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer');
  assertDeclaredLength(request, maxBytes);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readTextBodyLimited(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBodyLimited(request, maxBytes));
}

/**
 * Strict UTF-8 decode for authored content.
 *
 * A default `TextDecoder` is helpful in exactly the wrong way here: it silently
 * swallows a leading byte order mark and replaces every malformed byte sequence with
 * U+FFFD. Both repairs happen before the strict parser can see anything, so a BOM the
 * contract rejects would look like clean input, and corrupted bytes would be stored
 * as replacement characters. `ignoreBOM` keeps the mark in the string so the parser
 * can reject it by name, and `fatal` turns bad bytes into an error instead of a guess.
 */
export function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ApiError(400, 'INVALID_ENCODING', 'Request body must be valid UTF-8');
  }
}

export async function readStrictTextBodyLimited(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  return decodeStrictUtf8(await readBodyLimited(request, maxBytes));
}

export async function readJsonBodyLimited(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  const text = await readTextBodyLimited(request, maxBytes);
  if (jsonDepth(text) > MAX_JSON_DEPTH) {
    throw new ApiError(400, 'JSON_NESTING_TOO_DEEP', `Request body nesting exceeds ${MAX_JSON_DEPTH} levels`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

export interface StrictJsonBodyOptions {
  /** Wire budget for the request. Defaults to the envelope limit. */
  maxBytes?: number;
  /**
   * Budget the strict parser applies to the decoded text. Defaults to one
   * document's limit; an envelope route sets `envelope: true` instead.
   */
  contentBytes?: number;
  /**
   * This body is a multi-document envelope (a workspace save, a recovery import),
   * so the text itself gets the envelope budget. The documents inside it are still
   * held to the per-document limit by the service that unpacks them.
   */
  envelope?: boolean;
  /** Which document diagnostics belong to. */
  ref?: DocumentRef;
  /** Treat an empty body as `{}` — for routes whose body is entirely optional. */
  emptyAsObject?: boolean;
}

/**
 * Reads a JSON request body through the strict content parser instead of
 * `JSON.parse`.
 *
 * The difference matters on any route that carries authored content: `JSON.parse`
 * accepts a duplicate property and silently keeps the last one, and by the time the
 * value is re-serialized the evidence that the author wrote two is gone. Routes that
 * accept documents read them here so a duplicate key, a non-finite number, a BOM,
 * malformed UTF-8 or a non-object root is rejected with a diagnostic while it can
 * still be pointed at — and so that a client bypassing the editor cannot get past
 * checks the editor performs.
 *
 * The wire limit and the content limit stay separate: `maxBytes` bounds the request,
 * `contentBytes` (or `envelope`) bounds the content inside it.
 */
export async function readStrictJsonBodyLimited(request: Request, opts: StrictJsonBodyOptions = {}): Promise<unknown> {
  const wireBytes = opts.maxBytes ?? MAX_ENVELOPE_BYTES;
  const contentBytes = opts.contentBytes ?? (opts.envelope ? MAX_ENVELOPE_BYTES : MAX_DOCUMENT_BYTES);
  const text = await readStrictTextBodyLimited(request, wireBytes);
  if (opts.emptyAsObject && text.trim() === '') return {};
  const parsed = parseJsonDocument(text, opts.ref ?? COURSE_REF, { rootType: 'object', maxBytes: contentBytes });
  if (parsed.errors.length) {
    // The limit failures keep the codes callers already handle; the structured
    // diagnostics ride along as issues either way.
    const limit = parsed.errors.find((error) => error.code === 'E_LIMIT_EXCEEDED');
    const issues = toValidationIssues(parsed.errors);
    if (limit?.meta?.limit === 'depth') {
      throw new ApiError(400, 'JSON_NESTING_TOO_DEEP', `Request body nesting exceeds ${MAX_JSON_DEPTH} levels`, issues);
    }
    if (limit?.meta?.limit === 'bytes') {
      throw new ApiError(413, 'DOCUMENT_TOO_LARGE', `Content exceeds the ${contentBytes} byte limit`, issues);
    }
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a strictly valid JSON object', issues);
  }
  return parsed.value;
}
