import { reportError } from '@/lib/observability';

type Event = {
  event: 'request' | 'tool' | 'security' | 'consent';
  outcome: string;
  correlationId?: string;
  userId?: string;
  clientId?: string;
  clientName?: string;
  tool?: string;
  courseId?: string;
  itemId?: string;
  inputBytes?: number;
  outputBytes?: number;
  durationMs?: number;
  code?: string;
};

const SAFE_ID = /^[A-Za-z0-9_:.\-]{1,128}$/;
const SAFE_CLIENT_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._-]{0,79}$/u;

/** Metadata only: no request bodies, content, tokens, or arbitrary error messages. */
export function logMcpEvent(event: Event): void {
  const sanitized: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(event)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) sanitized[key] = value;
    if (typeof value === 'string' && key === 'clientName' && SAFE_CLIENT_NAME.test(value) && !value.includes('eyJ')) sanitized[key] = value;
    else if (typeof value === 'string' && key !== 'clientName' && SAFE_ID.test(value) && !value.includes('eyJ')) sanitized[key] = value;
  }
  console.info(JSON.stringify({ source: 'studio-mcp', ...sanitized }));
}

export function reportMcpInternalError(error: unknown, correlationId: string): void {
  // Upstream error messages can contain course content, so report only a fixed
  // marker while retaining the correlation id for request and tool logs.
  void error;
  reportError(new Error('Studio MCP internal error'), { correlationId, source: 'studio-mcp' });
}
