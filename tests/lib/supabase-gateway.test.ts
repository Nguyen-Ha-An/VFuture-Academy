import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServerClient: vi.fn(),
  createBrowserClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
  createBrowserClient: mocks.createBrowserClient,
}));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  },
}));
vi.mock('@/lib/env-client', () => ({
  publicEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
}));

import {
  gatewayFetch,
  gatewayHeaders,
  gatewayClientOptions,
  SUPABASE_GATEWAY_KEY_HEADER,
} from '@/lib/backend-gateway';
import { supabaseBrowser } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';

// openssl rand -base64 48 style value (64 characters) and a hex value.
const GATEWAY_KEY = 'kT3vQ8n1Zp0xYw5uLr7sJc2bHd9eGf4aMi6oNq1VtXyAzBlCkD+EgFhIjKm/=';
const HEX_KEY = 'a'.repeat(64);
const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('SUPABASE_GATEWAY_KEY', '');
  mocks.createClient.mockReset().mockReturnValue({ auth: {}, marker: 'client' });
  mocks.createServerClient.mockReset().mockReturnValue({ marker: 'server-client' });
  mocks.createBrowserClient.mockReset().mockReturnValue({ marker: 'browser-client' });
  mocks.cookies.mockReset().mockResolvedValue({ getAll: () => [], set: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function lastOptions(mock: typeof mocks.createClient | typeof mocks.createServerClient) {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('client factory was not called');
  return call[2] as Record<string, unknown>;
}

describe('gateway key helper', () => {
  it('returns nothing when the key is unset or empty, adding no option keys', () => {
    expect(gatewayHeaders({})).toBeUndefined();
    expect(gatewayHeaders({ SUPABASE_GATEWAY_KEY: undefined })).toBeUndefined();
    expect(gatewayHeaders({ SUPABASE_GATEWAY_KEY: '' })).toBeUndefined();
    expect(gatewayClientOptions({})).toBeUndefined();
    expect(gatewayClientOptions({ SUPABASE_GATEWAY_KEY: '' })).toBeUndefined();
    expect(Object.keys({ auth: AUTH_OPTIONS, ...gatewayClientOptions({}) })).toEqual(['auth']);
    expect(gatewayFetch({})).toBeUndefined();
    expect(gatewayFetch({ SUPABASE_GATEWAY_KEY: '' })).toBeUndefined();
  });

  it('accepts NodeJS.ProcessEnv-shaped sources', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', UNRELATED: 'x' };

    expect(gatewayHeaders(env)).toBeUndefined();
    expect(gatewayHeaders({ ...env, SUPABASE_GATEWAY_KEY: GATEWAY_KEY })).toEqual({ 'x-vfuture-gateway-key': GATEWAY_KEY });
  });

  it('reads process.env by default', () => {
    expect(gatewayHeaders()).toBeUndefined();
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);
    expect(gatewayHeaders()).toEqual({ 'x-vfuture-gateway-key': GATEWAY_KEY });
    expect(SUPABASE_GATEWAY_KEY_HEADER).toBe('x-vfuture-gateway-key');
  });

  it.each([
    ['base64', GATEWAY_KEY],
    ['hex', HEX_KEY],
    ['base64url', 'Zm9vYmFyLWJhei1xdXgtMTIzNDU2Nzg5MC1BQkNERUZHSElKS0xNTk9QUVJTVA_-.~'],
    ['minimum length', 'x'.repeat(32)],
    ['maximum length', 'x'.repeat(512)],
  ])('accepts a %s token', (_name, value) => {
    expect(gatewayHeaders({ SUPABASE_GATEWAY_KEY: value })).toEqual({ 'x-vfuture-gateway-key': value });
  });

  it.each([
    ['too short', 'x'.repeat(31)],
    ['too long', 'x'.repeat(513)],
    ['interior whitespace', `${'x'.repeat(20)} ${'y'.repeat(20)}`],
    ['leading space', ` ${'x'.repeat(40)}`],
    ['trailing newline', `${'x'.repeat(40)}\n`],
    ['header injection', `${'x'.repeat(40)}\r\nx-evil: 1`],
    ['non-ascii', `${'x'.repeat(40)}é`],
    ['quote', `${'x'.repeat(40)}"`],
    ['comma', `${'x'.repeat(40)},${'y'.repeat(10)}`],
    ['whitespace only', ' '.repeat(40)],
  ])('rejects a malformed value (%s) without echoing it', (_name, value) => {
    let thrown: unknown;
    try {
      gatewayHeaders({ SUPABASE_GATEWAY_KEY: value });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error;
    expect(error.message).toContain('SUPABASE_GATEWAY_KEY');
    expect(error.message).not.toContain(value);
    expect(String(error.stack)).not.toContain(value.trim() || '\u0000never');
  });

  it('never includes a distinctive malformed value in the error', () => {
    const secret = 'DISTINCTIVE-SECRET-MARKER with spaces';
    let thrown: unknown;
    try {
      gatewayClientOptions({ SUPABASE_GATEWAY_KEY: secret });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toBe('Invalid SUPABASE_GATEWAY_KEY');
    expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object))).not.toContain('DISTINCTIVE');
  });

  it('yields a global fragment that spreads next to the other client options without replacing them', () => {
    const merged = { auth: AUTH_OPTIONS, ...gatewayClientOptions({ SUPABASE_GATEWAY_KEY: GATEWAY_KEY }, 'https://project.supabase.example') };

    expect(merged).toEqual({
      auth: AUTH_OPTIONS,
      global: { headers: { 'x-vfuture-gateway-key': GATEWAY_KEY }, fetch: expect.any(Function) },
    });
  });

  it('wraps fetch to add the header while preserving the caller headers', async () => {
    const base = vi.fn<typeof fetch>(async () => new Response('{}'));
    const wrapped = gatewayFetch({ SUPABASE_GATEWAY_KEY: GATEWAY_KEY }, base, 'https://project.supabase.example');

    await wrapped?.('https://project.supabase.example/auth/v1/.well-known/jwks.json', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    const [url, init] = base.mock.calls[0];
    expect(url).toBe('https://project.supabase.example/auth/v1/.well-known/jwks.json');
    expect(init?.cache).toBe('no-store');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-vfuture-gateway-key')).toBe(GATEWAY_KEY);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('strips a caller-supplied gateway key from an untrusted target', async () => {
    const base = vi.fn<typeof fetch>(async () => new Response('{}'));
    const wrapped = gatewayFetch({
      SUPABASE_GATEWAY_KEY: GATEWAY_KEY,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
    }, base);

    await wrapped?.('https://untrusted.example/auth/v1/user', {
      headers: { 'x-vfuture-gateway-key': GATEWAY_KEY, accept: 'application/json' },
    });

    const headers = new Headers(base.mock.calls[0][1]?.headers);
    expect(headers.has('x-vfuture-gateway-key')).toBe(false);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('blocks redirects instead of forwarding gateway credentials to their destination', async () => {
    const base = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.redirect === 'error') throw new TypeError('Redirect blocked');
      return new Response('followed redirect');
    });
    const wrapped = gatewayFetch({
      SUPABASE_GATEWAY_KEY: GATEWAY_KEY,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
    }, base);

    await expect(wrapped?.('https://project.supabase.example/auth/v1/user', { redirect: 'follow' }))
      .rejects.toThrow('Redirect blocked');
  });

  it('preserves auth and content headers supplied by a Request input', async () => {
    const base = vi.fn<typeof fetch>(async () => new Response('{}'));
    const wrapped = gatewayFetch({
      SUPABASE_GATEWAY_KEY: GATEWAY_KEY,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
    }, base);
    const request = new Request('https://project.supabase.example/rest/v1/profiles', {
      headers: { authorization: 'Bearer learner-token', 'content-type': 'application/json' },
    });

    await wrapped?.(request);

    const headers = new Headers(base.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer learner-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-vfuture-gateway-key')).toBe(GATEWAY_KEY);
  });
});

