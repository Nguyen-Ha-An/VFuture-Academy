import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
import { managementRead, managementWrite, managementDatabaseError } from '@/features/admin/management';
const context = { actor: { userId: 'operator' }, scope: { kind: 'branch', branchId: 'ans' } };
describe('management database boundary', () => {
  it('passes trusted actor and explicit scope without accepting a payload actor override', async () => {
    const rpc = vi.fn(async () => ({data:{items:[]}, error:null}));
    await managementRead(context as never, 'users', {query:'abc', actorId:'forged', branchId:'dewey'}, {rpc} as never);
    expect(rpc).toHaveBeenCalledWith('admin_management_read', {p_actor_id:'operator',p_scope_kind:'branch',p_branch_id:'ans',p_operation:'users',p_input:{query:'abc', actorId:'forged', branchId:'dewey'}});
  });
  it('fails closed on SQL denial, stale version and missing schema', () => {
    expect(() => managementDatabaseError({code:'42501',message:'internal email content'})).toThrow('Permission denied');
    expect(() => managementDatabaseError({code:'40001',message:'conflict'})).toThrow('changed');
    expect(() => managementDatabaseError({code:'42883',message:'secret details'})).toThrow('Unable to complete');
  });
  it('does not claim success when the mutation fails', async () => {
    const rpc = vi.fn(async () => ({data:null,error:{code:'23514',message:'LAST_ADMIN'}}));
    await expect(managementWrite(context as never,'user.account-status',{userId:'last'}, {rpc} as never)).rejects.toThrow('last active Central Admin');
  });
});
