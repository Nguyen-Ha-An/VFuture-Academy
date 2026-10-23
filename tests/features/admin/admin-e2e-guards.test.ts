import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tests/e2e/recovery-administration.spec.ts', 'utf8');

describe('administration recovery journey guards', () => {
  it('requires role states and guarded credentials without runtime skips', () => {
    expect(source).toContain('requireRoleStates');
    expect(source).toContain('Administration acceptance requires guarded Supabase credentials.');
    expect(source).not.toMatch(/test\.skip/);
  });

  it('uses unpredictable identities and a server-owned Auth marker without invitations', () => {
    expect(source).toContain('randomUUID()');
    expect(source).not.toContain('Date.now()');
    expect(source).toMatch(/app_metadata:\s*\{\s*recovery_fixture:\s*marker\s*\}/);
    expect(source).not.toMatch(/inviteUserByEmail|generateLink/);
  });

  it('verifies created objects before conditional removal and proves cleanup', () => {
    expect(source).toContain('Disposable administration namespace is not empty.');
    expect(source).toContain('userCreated && userId');
    expect(source).toContain('branchCreated');
    expect(source).toContain('cleanup marker verification failed');
    expect(source).toContain('cascade cleanup verification failed');
    expect(source).toContain("from('audit_log').select('id')");
    expect(source).toContain('new AggregateError');
  });
});
