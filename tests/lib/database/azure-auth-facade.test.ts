import { expect,it,vi } from 'vitest';
import { azureAuthFacade } from '@/lib/database/auth-facade';
it('reads managed identities only through owned service RPC and fails closed for vendor auth', async()=>{
  const rpc=vi.fn(async()=>({data:{id:'existing'},error:null}));
  const facade=azureAuthFacade({rpc} as never,async()=>({id:'current'}) as never);
  expect((await facade.getUser()).data.user?.id).toBe('current');
  expect((await facade.getUser('unverified-token')).error?.status).toBe(401);
  expect((await facade.admin.getUserById('existing')).data.user?.id).toBe('existing');
  expect(rpc).toHaveBeenCalledWith('academy_identity_get_user',{p_id:'existing'});
  expect((await facade.admin.oauth.getClient('client')).error?.status).toBe(501);
  expect((await facade.signInWithPassword({email:'x@example.test',password:'x'})).error?.status).toBe(501);
});
