import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

const databaseUrl = 'postgresql://user:password@example.com:5432/postgres';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('environment validation', () => {
  it('constructs the browser environment from statically analyzable public member expressions only', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'env-client.ts'), 'utf8');

    expect(source).not.toContain('readPublicEnvironment(process.env)');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(source).not.toContain('NEXT_PUBLIC_APP_URL');
  });

  it('returns validated values when all required integration settings are present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', validEnvironment.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', validEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', validEnvironment.SUPABASE_SERVICE_ROLE_KEY);
    vi.stubEnv('SUPABASE_DB_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', validEnvironment.NEXT_PUBLIC_APP_URL);

    const { env } = await import('@/lib/env');

    expect(env).toEqual(validEnvironment);
  });

  it('fails on first environment access with missing setting names without echoing secrets', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'super-secret-value');
    vi.stubEnv('SUPABASE_DB_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    const { env } = await import('@/lib/env');

    expect(() => env.NEXT_PUBLIC_APP_URL).toThrow(
      'Missing or invalid environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL',
    );
  });

  it('accepts an optional public contact email for the schools CTA', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', validEnvironment.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', validEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', validEnvironment.SUPABASE_SERVICE_ROLE_KEY);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', validEnvironment.NEXT_PUBLIC_APP_URL);
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'schools@vfuturelabs.org');

    const { env } = await import('@/lib/env');

    expect(env.NEXT_PUBLIC_CONTACT_EMAIL).toBe('schools@vfuturelabs.org');
  });

  it('runs the production anonymous rate-limit identity check on first runtime access', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', validEnvironment.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', validEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', validEnvironment.SUPABASE_SERVICE_ROLE_KEY);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', validEnvironment.NEXT_PUBLIC_APP_URL);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUSTED_PROXY', '');
    vi.stubEnv('RATE_LIMIT_COOKIE_SECRET', '');
    vi.stubEnv('NEXT_PHASE', '');

    const environmentModule = await import('@/lib/env');

    expect(() => environmentModule.env.NEXT_PUBLIC_APP_URL).toThrow(
      'Production rate limiting requires TRUSTED_PROXY=1 or RATE_LIMIT_COOKIE_SECRET',
    );
  });

  it('allows a credential-free production build when no runtime marker is set', async () => {
    const { assertRuntimeEnvironment } = await import('@/lib/env');

    expect(() => assertRuntimeEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      NEXT_PHASE: 'phase-production-build',
    })).not.toThrow();
  });

  it.each(['nodejs', 'edge'])('enforces production secrets for the %s runtime even during the build phase', async (nextRuntime) => {
    const { assertRuntimeEnvironment } = await import('@/lib/env');

    expect(() => assertRuntimeEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      NEXT_PHASE: 'phase-production-build',
      NEXT_RUNTIME: nextRuntime,
    })).toThrow('Production rate limiting requires TRUSTED_PROXY=1 or RATE_LIMIT_COOKIE_SECRET');
  });

  it('memoizes a successful production runtime check', async () => {
    for (const [name, value] of Object.entries(validEnvironment)) vi.stubEnv(name, value);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_COOKIE_SECRET', 'production-specific-rate-limit-secret');
    const { assertRuntimeEnvironment } = await import('@/lib/env');

    expect(() => assertRuntimeEnvironment()).not.toThrow();
    vi.stubEnv('RATE_LIMIT_COOKIE_SECRET', '');

    expect(() => assertRuntimeEnvironment()).not.toThrow();
  });

  it('requires the direct database URL only from the script-only environment module', async () => {
    vi.stubEnv('SUPABASE_DB_URL', databaseUrl);
    const { readScriptEnvironment } = await import('../../scripts/env');

    expect(readScriptEnvironment()).toEqual({ SUPABASE_DB_URL: databaseUrl });

    vi.stubEnv('SUPABASE_DB_URL', '');
    expect(() => readScriptEnvironment()).toThrow('Missing or invalid script environment variables: SUPABASE_DB_URL');
  });
});
