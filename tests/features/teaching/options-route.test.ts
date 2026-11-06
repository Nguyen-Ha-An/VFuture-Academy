import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Permission } from '@/lib/authorization';
const state=vi.hoisted(()=>({actor:null as Actor | null, options:vi.fn()}));
vi.mock('@/lib/permissions', async () => ({hasPermission:(actor:Actor, permission:Permission, scope:{branchId:string}) => (actor.authorization?.assignments ?? []).some(a => a.scope.kind === 'branch' && a.scope.branchId === scope.branchId && a.permissions.includes(permission)),getActor:async()=>state.actor}));
vi.mock('@/features/teaching/service',()=>({teachingOptions:state.options}));
import { GET } from '@/app/api/v1/teaching/options/route';
function actor(permissions:Permission[], branchId='ans'):Actor {
  return {userId:'user',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId,status:'active'}],assignments:[{roleDefinitionId:'custom',scope:{kind:'branch',branchId},permissions}]}};
}
describe('teaching options authorization',()=>{
  beforeEach(()=>{state.options.mockReset().mockResolvedValue({courses:[],versions:[]});});
  it('allows assignment managers to list accessible and pinned courses',async()=>{
    state.actor=actor(['teaching.assignment.manage']);
    expect((await GET(new Request('https://example.test/api/v1/teaching/options?branchId=ans'))).status).toBe(200);
  });
  it('allows an announcement-only school role',async()=>{
    state.actor=actor(['teaching.announcement.manage']);
    expect((await GET(new Request('https://example.test/api/v1/teaching/options?branchId=ans'))).status).toBe(200);
  });
  it('passes the requested locale and rejects unsupported values',async()=>{
    state.actor=actor(['teaching.schedule.manage']);
    expect((await GET(new Request('https://example.test/api/v1/teaching/options?branchId=ans&locale=en'))).status).toBe(200);
    expect(state.options).toHaveBeenCalledWith(state.actor,'ans','en');
    state.options.mockClear();
    expect((await GET(new Request('https://example.test/api/v1/teaching/options?branchId=ans&locale=fr'))).status).toBe(400);
    expect(state.options).not.toHaveBeenCalled();
  });
  it('rejects permission held only in another school',async()=>{
    state.actor=actor(['teaching.schedule.manage'],'other');
    expect((await GET(new Request('https://example.test/api/v1/teaching/options?branchId=ans'))).status).toBe(403);
    expect(state.options).not.toHaveBeenCalled();
  });
});
