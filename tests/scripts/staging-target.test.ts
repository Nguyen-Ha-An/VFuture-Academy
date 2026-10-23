import { describe, expect, it } from 'vitest';
import { parse } from 'pg-connection-string';
import { assertStagingMigrationTarget } from '../../scripts/check-staging-target';

const environment = {
  SEED_DEV_PROJECT_REF: 'unit-stage',
  NEXT_PUBLIC_SUPABASE_URL: 'https://unit-stage.supabase.co',
  SUPABASE_DB_URL: 'postgresql://postgres:test-only@db.unit-stage.supabase.co:5432/postgres',
};

describe('pre-migration staging target identity', () => {
  it('rejects query overrides that the real Postgres driver would use instead of the checked URL identity', () => {
    const hostOverride = `${environment.SUPABASE_DB_URL}?host=db.other-project.supabase.co`;
    expect(parse(hostOverride).host).toBe('db.other-project.supabase.co');
    expect(() => assertStagingMigrationTarget({ ...environment, SUPABASE_DB_URL: hostOverride })).toThrow('override');
    const userOverride = 'postgresql://postgres.unit-stage:test-only@aws-0-region.pooler.supabase.com:5432/postgres?user=postgres.other-project';
    expect(parse(userOverride).user).toBe('postgres.other-project');
    expect(() => assertStagingMigrationTarget({ ...environment, SUPABASE_DB_URL: userOverride })).toThrow('override');
    expect(assertStagingMigrationTarget({ ...environment, SUPABASE_DB_URL: `${environment.SUPABASE_DB_URL}?sslmode=require` })).toBe('unit-stage');
  });

  it.each(['hostaddr', 'port', 'password'])('rejects the connection identity override %s', (key) => {
    expect(() => assertStagingMigrationTarget({ ...environment, SUPABASE_DB_URL: `${environment.SUPABASE_DB_URL}?${key}=override` })).toThrow('override');
  });

  it('accepts the matching direct and pooler identities', () => {
    expect(assertStagingMigrationTarget(environment)).toBe('unit-stage');
    expect(assertStagingMigrationTarget({ ...environment,
      SUPABASE_DB_URL: 'postgresql://postgres.unit-stage:test-only@aws-0-region.pooler.supabase.com:6543/postgres',
    })).toBe('unit-stage');
  });
  it.each([
    { SEED_DEV_PROJECT_REF: '' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://production.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://unit-stage.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://user:test-only@unit-stage.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://unit-stage.supabase.co/path' },
    { SUPABASE_DB_URL: 'postgresql://postgres:test-only@db.production.supabase.co/postgres' },
    { SUPABASE_DB_URL: 'postgresql://postgres.production:test-only@aws-0-region.pooler.supabase.com/postgres' },
    { SUPABASE_DB_URL: 'postgresql://postgres.unit-stage:test-only@untrusted.example/postgres' },
    { SUPABASE_DB_URL: 'https://db.unit-stage.supabase.co/postgres' },
  ])('rejects mismatched or malformed targets without exposing configuration', (changed) => {
    expect(() => assertStagingMigrationTarget({ ...environment, ...changed })).toThrow();
  });
});
