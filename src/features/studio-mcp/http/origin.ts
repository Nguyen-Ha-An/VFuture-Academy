import { StudioMcpError } from '../errors';

/** A missing Origin is valid for server-side MCP clients; present values require an exact match. */
export function validateMcpOrigin(origin: string | null, allowedOrigins: readonly string[]): string | null {
  if (origin === null) return null;
  if (!allowedOrigins.includes(origin)) throw new StudioMcpError('ORIGIN_FORBIDDEN');
  return origin;
}

export function mcpCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Protocol-Version',
    Vary: 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}
