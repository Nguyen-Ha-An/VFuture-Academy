import { describe, expect, it, vi } from 'vitest';
import { parse } from 'pg-connection-string';
import { checkEnvironment, type ReadinessProbes } from '../../scripts/lib/environment-readiness';

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://stage.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
  SUPABASE_DB_URL: 'postgresql://postgres:private-password@db.stage.supabase.co:5432/postgres',
  NEXT_PUBLIC_APP_URL: 'https://stage.example.test',
  CRON_SECRET: 'private-cron-secret',
  RATE_LIMIT_COOKIE_SECRET: 'private-cookie-secret',
};
function probes(): ReadinessProbes {
  return {
    database: vi.fn(async () => ({ missingTables: [], missingMigrations: [], unexpectedMigrations: [] })),
    storage: vi.fn(async () => [
      { id: 'media', public: false }, { id: 'submissions', public: false }, { id: 'certificates', public: false },
    ]),
    auth: vi.fn(async () => ({ external: { email: true, google: true } })),
  };
}
describe('environment readiness', () => {
  it('fails missing configuration without making network requests', async () => {
    const dependencies = probes();
    const report = await checkEnvironment({}, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks.some(c => c.id === 'NEXT_PUBLIC_SUPABASE_URL' && c.status === 'fail')).toBe(true);
    expect(dependencies.database).not.toHaveBeenCalled();
    expect(dependencies.storage).not.toHaveBeenCalled();
  });
  it('accepts a configured reachable environment with complete schema and storage', async () => {
    expect((await checkEnvironment(environment, probes())).ok).toBe(true);
  });
  it('can validate configuration before migrations without claiming runtime readiness', async () => {
    const dependencies = probes();
    const report = await checkEnvironment(environment, dependencies, { configurationOnly: true });
    expect(report.ok).toBe(true);
    expect(report.checks.some(c => c.id === 'database')).toBe(false);
    expect(dependencies.database).not.toHaveBeenCalled();
  });
  it.each([
    ['NEXT_PUBLIC_APP_URL', 'https://user:password@stage.example.test'],
    ['NEXT_PUBLIC_APP_URL', 'https://stage.example.test/path'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'http://stage.supabase.co'],
    ['SUPABASE_DB_URL', 'https://database.example.test'],
  ])('rejects unsafe or malformed %s', async (key, value) => {
    const report = await checkEnvironment({ ...environment, [key]: value }, probes());
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: key, status: 'fail' }));
  });
  it('rejects clearly mismatched hosted database and API projects before connecting', async () => {
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: 'postgres://postgres:secret@db.production.supabase.co/postgres' }, dependencies);
    expect(report.ok).toBe(false);
    expect(dependencies.database).not.toHaveBeenCalled();
  });
  it.each([
    ['direct host', `${environment.SUPABASE_DB_URL}?host=db.old-central.supabase.co`, 'host', 'db.old-central.supabase.co'],
    ['encoded host key', `${environment.SUPABASE_DB_URL}?%68ost=db.old-central.supabase.co`, 'host', 'db.old-central.supabase.co'],
    ['pooled user', 'postgresql://postgres.stage:private-password@aws-0-region.pooler.supabase.com:6543/postgres?user=postgres.old-central', 'user', 'postgres.old-central'],
  ])('rejects %s overrides used by the real PostgreSQL parser before any probe', async (_label, url, key, redirected) => {
    // This reproduces the mismatch: URL.hostname/username still look approved,
    // while pg-connection-string uses the query override for the connection.
    expect(parse(url)[key]).toBe(redirected);
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'SUPABASE_DB_URL', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain(redirected);
  });

  it.each(['hostaddr', 'port', 'password', 'connectionString', 'database', 'dbname', 'service', 'servicefile'])('rejects the PostgreSQL connection override %s before any probe', async (key) => {
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: `${environment.SUPABASE_DB_URL}?${key}=override` }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'SUPABASE_DB_URL', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    'postgres://postgres:placeholder@db.old-central%2esupabase.co/postgres',
    'postgres://postgres:placeholder@db.old-central.SUPABASE.CO/postgres',
  ])('compares the decoded case-insensitive database hostname used by PostgreSQL: %s', async (url) => {
    expect(parse(url).host?.toLowerCase()).toBe('db.old-central.supabase.co');
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'project-consistency', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
  });

  it('rejects malformed hostname encoding before any probe', async () => {
    const url = 'postgres://postgres:placeholder@db.stage%ZZ.supabase.co/postgres';
    expect(() => decodeURIComponent(new URL(url).hostname)).toThrow();
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'SUPABASE_DB_URL', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    'postgres://postgres:placeholder@unrecognized.example.test/postgres',
    'postgres://postgres:placeholder@aws-0-region.pooler.supabase.com/postgres',
  ])('does not claim a hosted API project matches an unidentified database target: %s', async (url) => {
    const dependencies = probes();
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'project-consistency', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    'postgres://postgres:placeholder@db.stage%2esupabase.co/postgres',
    'postgres://postgres:placeholder@db.stage.SUPABASE.CO/postgres',
  ])('accepts a matching normalized hosted project identity: %s', async (url) => {
    expect((await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, probes())).ok).toBe(true);
  });

  it('compares the decoded pooler username used by the real PostgreSQL parser', async () => {
    const dependencies = probes();
    const url = 'postgresql://postgres%2Eold-central:private-password@aws-0-region.pooler.supabase.com:6543/postgres';
    expect(parse(url).user).toBe('postgres.old-central');
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'project-consistency', status: 'fail' }));
    for (const probe of Object.values(dependencies)) expect(probe).not.toHaveBeenCalled();
  });

  it('allows transport and diagnostic query settings without changing project identity', async () => {
    const dependencies = probes();
    const url = `${environment.SUPABASE_DB_URL}?sslmode=require&application_name=academy-readiness`;
    const report = await checkEnvironment({ ...environment, SUPABASE_DB_URL: url }, dependencies);
    expect(report.ok).toBe(true);
    expect(dependencies.database).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('distinguishes unreachable database from incomplete schema', async () => {
    const down = probes();
    down.database = vi.fn(async () => { throw new Error(environment.SUPABASE_DB_URL); });
    const unreachable = await checkEnvironment(environment, down);
    expect(unreachable.checks).toContainEqual(expect.objectContaining({ id: 'database', status: 'fail' }));
    const missing = probes();
    missing.database = vi.fn(async () => ({ missingTables: ['profiles'], missingMigrations: ['0001_identity.sql'], unexpectedMigrations: [] }));
    const incomplete = await checkEnvironment(environment, missing);
    expect(incomplete.checks).toContainEqual(expect.objectContaining({ id: 'database', status: 'pass' }));
    expect(incomplete.checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'fail' }));
    expect(incomplete.checks).toContainEqual(expect.objectContaining({ id: 'migrations', status: 'fail' }));
  });
  it('rejects missing or wrongly public private buckets', async () => {
    const dependencies = probes();
    dependencies.storage = vi.fn(async () => [{ id: 'media', public: true }]);
    const report = await checkEnvironment(environment, dependencies);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'storage.media', status: 'fail' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'storage.submissions', status: 'fail' }));
  });
  it('rejects a public certificate bucket', async () => {
    const dependencies = probes();
    dependencies.storage = vi.fn(async () => [
      { id: 'media', public: false }, { id: 'submissions', public: false }, { id: 'certificates', public: true },
    ]);
    const report = await checkEnvironment(environment, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'storage.certificates', status: 'fail' }));
  });
  it('reports disabled auth providers', async () => {
    const dependencies = probes();
    dependencies.auth = vi.fn(async () => ({ external: { email: true, google: false } }));
    const report = await checkEnvironment(environment, dependencies);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'auth.google', status: 'fail' }));
  });
  it('never includes credential values or underlying errors in output', async () => {
    const dependencies = probes();
    for (const key of ['database', 'storage', 'auth'] as const) {
      dependencies[key] = vi.fn(async () => { throw new Error(JSON.stringify(environment)); });
    }
    const output = JSON.stringify(await checkEnvironment(environment, dependencies));
    for (const value of Object.values(environment)) expect(output).not.toContain(value);
  });
});
