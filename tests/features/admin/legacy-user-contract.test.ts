import { describe, it, expect } from 'vitest';
import { legacyGrantDefinition, legacyUser } from '@/features/admin/legacy-users';
import type { MemberSummary } from '@/features/admin/management-contracts';
describe('legacy managed user compatibility',()=>{
  it('preserves the legacy role enum while retaining custom assignments separately',()=>{
    const member={id:'user',assignments:[{roleId:'teacher',scope:{kind:'branch',branchId:'ans'}},{roleId:'legacy_contributor_central',scope:{kind:'central'}},{roleId:'custom-safe',scope:{kind:'branch',branchId:'ans'}}]} as MemberSummary;
    expect(legacyUser(member).roles).toEqual([{role:'instructor',branchId:'ans'},{role:'contributor',branchId:null}]);
    expect(legacyUser(member).assignments).toHaveLength(3);
  });
  it('maps only safe scope-compatible built-ins',()=>{
    expect(legacyGrantDefinition('admin',null)).toBe('central_admin');
    expect(legacyGrantDefinition('admin','ans')).toBe('school_admin');
    expect(legacyGrantDefinition('instructor','ans')).toBe('teacher');
    expect(()=>legacyGrantDefinition('instructor',null)).toThrow('assign this role explicitly');
    expect(()=>legacyGrantDefinition('contributor',null)).toThrow('assign this role explicitly');
  });
});
