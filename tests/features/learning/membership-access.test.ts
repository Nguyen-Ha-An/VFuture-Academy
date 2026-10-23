import { describe,expect,it,vi } from 'vitest';

vi.mock('server-only',()=>({}));

import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import type { Actor } from '@/lib/permissions';

class Query {
  calls:unknown[][]=[];
  constructor(private result:{data:unknown;error:unknown}){}
  select(value:string){this.calls.push(['select',value]);return this;}
  eq(key:string,value:unknown){this.calls.push(['eq',key,value]);return this;}
  maybeSingle(){this.calls.push(['maybeSingle']);return Promise.resolve(this.result);}
}
const database=(result:{data:unknown;error:unknown})=>{const query=new Query(result);return {query,from:()=>query};};
const actor=(memberships?:Array<{branchId:string;status:'active'|'suspended'}>):Actor=>({
  userId:'learner-1',roles:[],...(memberships?{authorization:{source:'database' as const,accountStatus:'active' as const,memberships,assignments:[]}}:{}),
});

describe('trusted enrollment membership access',()=>{
  it('denies only the explicitly suspended trusted branch and leaves another school active',async()=>{
    const db=database({data:null,error:null});
    const current=actor([{branchId:'school-a',status:'suspended'},{branchId:'school-b',status:'active'}]);
    await expect(assertEnrollmentMembershipAccess(current,{branch_scope_known:true,branch_id:'school-a'},db)).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    await expect(assertEnrollmentMembershipAccess(current,{branch_scope_known:true,branch_id:'school-b'},db)).resolves.toBeUndefined();
    expect(db.query.calls).toEqual([]);
  });

  it('allows authoritative active or absent membership because neither is explicit suspension',async()=>{
    const db=database({data:null,error:new Error('must not query')});
    await expect(assertEnrollmentMembershipAccess(actor([{branchId:'school-a',status:'active'}]),{branch_scope_known:true,branch_id:'school-a'},db)).resolves.toBeUndefined();
    await expect(assertEnrollmentMembershipAccess(actor([]),{branch_scope_known:true,branch_id:'school-a'},db)).resolves.toBeUndefined();
    expect(db.query.calls).toEqual([]);
  });

  it('never guesses from unknown historical scope',async()=>{
    const db=database({data:null,error:new Error('must not query')});
    await expect(assertEnrollmentMembershipAccess(actor(),{branch_scope_known:false,branch_id:'school-a'},db)).resolves.toBeUndefined();
    await expect(assertEnrollmentMembershipAccess(actor(),{branch_scope_known:true,branch_id:null},db)).resolves.toBeUndefined();
    expect(db.query.calls).toEqual([]);
  });

  it('falls back to the verified actor and trusted branch, denying suspension and failing closed on lookup errors',async()=>{
    const suspended=database({data:{status:'suspended'},error:null});
    await expect(assertEnrollmentMembershipAccess(actor(),{branch_scope_known:true,branch_id:'school-a'},suspended)).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(suspended.query.calls).toEqual([
      ['select','status'],['eq','user_id','learner-1'],['eq','branch_id','school-a'],['maybeSingle'],
    ]);
    const active=database({data:{status:'active'},error:null});
    await expect(assertEnrollmentMembershipAccess(actor(),{branch_scope_known:true,branch_id:'school-b'},active)).resolves.toBeUndefined();
    const failed=database({data:null,error:new Error('offline')});
    await expect(assertEnrollmentMembershipAccess(actor(),{branch_scope_known:true,branch_id:'school-a'},failed)).rejects.toMatchObject({status:503,code:'MEMBERSHIP_ACCESS_UNAVAILABLE'});
  });
});
