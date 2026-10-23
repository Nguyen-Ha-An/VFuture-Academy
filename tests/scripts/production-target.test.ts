import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productionProjectRef } from '../../scripts/check-production-target';

describe('independent Academy production target', () => {
  const ref = 'academy-production';
  it('requires the configured project and matching direct or pooler database identity', () => {
    for (const url of [`postgresql://postgres:test-only@db.${ref}.supabase.co/postgres`, `postgresql://postgres.${ref}:test-only@aws-0-region.pooler.supabase.com/postgres`]) {
      expect(productionProjectRef({ SUPABASE_PRODUCTION_PROJECT_REF: ref, SUPABASE_PRODUCTION_DB_URL: url })).toBe(ref);
    }
  });
  it('rejects absent, mismatched, or redirected target identities', () => {
    for (const url of ['', 'postgresql://postgres:test-only@db.other-project.supabase.co/postgres', `postgresql://postgres:test-only@db.${ref}.supabase.co/postgres?host=db.other.supabase.co`]) {
      expect(() => productionProjectRef({ SUPABASE_PRODUCTION_PROJECT_REF: ref, SUPABASE_PRODUCTION_DB_URL: url })).toThrow();
    }
    expect(() => productionProjectRef({ SUPABASE_PRODUCTION_DB_URL: `postgresql://postgres@db.${ref}.supabase.co/postgres` })).toThrow('SUPABASE_PRODUCTION_PROJECT_REF');
  });
  it('keeps GitHub Actions deployment-only, with no migrations or test jobs', () => {
    const workflow = readFileSync('.github/workflows/deploy.yaml', 'utf8');
    expect(workflow).toContain('vfuture-academy-deploy-production');
    expect(workflow).toContain('vercel deploy --yes --prod');
    expect(workflow).not.toMatch(/npm (?:run (?:migrate|build|typecheck|lint|verify)|test)|playwright|vitest|vercel build|vercel pull/);
    expect(workflow).not.toContain('SUPABASE_PRODUCTION_DB_URL');
  });
});
