import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/api';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveMcpPrincipal } from '../auth/principal';
import { MCP_MAX_BODY_BYTES, MCP_MAX_JSON_DEPTH } from '../config';
import { mcpAllowedOrigins, mcpEnabled, mcpResourceUrl } from '../config';
import { createReadOnlyDatabase, type ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError, mcpErrorPayload } from '../errors';
import { logMcpEvent, reportMcpInternalError } from '../log';
import { serveStudioMcp } from '../server';
import { mcpBearerChallenge } from './challenge';
import { mcpCorsHeaders, validateMcpOrigin } from './origin';

function assertJsonDepth(value: unknown): void {
  const stack = [{ value, depth: 1 }];
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.depth > MCP_MAX_JSON_DEPTH) throw new StudioMcpError('INVALID_INPUT');
    if (Array.isArray(entry.value)) {
      for (const nested of entry.value) stack.push({ value: nested, depth: entry.depth + 1 });
    } else if (typeof entry.value === 'object' && entry.value !== null) {
      for (const nested of Object.values(entry.value)) stack.push({ value: nested, depth: entry.depth + 1 });
    }
  }
}

/** Bounds memory before parsing and before handing the request to the MCP SDK. */
export async function readBoundedJson(request: Request): Promise<{ body: Uint8Array; json: unknown }> {
  const contentType = request.headers.get('content-type')?.toLowerCase().split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') throw new StudioMcpError('UNSUPPORTED_MEDIA_TYPE');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_BODY_BYTES) throw new StudioMcpError('PAYLOAD_TOO_LARGE');
  if (!request.body) throw new StudioMcpError('INVALID_INPUT');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MCP_MAX_BODY_BYTES) throw new StudioMcpError('PAYLOAD_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new StudioMcpError('INVALID_INPUT'); }
  assertJsonDepth(json);
  return { body, json };
}

export function mcpUnauthIpKey(request: Request): string {
  const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const identity = /^[A-Fa-f0-9:.]{3,64}$/.test(forwarded) ? forwarded : 'shared';
  return `mcpUnauthIp:ip:${createHash('sha256').update(identity).digest('hex')}`;
}

function httpError(error: StudioMcpError, origin: string | null): Response {
  const headers = mcpCorsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (error.code === 'UNAUTHENTICATED') headers.set('WWW-Authenticate', mcpBearerChallenge());
  if (error.retryAfterSeconds !== undefined) headers.set('Retry-After', String(error.retryAfterSeconds));
  return new Response(JSON.stringify(mcpErrorPayload(error)), { status: error.status, headers });
}

function withMcpHeaders(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  mcpCorsHeaders(origin).forEach((value, key) => headers.set(key, value));
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function limitUnauthenticated(db: ReadOnlyDatabase, request: Request): Promise<void> {
  try {
    await enforceRateLimit(db, mcpUnauthIpKey(request), RATE_LIMITS.mcpUnauthIp);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
      throw new StudioMcpError('RATE_LIMITED', { retryAfterSeconds: 60 });
    }
    throw new StudioMcpError('RATE_LIMIT_UNAVAILABLE');
  }
}

/** The public route's transport and authentication boundary. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const correlationId = randomUUID();
  const started = Date.now();
  let origin: string | null = null;
  let userId: string | undefined;
  let clientId: string | undefined;
  let inputBytes: number | undefined;
  let response: Response;
  try {
    if (!mcpEnabled()) throw new StudioMcpError('MCP_DISABLED');
    origin = validateMcpOrigin(request.headers.get('origin'), mcpAllowedOrigins());
    const resource = mcpResourceUrl();
    if (new URL(request.url).origin !== resource.origin) {
      logMcpEvent({ event: 'security', outcome: 'resource_origin_mismatch', correlationId });
    }
    if (request.method === 'OPTIONS' && origin) {
      const headers = mcpCorsHeaders(origin);
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version');
      headers.set('Access-Control-Max-Age', '600');
      response = new Response(null, { status: 204, headers });
    } else if (request.method !== 'POST') {
      const headers = mcpCorsHeaders(origin);
      headers.set('Allow', 'POST, OPTIONS');
      response = new Response(null, { status: 405, headers });
    } else {
      const parsed = await readBoundedJson(request);
      inputBytes = parsed.body.byteLength;
      const db = createReadOnlyDatabase();
      let principal;
      try { principal = await resolveMcpPrincipal(request, db); }
      catch (error) {
        if (error instanceof StudioMcpError && error.code === 'UNAUTHENTICATED') {
          await limitUnauthenticated(db, request);
        }
        throw error;
      }
      userId = principal.verified.userId;
      clientId = principal.verified.clientId;
      response = withMcpHeaders(await serveStudioMcp(request, parsed.json, principal, db, correlationId), origin);
    }
  } catch (error) {
    if (error instanceof StudioMcpError) response = httpError(error, origin);
    else {
      reportMcpInternalError(error, correlationId);
      response = httpError(new StudioMcpError('INTERNAL', { correlationId }), origin);
    }
  }
  logMcpEvent({ event: 'request', outcome: String(response.status), correlationId,
    userId, clientId, inputBytes, durationMs: Date.now() - started });
  return response;
}
