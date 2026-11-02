import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), read: vi.fn(), remove: vi.fn(), refresh: vi.fn(), claim: vi.fn(), release: vi.fn(), revoke: vi.fn(), metadata: vi.fn(), exchange: vi.fn(), keys: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/identity/store', () => ({ readStoredSession: mocks.read, deleteStoredSession: mocks.remove, rotateStoredSession: mocks.refresh, claimSessionRefresh: mocks.claim, releaseSessionRefresh: mocks.release, revokeSessionRefresh: mocks.revoke }));
vi.mock('@/lib/identity/oidc', async (original) => ({ ...await original<typeof import('@/lib/identity/oidc')>(), getOidcMetadata: mocks.metadata, exchangeTokens: mocks.exchange, getSigningKeys: mocks.keys }));
import { IdentityGrantRejected, encryptRefreshToken, readIdentityConfiguration } from '@/lib/identity/oidc';
import { refreshAzureSession } from '@/lib/identity/refresh';
import { getAzureSession } from '@/lib/identity/server';
afterEach(() => vi.useRealTimers());

describe('Azure server session boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.cookies.mockResolvedValue({ get: () => undefined }); });
  it('does not access identity storage for absent or malformed session cookies', async () => {
    expect(await getAzureSession()).toBeNull();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'forged' }) });
    expect(await getAzureSession()).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns only a database validated UUID and refuses an expired session', async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'a'.repeat(43) }) });
    const user = { id: '33333333-3333-4333-8333-333333333333', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' };
    mocks.read.mockResolvedValue({ provider: 'external-id', user, expiresAt: Date.now() / 1000 + 1000, tokenExpiresAt: Date.now() / 1000 + 900 });
    expect((await getAzureSession())?.user.id).toBe(user.id);
    mocks.read.mockResolvedValue({ provider: 'external-id', user, expiresAt: Date.now() / 1000 - 1, tokenExpiresAt: Date.now() / 1000 + 900 });
    expect(await getAzureSession()).toBeNull();
  });
  it('does not mistake a database outage for an authenticated or signed-out session', async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'a'.repeat(43) }) });
    mocks.read.mockRejectedValue(new Error('database unavailable'));
    await expect(getAzureSession()).rejects.toThrow('database unavailable');
  });
});

const vars = { ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111', ENTRA_CLIENT_ID: '22222222-2222-4222-8222-222222222222', ENTRA_CLIENT_SECRET: 'secret', ENTRA_ISSUER: 'https://test.ciamlogin.com/tenant/v2.0', ENTRA_AUTHORITY: 'https://test.ciamlogin.com/tenant/v2.0', NEXT_PUBLIC_APP_URL: 'https://academy.example', ENTRA_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') };
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength:2048});
function renewedToken(oid = '33333333-3333-4333-8333-333333333333') {
 const body = [ {alg:'RS256',kid:'key'}, {iss:vars.ENTRA_ISSUER, aud:vars.ENTRA_CLIENT_ID, tid:vars.ENTRA_TENANT_ID, sub:'pairwise-sub', oid, iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+3600} ].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
describe('Azure refresh continuity', ()=>{
 beforeEach(async()=>{
   vi.clearAllMocks(); for(const [key,value] of Object.entries(vars)) vi.stubEnv(key,value);
   mocks.cookies.mockResolvedValue({get:()=>({value:'a'.repeat(43)})});
   const {hashToken} = await import('@/lib/identity/oidc');
   mocks.read.mockResolvedValue({provider:'external-id' as const,user:{id:'44444444-4444-4444-8444-444444444444'}, issuer:vars.ENTRA_ISSUER, subject:'33333333-3333-4333-8333-333333333333', oidcSubject:'pairwise-sub', expiresAt:Date.now()/1000+36000, tokenExpiresAt:Date.now()/1000-5, version:1, refreshCiphertext:encryptRefreshToken('refresh',hashToken('a'.repeat(43)),readIdentityConfiguration())});
   mocks.refresh.mockResolvedValue(true); mocks.claim.mockResolvedValue(true); mocks.release.mockResolvedValue(true); mocks.revoke.mockResolvedValue(true);
   mocks.metadata.mockResolvedValue({}); mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'key'}]);
 });
 it('refreshes an expired token without changing the internal actor',async()=>{
   mocks.exchange.mockResolvedValue({idToken:renewedToken(),refreshToken:'rotated'});
   const old = await mocks.read();
   mocks.read.mockResolvedValueOnce(old).mockResolvedValue({...old,tokenExpiresAt:Date.now()/1000+3600,version:2});
   expect((await getAzureSession())?.user.id).toBe('44444444-4444-4444-8444-444444444444');
   expect(mocks.refresh).toHaveBeenCalledOnce();
   expect(mocks.refresh.mock.calls[0][3]).not.toContain('rotated');
 });
 it('revokes a session if refreshed tokens change the external identity',async()=>{
   mocks.exchange.mockResolvedValue({idToken:renewedToken('55555555-5555-4555-8555-555555555555')});
   await expect(getAzureSession()).rejects.toThrow('Session identity changed');
   expect(mocks.revoke).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it('revokes a rejected refresh grant so the next visit can reauthenticate',async()=>{
   mocks.exchange.mockRejectedValue(new IdentityGrantRejected());
   expect(await getAzureSession()).toBeNull();
   expect(mocks.revoke).toHaveBeenCalledOnce();
 });

});

