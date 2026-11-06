import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { authorizationRequest, readIdentityConfiguration, verifyIdToken } from '@/lib/identity/oidc';
const env={ENTRA_TENANT_ID:'11111111-1111-4111-8111-111111111111',ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222',ENTRA_CLIENT_SECRET:'external-secret',ENTRA_ISSUER:'https://example.ciamlogin.com/tenant/v2.0',ENTRA_AUTHORITY:'https://example.ciamlogin.com/tenant/v2.0',MICROSOFT_ENTRA_TENANT_ID:'157419c9-2de9-45e7-a6f9-91546dbef629',MICROSOFT_ENTRA_CLIENT_ID:'33333333-3333-4333-8333-333333333333',MICROSOFT_ENTRA_CLIENT_SECRET:'microsoft-secret',NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
const issuer='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0';
const consumer='9188040d-6c67-4c5b-b112-36a304b66dad';
const organization=env.MICROSOFT_ENTRA_TENANT_ID;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'microsoft-key',issuer};
function token(tid:string,changes:Record<string,unknown>={}) {
 const body=[{alg:'RS256',kid:'microsoft-key'},{iss:`https://login.microsoftonline.com/${tid}/v2.0`,tid,ver:'2.0',acct:0,upn:'person@vfuturelabs.org',aud:env.MICROSOFT_ENTRA_CLIENT_ID,sub:'pairwise',oid:'55555555-5555-4555-8555-555555555555',nonce:'bound-nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...changes}].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
describe('direct Microsoft identity isolation',()=>{
 it('selects a separate confidential application and persists provider binding in login state',()=>{
  const config=readIdentityConfiguration(env,'microsoft');
  expect(config.clientId).toBe(env.MICROSOFT_ENTRA_CLIENT_ID);expect(config.clientSecret).toBe('microsoft-secret');
  expect(config.authority).toBe(issuer);
  const request=authorizationRequest(config,'https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/oauth2/v2.0/authorize',{provider:'microsoft'});
  expect(request.transaction.provider).toBe('microsoft');expect(new URL(request.url).searchParams.get('domain_hint')).toBeNull();
 });
 it('accepts only the verified internal workforce tenant',async()=>{
  const tid=organization;
  const claims=await verifyIdToken(token(tid),readIdentityConfiguration(env,'microsoft'),[key],'bound-nonce');
  expect(claims.iss).toBe(`https://login.microsoftonline.com/${tid}/v2.0`);expect(claims.tid).toBe(tid);
 });
 it('rejects common as issuer, tid substitutions, wrong audience/nonce and cross-provider tokens',async()=>{
  const config=readIdentityConfiguration(env,'microsoft');
  for(const change of [{iss:'https://login.microsoftonline.com/common/v2.0'},{tid:'common'},{tid:consumer},{aud:env.ENTRA_CLIENT_ID},{nonce:'wrong'},{ver:'1.0'},{acct:1},{acct:undefined},{upn:undefined},{upn:'person@example.com'},{upn:'person@sub.vfuturelabs.org'},{upn:'person_vfuturelabs.org#EXT#@tenant.onmicrosoft.com'},{iss:env.ENTRA_ISSUER}]) await expect(verifyIdToken(token(organization,change),config,[key],'bound-nonce')).rejects.toThrow();
  await expect(verifyIdToken(token(consumer),readIdentityConfiguration(env),[key],'bound-nonce')).rejects.toThrow();
 });
 it('denies personal accounts, other organizations and configuration that broadens the workforce tenant',async()=>{
  for(const tid of [consumer,'44444444-4444-4444-8444-444444444444']) await expect(verifyIdToken(token(tid),readIdentityConfiguration(env,'microsoft'),[key],'bound-nonce')).rejects.toThrow();
  for(const tenant of ['common',consumer,'44444444-4444-4444-8444-444444444444']) expect(()=>readIdentityConfiguration({...env,MICROSOFT_ENTRA_TENANT_ID:tenant},'microsoft')).toThrow();
 });
 it('rejects changed or missing workforce membership claims when verifying a refresh token without nonce',async()=>{
  const config=readIdentityConfiguration(env,'microsoft');
  for(const change of [{acct:1},{acct:undefined},{upn:'person@example.com'},{upn:undefined}])
    await expect(verifyIdToken(token(organization,change),config,[key])).rejects.toThrow('Invalid identity claims');
 });
});
