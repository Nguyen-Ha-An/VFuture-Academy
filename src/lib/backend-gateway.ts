/**
 * Server-side HTTP gateway credential transport, independent of database clients.
 *
 * When SUPABASE_GATEWAY_KEY is set, server-side Supabase HTTP clients send it as
 * the `x-vfuture-gateway-key` header so the gateway can refuse traffic that did
 * not originate from the application. When it is unset (hosted Supabase, local
 * development) nothing is added and every client behaves exactly as before.
 *
 * This module deliberately does not import Next's `server-only` guard because
 * operational scripts share it, but it must never be imported by browser code
 * (src/lib/supabase/client.ts, src/lib/env-client.ts): the value is a secret
 * and has no NEXT_PUBLIC_ counterpart.
 */

export const SUPABASE_GATEWAY_KEY_HEADER = 'x-vfuture-gateway-key';

/** Header-safe token: base64, base64url or hex (for example `openssl rand -base64 48`). */
export const SUPABASE_GATEWAY_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{32,512}$/;

/** NodeJS.ProcessEnv or any plain env-like record; not a weak (all-optional) type. */
export type GatewayKeySource = Readonly<Record<string, string | undefined>>;

/** Names the variable but never carries the rejected value. */
function invalidGatewayKey(): Error {
  return new Error('Invalid SUPABASE_GATEWAY_KEY');
}

function readGatewayKey(source: GatewayKeySource): string | undefined {
  const value = source.SUPABASE_GATEWAY_KEY;
  if (value === undefined || value === '') return undefined;
  if (!SUPABASE_GATEWAY_KEY_PATTERN.test(value)) throw invalidGatewayKey();
  return value;
}

/** Returns the header map to add, or undefined when no gateway key is configured. */
export function gatewayHeaders(
  source: GatewayKeySource = process.env,
): Record<string, string> | undefined {
  const key = readGatewayKey(source);
  return key === undefined ? undefined : { [SUPABASE_GATEWAY_KEY_HEADER]: key };
}

export type GatewayClientOptions = { global: { headers: Record<string, string>; fetch: typeof fetch } };

/**
 * The Supabase client option fragment that carries the gateway header, meant to be
 * spread into a client's options literal: `{ auth: {...}, ...gatewayClientOptions() }`.
 * It is deliberately not a generic wrapper, so the literal keeps the library's own
 * contextual typing (auth options, SSR cookie callbacks). With no key configured it
 * is undefined, and spreading it adds no `global` key at all.
 */
export function gatewayClientOptions(
  source: GatewayKeySource = process.env,
  supabaseUrl: string | undefined = source.NEXT_PUBLIC_SUPABASE_URL,
): GatewayClientOptions | undefined {
  const headers = gatewayHeaders(source);
  const fetcher = gatewayFetch(source, undefined, supabaseUrl);
  return headers && fetcher ? { global: { headers, fetch: fetcher } } : undefined;
}

/** A fetch wrapper that adds the gateway header, for direct Supabase HTTP calls; undefined when unset. */
export function gatewayFetch(
  source: GatewayKeySource = process.env,
  baseFetch?: typeof fetch,
  supabaseUrl: string | undefined = source.NEXT_PUBLIC_SUPABASE_URL,
): typeof fetch | undefined {
  const headers = gatewayHeaders(source);
  if (!headers) return undefined;
  let trustedOrigin: string;
  try {
    const trusted = new URL(supabaseUrl ?? '');
    if (!['http:', 'https:'].includes(trusted.protocol) || trusted.username || trusted.password) throw new Error();
    trustedOrigin = trusted.origin;
  } catch {
    throw new Error('Invalid Supabase gateway URL');
  }
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const target = new URL(request?.url ?? String(input));
    const merged = new Headers(init?.headers ?? request?.headers);
    merged.delete(SUPABASE_GATEWAY_KEY_HEADER);
    if (target.origin === trustedOrigin) {
      for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    }
    // Fetch can forward custom headers across redirects. Refuse redirects before
    // the transport follows one, including when the caller requests `follow`.
    return (baseFetch ?? fetch)(input, { ...init, headers: merged, redirect: 'error' });
  };
}
