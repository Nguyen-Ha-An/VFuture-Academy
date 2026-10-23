import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudioFixtureClient } from '../../scripts/lib/studio-postgres-fixture.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('native Studio fixture PostgreSQL client isolation', () => {
  it('ignores parent PG connection fallbacks without changing the parent environment', async () => {
    vi.stubEnv('PGSSLMODE', 'require');
    vi.stubEnv('PGOPTIONS', '-c search_path=foreign_schema');
    vi.stubEnv('PGPASSWORD', 'synthetic-parent-only-password');
    vi.stubEnv('PGAPPNAME', 'synthetic-parent-only-app');
    const client = createStudioFixtureClient({
      host: '/tmp/studio-postgres.synthetic/socket', user: 'studio_test', database: 'studio_concurrency', port: 55439,
    });
    // pg resolves these at construction time. Inspect the installed driver's
    // captured config only; this test never connects to a socket or database.
    const parameters = (client as unknown as { connectionParameters: { ssl: unknown; options?: string; password: string | null; application_name?: string; host: string } }).connectionParameters;
    expect(parameters.ssl).toBe(false);
    expect(parameters.options).toBeUndefined();
    expect(parameters.password).toBeNull();
    expect(parameters.application_name).not.toBe('synthetic-parent-only-app');
    expect(parameters.host).toBe('/tmp/studio-postgres.synthetic/socket');
    expect(process.env.PGSSLMODE).toBe('require');
    expect(process.env.PGOPTIONS).toBe('-c search_path=foreign_schema');
    expect(process.env.PGPASSWORD).toBe('synthetic-parent-only-password');
    expect(process.env.PGAPPNAME).toBe('synthetic-parent-only-app');
    await client.end();
  });
});