// Calls the production refresh worker directly, bypassing server.ts's process-local
// coalescing Map. Each invocation represents an independent Vercel worker.
describe('independent Azure refresh workers',()=>{
 it('a losing worker never redeems the same grant while the successful owner is waiting to commit',async()=>{
   for(const [key,value] of Object.entries(vars)) vi.stubEnv(key,value);
   const {hashToken} = await import('@/lib/identity/oidc');
   const hash=hashToken('a'.repeat(43));
   let row={provider:'external-id' as const,user:{id:'44444444-4444-4444-8444-444444444444',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:''},issuer:vars.ENTRA_ISSUER,subject:'33333333-3333-4333-8333-333333333333',oidcSubject:'pairwise-sub',expiresAt:Date.now()/1000+36000,tokenExpiresAt:Date.now()/1000-5,version:1,refreshCiphertext:encryptRefreshToken('refresh',hash,readIdentityConfiguration())};
   let owner:string|null=null;
   let commit!:()=>void;
   let reachedCommit!:()=>void;
   const commitBlocked=new Promise<void>(resolve=>{commit=resolve;});
   const committing=new Promise<void>(resolve=>{reachedCommit=resolve;});
   vi.clearAllMocks();
   mocks.claim.mockImplementation(async(_hash:string,version:number,lease:string)=>{if(owner||version!==row.version)return false;owner=lease;return true;});
   mocks.read.mockImplementation(async()=>({...row}));
   mocks.metadata.mockResolvedValue({});mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'key'}]);
   mocks.exchange.mockResolvedValueOnce({idToken:renewedToken(),refreshToken:'rotated'}).mockRejectedValue(new IdentityGrantRejected());
   mocks.refresh.mockImplementation(async(_hash:string,version:number,expires:number,ciphertext:string,lease:string)=>{reachedCommit();await commitBlocked;if(owner!==lease||version!==row.version)return false;row={...row,version:version+1,tokenExpiresAt:expires,refreshCiphertext:ciphertext};owner=null;return true;});
   mocks.release.mockImplementation(async(_hash:string,_version:number,lease:string)=>{if(owner===lease)owner=null;});
   const workerA=refreshAzureSession(hash,{...row});
   await committing;
   const workerB=refreshAzureSession(hash,{...row});
   // Flush the second worker's claim/read; the owner is still blocked before CAS.
   await new Promise(resolve=>setTimeout(resolve,20));
   expect(mocks.exchange).toHaveBeenCalledTimes(1);
   expect(mocks.revoke).not.toHaveBeenCalled();
   commit();
   const [a,b]=await Promise.all([workerA,workerB]);
   expect(a?.version).toBe(2);expect(b?.version).toBe(2);
   expect(a?.user.id).toBe(row.user.id);expect(b?.user.id).toBe(row.user.id);
   expect(mocks.exchange).toHaveBeenCalledTimes(1);
 });
 it('releases a transiently failed refresh without revoking the session',async()=>{
   vi.clearAllMocks();for(const [key,value] of Object.entries(vars))vi.stubEnv(key,value);
   const {hashToken}=await import('@/lib/identity/oidc');const hash=hashToken('a'.repeat(43));
   const row={provider:'external-id' as const,user:{id:'44444444-4444-4444-8444-444444444444',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:''},issuer:vars.ENTRA_ISSUER,subject:'33333333-3333-4333-8333-333333333333',oidcSubject:'pairwise-sub',expiresAt:Date.now()/1000+36000,tokenExpiresAt:Date.now()/1000-5,version:1,refreshCiphertext:encryptRefreshToken('refresh',hash,readIdentityConfiguration())};
   mocks.claim.mockResolvedValue(true);mocks.metadata.mockResolvedValue({});mocks.exchange.mockRejectedValue(new Error('network unavailable'));mocks.release.mockResolvedValue(true);
   await expect(refreshAzureSession(hash,row)).rejects.toThrow('network unavailable');
   expect(mocks.revoke).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();
 });
 it('bounds a losing worker wait and leaves a slow owner session untouched',async()=>{
   vi.clearAllMocks();vi.useFakeTimers();
   const row={provider:'external-id' as const,user:{id:'44444444-4444-4444-8444-444444444444',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:''},issuer:vars.ENTRA_ISSUER,subject:'33333333-3333-4333-8333-333333333333',oidcSubject:'pairwise-sub',expiresAt:Date.now()/1000+36000,tokenExpiresAt:Date.now()/1000-5,version:1,refreshCiphertext:'opaque'};
   mocks.claim.mockResolvedValue(false);mocks.read.mockResolvedValue(row);
   const pending=expect(refreshAzureSession('session-hash',row)).rejects.toThrow('temporarily unavailable');
   await vi.advanceTimersByTimeAsync(10000);await pending;
   expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.revoke).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.release).not.toHaveBeenCalled();
 });

 it('an expired owner receiving invalid_grant cannot delete a successor waiting before commit',async()=>{
   vi.clearAllMocks();for(const [key,value] of Object.entries(vars))vi.stubEnv(key,value);
   const {hashToken}=await import('@/lib/identity/oidc');const hash=hashToken('a'.repeat(43));
   let row={provider:'external-id' as const,user:{id:'44444444-4444-4444-8444-444444444444',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:''},issuer:vars.ENTRA_ISSUER,subject:'33333333-3333-4333-8333-333333333333',oidcSubject:'pairwise-sub',expiresAt:Date.now()/1000+36000,tokenExpiresAt:Date.now()/1000-5,version:1,refreshCiphertext:encryptRefreshToken('refresh',hash,readIdentityConfiguration())};
   let owner:string|null=null;
   let firstReached!:()=>void, rejectFirst!:(error:Error)=>void, reachedCommit!:()=>void, commit!:()=>void;
   const firstExchange=new Promise<void>(resolve=>{firstReached=resolve;});
   const firstTokens=new Promise<never>((_resolve,reject)=>{rejectFirst=reject;});
   const committing=new Promise<void>(resolve=>{reachedCommit=resolve;});
   const commitBlocked=new Promise<void>(resolve=>{commit=resolve;});
   mocks.claim.mockImplementation(async(_hash:string,version:number,lease:string)=>{if(owner||version!==row.version)return false;owner=lease;return true;});
   mocks.read.mockImplementation(async()=>({...row}));mocks.metadata.mockResolvedValue({});mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'key'}]);
   mocks.exchange.mockImplementationOnce(async()=>{firstReached();return firstTokens;}).mockResolvedValue({idToken:renewedToken(),refreshToken:'new-grant'});
   mocks.refresh.mockImplementation(async(_hash:string,version:number,expires:number,ciphertext:string,lease:string)=>{reachedCommit();await commitBlocked;if(owner!==lease||version!==row.version)return false;row={...row,version:2,tokenExpiresAt:expires,refreshCiphertext:ciphertext};owner=null;return true;});
   mocks.revoke.mockImplementation(async(_hash:string,version:number,lease:string)=>owner===lease&&version===row.version);
   mocks.release.mockImplementation(async(_hash:string,_version:number,lease:string)=>{if(owner===lease)owner=null;});
   const oldWorker=refreshAzureSession(hash,{...row});await firstExchange;
   // Model database lease expiry while the old worker's network request is suspended.
   owner=null;
   const newWorker=refreshAzureSession(hash,{...row});await committing;
   rejectFirst(new IdentityGrantRejected());await new Promise(resolve=>setTimeout(resolve,20));
   expect(mocks.revoke).toHaveBeenCalledOnce();
   expect(await mocks.revoke.mock.results[0].value).toBe(false);
   expect(row.version).toBe(1);expect(owner).not.toBeNull();
   commit();const [oldResult,newResult]=await Promise.all([oldWorker,newWorker]);
   expect(oldResult?.version).toBe(2);expect(newResult?.version).toBe(2);
   expect(mocks.remove).not.toHaveBeenCalled();
 });

});

