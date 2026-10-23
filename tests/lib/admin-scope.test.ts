import { describe, expect, it } from 'vitest';
import { scopeKey, parseScopeKey, selectAdminScope } from '@/lib/admin-scope';

describe('administration scope selection', () => {
  it('requires explicit central or concrete school identifiers', () => {
    expect(parseScopeKey('central')).toEqual({ kind: 'central' });
    expect(parseScopeKey('branch:ans')).toEqual({ kind: 'branch', branchId: 'ans' });
    expect(parseScopeKey('')).toBeNull();
    expect(parseScopeKey('branch:')).toBeNull();
    expect(parseScopeKey('branch:../../ans')).toBeNull();
  });
  it('does not turn a forged or revoked school selection into central authority', () => {
    const scopes = [{ kind: 'branch' as const, branchId: 'ans' }];
    expect(selectAdminScope(scopes, 'branch:dewey')).toEqual(scopes[0]);
    expect(selectAdminScope(scopes, 'central')).toEqual(scopes[0]);
    expect(selectAdminScope([], 'central')).toBeNull();
  });
  it('preserves an allowed school selection for central operators', () => {
    const scopes = [{ kind: 'central' as const }, { kind: 'branch' as const, branchId: 'ans' }];
    expect(scopeKey(selectAdminScope(scopes, 'branch:ans')!)).toBe('branch:ans');
  });
});