describe('service client', () => {
  it('keeps the exact hosted-Supabase options when the key is unset', () => {
    createServiceClient('https://project.supabase.example', 'service-role-key');

    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://project.supabase.example',
      'service-role-key',
      { auth: AUTH_OPTIONS },
    );
    expect(Object.keys(lastOptions(mocks.createClient))).toEqual(['auth']);
  });

  it('sends the gateway key as a global header when configured', () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);

    createServiceClient('https://project.supabase.example', 'service-role-key');

    expect(lastOptions(mocks.createClient)).toEqual({
      auth: AUTH_OPTIONS,
      global: { headers: { 'x-vfuture-gateway-key': GATEWAY_KEY }, fetch: expect.any(Function) },
    });
  });

  it('supabaseService() inherits the header', () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', HEX_KEY);

    supabaseService();

    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://project.supabase.example',
      'service-role-key',
      { auth: AUTH_OPTIONS, global: { headers: { 'x-vfuture-gateway-key': HEX_KEY }, fetch: expect.any(Function) } },
    );
  });

  it('fails before creating a client for a malformed key and never prints it', () => {
    const secret = 'MALFORMED SECRET VALUE';
    vi.stubEnv('SUPABASE_GATEWAY_KEY', secret);

    expect(() => createServiceClient('https://project.supabase.example', 'service-role-key'))
      .toThrow('Invalid SUPABASE_GATEWAY_KEY');
    try {
      createServiceClient('https://project.supabase.example', 'service-role-key');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('user-JWT server client', () => {
  it('keeps exactly the cookie options when the key is unset', async () => {
    await supabaseUser();

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const call = mocks.createServerClient.mock.calls[0];
    expect(call[0]).toBe('https://project.supabase.example');
    expect(call[1]).toBe('anon-key');
    expect(Object.keys(call[2] as object)).toEqual(['cookies']);
  });

  it('adds the gateway header without disturbing the cookie adapter', async () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);

    await supabaseUser();

    const options = lastOptions(mocks.createServerClient) as {
      cookies: { getAll: () => unknown[]; setAll: unknown };
      global: { headers: Record<string, string> };
    };
    expect(options.global).toEqual({ headers: { 'x-vfuture-gateway-key': GATEWAY_KEY }, fetch: expect.any(Function) });
    expect(typeof options.cookies.getAll).toBe('function');
    expect(typeof options.cookies.setAll).toBe('function');
  });

  it('rejects a malformed key without a value in the error', async () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', 'short secret');

    const failure = await supabaseUser().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Invalid SUPABASE_GATEWAY_KEY');
  });
});

describe('browser client', () => {
  it('never receives the gateway key, even when the server environment has one', () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);

    supabaseBrowser();

    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(1);
    const args = mocks.createBrowserClient.mock.calls[0];
    expect(args).toEqual(['https://project.supabase.example', 'anon-key']);
    expect(JSON.stringify(args)).not.toContain(GATEWAY_KEY);
  });

  it('keeps the helper out of the browser modules', () => {
    for (const file of ['client.ts', 'env-client.ts']) {
      const directory = file === 'client.ts' ? join('src', 'lib', 'supabase') : join('src', 'lib');
      const source = readFileSync(join(process.cwd(), directory, file), 'utf8');
      expect(source).not.toMatch(/gateway/i);
    }
  });

  it('does not import server-only so scripts can use the shared helper outside Next', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'backend-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/import\s+(?:[^;]*\sfrom\s+)?['"]server-only['"]/);
  });
});
