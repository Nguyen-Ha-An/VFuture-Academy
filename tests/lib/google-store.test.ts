import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),profile:vi.fn(),repair:vi.fn(),from:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/database/azure-client',()=>({createAzureDataClient:()=>({rpc:mocks.rpc,from:mocks.from})}));
vi.mock('@/features/auth/placeholder-profile',()=>({repairPlaceholderProfile:mocks.repair}));
import {initializeMappedGoogleProfile,resolveMappedGoogleUser} from '@/lib/identity/store';
import type {GoogleIdentity} from '@/lib/identity/google';
const identity:GoogleIdentity={issuer:'https://accounts.google.com',subject:'107691503500061507151',email:'verified@example.com',emailVerified:true,expiresAt:2000000000,name:'Verified Learner'};
const binding={issuer:'https://tenant.ciamlogin.com/tenant/v2.0',objectId:'22222222-2222-4222-8222-222222222222'};
describe('Google mapped Academy identity storage',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue({abortSignal:vi.fn().mockResolvedValue({data:{id:'original-academy-id',created_at:'',email:null},error:null})});const query={select:()=>query,eq:()=>query,maybeSingle:mocks.profile};mocks.from.mockReturnValue(query);mocks.profile.mockResolvedValue({data:{handle:'STU-unknown',display_name:'unknown'},error:null});mocks.repair.mockResolvedValue(true);});
 it('resolves only the explicit mapped Entra issuer/object and exposes verified email on the original actor',async()=>{
  const user=await resolveMappedGoogleUser(binding,identity);expect(user).toMatchObject({id:'original-academy-id',email:'verified@example.com'});
  expect(mocks.rpc).toHaveBeenCalledWith('academy_identity_resolve_user',{p_issuer:'https://tenant.ciamlogin.com/tenant/v2.0',p_subject:binding.objectId,p_email:'verified@example.com',p_email_verified:true,p_display_name:'Verified Learner'});
 });
 it('repairs an untouched provider placeholder using verified Google name before initialization',async()=>{
  await initializeMappedGoogleProfile('original-academy-id',identity);expect(mocks.repair).toHaveBeenCalledWith('original-academy-id',{handle:'STU-unknown',display_name:'unknown'},'Verified Learner',expect.any(Object));
  expect(mocks.rpc).toHaveBeenCalledWith('profile_initialize',{p_user_id:'original-academy-id',p_display_name:'Verified Learner'});
 });
 it('rereads after a concurrent handle edit and makes one bounded name-only repair attempt',async()=>{
  mocks.repair.mockResolvedValueOnce(false).mockResolvedValueOnce(true);mocks.profile.mockResolvedValueOnce({data:{handle:'STU-unknown',display_name:'unknown'},error:null}).mockResolvedValueOnce({data:{handle:'STU-chosen-by-learner',display_name:'unknown'},error:null});
  await initializeMappedGoogleProfile('original-academy-id',identity);expect(mocks.profile).toHaveBeenCalledTimes(2);expect(mocks.repair.mock.calls[1][1]).toEqual({handle:'STU-chosen-by-learner',display_name:'unknown'});
 });
 it('preserves a real edited name after a CAS miss',async()=>{
  mocks.repair.mockResolvedValue(false);mocks.profile.mockResolvedValueOnce({data:{handle:'STU-unknown',display_name:'unknown'},error:null}).mockResolvedValueOnce({data:{handle:'STU-custom',display_name:'Edited Name'},error:null});
  await initializeMappedGoogleProfile('original-academy-id',identity);expect(mocks.repair).toHaveBeenCalledTimes(1);
 });
 it('does not invent a name from email when Google provides no profile name',async()=>{
  await initializeMappedGoogleProfile('original-academy-id',{...identity,name:undefined});expect(mocks.profile).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalledWith('profile_initialize',{p_user_id:'original-academy-id',p_display_name:''});
 });
});
