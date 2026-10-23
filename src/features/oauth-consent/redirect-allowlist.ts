import { isAllowedMcpRedirectUri } from '@/features/studio-mcp/auth/client-allowlist';

export type AllowedConsentCallback = Readonly<{ uri: string; host: string }>;

/** Exact destinations accepted for this first-party Studio MCP connection. */
export function allowedConsentCallback(value: unknown): AllowedConsentCallback | null {
  if (typeof value !== 'string' || value.length > 2_048 || value.trim() !== value) return null;
  if (!isAllowedMcpRedirectUri(value)) return null;
  try {
    const url = new URL(value);
    return { uri: value, host: url.hostname };
  } catch {
    return null;
  }
}

/** Supabase adds code/error and state as query parameters after the decision. */
export function allowedConsentReturn(value: unknown, expectedCallback?: string): string | null {
  if (typeof value !== 'string' || value.length > 8_192 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password || url.href !== value) return null;
    const callback = `${url.origin}${url.pathname}`;
    if (!allowedConsentCallback(callback)) return null;
    if (expectedCallback !== undefined && callback !== expectedCallback) return null;
    return value;
  } catch {
    return null;
  }
}