describe('Microsoft session refresh provider binding',()=>{
 it('refreshes with the separate workforce app and preserves the original provider and actor',async()=>{
  vi.clearAllMocks();for(const [key,value] of Object.entries(vars))vi.stubEnv(key,value);
  vi.stubEnv('MICROSOFT_ENTRA_TENANT_ID','157419c9-2de9-45e7-a6f9-91546dbef629');vi.stubEnv('MICROSOFT_ENTRA_CLIENT_ID','66666666-6666-4666-8666-666666666666');vi.stubEnv('MICROSOFT_ENTRA_CLIENT_SECRET','internal-secret');
  const config=readIdentityConfiguration(process.env,'microsoft');const {hashToken}=await import('@/lib/identity/oidc');const hash=hashToken('a'.repeat(43));
  const row={provider:'microsoft' as const,user:{id:'44444444-4444-4444-8444-444444444444',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:''},issuer:config.issuer,subject:'33333333-3333-4333-8333-333333333333',oidcSubject:'internal-pairwise',expiresAt:Date.now()/1000+36000,tokenExpiresAt:Date.now()/1000-5,version:1,refreshCiphertext:encryptRefreshToken('internal-refresh',hash,config)};
  const body=[{alg:'RS256',kid:'key'},{iss:config.issuer,tid:config.tenantId,aud:config.clientId,ver:'2.0',sub:row.oidcSubject,oid:row.subject,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  mocks.claim.mockResolvedValue(true);mocks.metadata.mockResolvedValue({});mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'key'}]);mocks.refresh.mockResolvedValue(true);mocks.release.mockResolvedValue(true);
  mocks.exchange.mockImplementation(async(conf:{clientId:string;clientSecret:string;provider:string},_metadata:unknown,grant:{refreshToken:string})=>{
   if(conf.clientId!==config.clientId||conf.clientSecret!=='internal-secret'||conf.provider!=='microsoft'||grant.refreshToken!=='internal-refresh')throw new Error('Wrong provider credentials');
   return {idToken:body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url'),refreshToken:'rotated-internal'};
  });
  mocks.read.mockResolvedValue({...row,version:2,tokenExpiresAt:Date.now()/1000+3600});
  const result=await refreshAzureSession(hash,row);
  expect(result).toMatchObject({provider:'microsoft',version:2,user:{id:row.user.id}});
  // Relabeling an encrypted Microsoft grant as External ID fails before sending credentials.
  mocks.exchange.mockClear();
  await expect(refreshAzureSession(hash,{...row,provider:'external-id'})).rejects.toThrow();
  expect(mocks.exchange).not.toHaveBeenCalled();
 });
});
