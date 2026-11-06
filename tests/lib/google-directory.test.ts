import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createGoogleDirectory } from '@/lib/identity/google-directory';
import type { GoogleIdentity } from '@/lib/identity/google';
const tenant='f3152aa5-61de-40fd-bb76-780b9fbe5428';
const env={ENTRA_TENANT_ID:tenant,ENTRA_ISSUER:`https://${tenant}.ciamlogin.com/${tenant}/v2.0`,ENTRA_ADMIN_CLIENT_ID:'11111111-1111-4111-8111-111111111111',ENTRA_ADMIN_CLIENT_SECRET:'directory-secret'};
const identity:GoogleIdentity={issuer:'https://accounts.google.com',subject:'107691503500061507151',email:'learner@example.com',emailVerified:true,expiresAt:2000000000,name:'Learner Name'};
const oid='22222222-2222-4222-8222-222222222222';
function user(changes:Record<string,unknown>={}) {return {id:oid,accountEnabled:true,identities:[{signInType:'federated',issuer:'google.com',issuerAssignedId:identity.subject}],...changes};}
describe('Google immutable directory binding',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('preserves the directory object ID for a matching Google subject even after email changes',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json({value:[user({mail:'old@example.com'})]}));
  const binding=await createGoogleDirectory(env,fetcher).resolve(identity,true);
  expect(binding).toEqual({issuer:env.ENTRA_ISSUER,objectId:oid});expect(fetcher.mock.calls).toHaveLength(2);
  const query=new URL(String(fetcher.mock.calls[1][0]));expect(query.searchParams.get('$filter')).toContain("issuerAssignedId eq '107691503500061507151'");expect(query.searchParams.get('$filter')).not.toContain(identity.email);
 });
 it.each([user({accountEnabled:false}),user({identities:[{signInType:'federated',issuer:'google.com',issuerAssignedId:'other'}]}),user({id:'not-a-uuid'})])('fails closed on disabled, mismatched or malformed directory identities',async row=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json({value:[row]}));
  await expect(createGoogleDirectory(env,fetcher).resolve(identity,true)).rejects.toThrow();expect(fetcher.mock.calls).toHaveLength(2);
 });
 it('does not provision or fall back to email when an existing refresh binding disappeared',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json({value:[]}));
  await expect(createGoogleDirectory(env,fetcher).resolve(identity,false)).rejects.toThrow('Sign-in is required');expect(fetcher.mock.calls).toHaveLength(2);
 });
 it('blocks an unknown Google subject whose email already belongs to a different directory account',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json({value:[]})).mockResolvedValueOnce(Response.json({value:[{id:oid}]}));
  await expect(createGoogleDirectory(env,fetcher).resolve(identity,true)).rejects.toThrow('Identity mapping required');expect(fetcher.mock.calls.some(call=>call[1]?.method==='POST'&&String(call[0]).endsWith('/users'))).toBe(false);
 });
 it('provisions a federated identity keyed only by Google sub, then reads back its enabled immutable binding',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json({value:[]})).mockResolvedValueOnce(Response.json({value:[]})).mockResolvedValueOnce(Response.json({value:[]})).mockResolvedValueOnce(Response.json(user(),{status:201})).mockResolvedValueOnce(Response.json({value:[user()]}));
  expect(await createGoogleDirectory(env,fetcher).resolve(identity,true)).toEqual({issuer:env.ENTRA_ISSUER,objectId:oid});
  const created=JSON.parse(fetcher.mock.calls[4][1]!.body as string);expect(created.identities).toEqual([{signInType:'federated',issuer:'google.com',issuerAssignedId:identity.subject}]);expect(created.displayName).toBe('Learner Name');expect(created.accountEnabled).toBe(true);expect(created.passwordProfile).toBeUndefined();
 });
 it('rejects pagination or multiple objects instead of selecting an ambiguous identity',async()=>{
  for(const result of [{value:[user(),user()]},{value:[user()],'@odata.nextLink':'https://graph.microsoft.com/next'}]) {
   const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'directory-token'})).mockResolvedValueOnce(Response.json(result));
   await expect(createGoogleDirectory(env,fetcher).resolve(identity,true)).rejects.toThrow();
  }
 });
});
