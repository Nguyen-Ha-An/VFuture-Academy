import {generateKeyPairSync,sign} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),claim:vi.fn(),release:vi.fn(),revoke:vi.fn(),rotate:vi.fn(),remove:vi.fn(),exchange:vi.fn(),metadata:vi.fn(),keys:vi.fn(),directory:vi.fn(),cookies:vi.fn(),entraExchange:vi.fn(),mappedUser:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:mocks.cookies}));
vi.mock('@/lib/identity/store',()=>({readStoredSession:mocks.read,claimSessionRefresh:mocks.claim,releaseSessionRefresh:mocks.release,revokeSessionRefresh:mocks.revoke,rotateStoredSession:mocks.rotate,deleteStoredSession:mocks.remove,findIdentityUser:mocks.mappedUser}));
vi.mock('@/lib/identity/google',async original=>({...await original<typeof import('@/lib/identity/google')>(),exchangeGoogleTokens:mocks.exchange,getGoogleMetadata:mocks.metadata}));
vi.mock('@/lib/identity/google-directory',()=>({createGoogleDirectory:()=>({resolve:mocks.directory})}));
vi.mock('@/lib/identity/oidc',async original=>({...await original<typeof import('@/lib/identity/oidc')>(),getSigningKeys:mocks.keys,exchangeTokens:mocks.entraExchange}));
import {refreshAzureSession} from '@/lib/identity/refresh';
import {getAzureSession,revokeAzureSession} from '@/lib/identity/server';
import {encodeGoogleRefresh,decodeGoogleRefresh} from '@/lib/identity/google';
import {encryptRefreshToken,decryptRefreshToken,hashToken,readIdentitySessionConfiguration,IdentityGrantRejected} from '@/lib/identity/oidc';
import type {StoredSession} from '@/lib/identity/store';
const tenant='f3152aa5-61de-40fd-bb76-780b9fbe5428';const issuer=`https://${tenant}.ciamlogin.com/${tenant}/v2.0`;
const env={NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),GOOGLE_CLIENT_ID:'123-example.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'google-secret'};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const hash=hashToken('a'.repeat(43));const subject='107691503500061507151';const objectId='22222222-2222-4222-8222-222222222222';
const config=()=>({...readIdentitySessionConfiguration(),provider:'external-id' as const});
function row(refreshToken:string|undefined='google-refresh'):StoredSession {return {provider:'external-id',user:{id:'33333333-3333-4333-8333-333333333333',email:undefined,user_metadata:{},app_metadata:{},aud:'authenticated',created_at:''},issuer,subject:objectId,oidcSubject:subject,expiresAt:Date.now()/1000+86400,tokenExpiresAt:Date.now()/1000-1,version:1,refreshCiphertext:encryptRefreshToken(encodeGoogleRefresh({clientId:env.GOOGLE_CLIENT_ID,subject,email:'verified@example.com',displayName:'Verified Learner',...(refreshToken?{refreshToken}:{})}),hash,config())};}
function signed(change:Record<string,unknown>={}) {const now=Math.floor(Date.now()/1000);const body=[{alg:'RS256',kid:'google-key'},{iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:subject,email:'new@example.com',email_verified:true,iat:now,exp:now+3600,...change}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');}
describe('Google session continuity',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);mocks.cookies.mockResolvedValue({get:()=>({value:'a'.repeat(43)})});mocks.claim.mockResolvedValue(true);mocks.release.mockResolvedValue(true);mocks.revoke.mockResolvedValue(true);mocks.rotate.mockResolvedValue(true);mocks.metadata.mockResolvedValue({jwks_uri:'https://www.googleapis.com/oauth2/v3/certs'});mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'google-key'}]);mocks.directory.mockResolvedValue({issuer,objectId});mocks.mappedUser.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333'});});
 it('selects Google from authenticated session state, retains the Academy UUID and rotates verified email',async()=>{
  const old=row();let rotated:StoredSession|undefined;mocks.exchange.mockResolvedValue({idToken:signed(),refreshToken:'rotated-google'});
  mocks.rotate.mockImplementation(async(_hash,_version,expiresAt,ciphertext)=>{rotated={...old,tokenExpiresAt:expiresAt,refreshCiphertext:ciphertext,version:2};return true;});mocks.read.mockImplementation(async()=>rotated??old);
  const result=await refreshAzureSession(hash,old);expect(result?.user.id).toBe(old.user.id);expect(result?.issuer).toBe(issuer);
  const credential=decodeGoogleRefresh(decryptRefreshToken(result!.refreshCiphertext!,hash,config()));expect(credential.email).toBe('new@example.com');expect(credential.refreshToken).toBe('rotated-google');expect(mocks.entraExchange).not.toHaveBeenCalled();expect(mocks.directory).toHaveBeenCalledWith(expect.objectContaining({subject}),false);
 });
 it.each([{sub:'107691503500061507152'},{binding:{issuer,objectId:'44444444-4444-4444-8444-444444444444'}}])('revokes rather than switching the Google subject or mapped Entra object',async change=>{
  mocks.exchange.mockResolvedValue({idToken:signed('sub' in change?{sub:change.sub}:{})});if('binding' in change)mocks.directory.mockResolvedValue(change.binding);
  await expect(refreshAzureSession(hash,row())).rejects.toThrow('Session identity changed');expect(mocks.revoke).toHaveBeenCalledOnce();expect(mocks.rotate).not.toHaveBeenCalled();
 });
 it('revokes a disabled directory binding and a rejected Google refresh grant',async()=>{
  mocks.exchange.mockResolvedValue({idToken:signed()});mocks.directory.mockRejectedValue(new IdentityGrantRejected());expect(await refreshAzureSession(hash,row())).toBeNull();expect(mocks.revoke).toHaveBeenCalledOnce();
  mocks.revoke.mockClear();mocks.exchange.mockRejectedValue(new IdentityGrantRejected());expect(await refreshAzureSession(hash,row())).toBeNull();expect(mocks.revoke).toHaveBeenCalledOnce();
 });
 it('rejects a removed or reassigned Academy mapping after the Google directory binding is verified',async()=>{
  mocks.exchange.mockResolvedValue({idToken:signed()});mocks.mappedUser.mockResolvedValue({id:'44444444-4444-4444-8444-444444444444'});
  await expect(refreshAzureSession(hash,row())).rejects.toThrow('Session identity changed');expect(mocks.revoke).toHaveBeenCalledOnce();expect(mocks.rotate).not.toHaveBeenCalled();
 });
 it('returns verified Google email for a legacy actor whose database email is null',async()=>{
  const stored={...row(),tokenExpiresAt:Date.now()/1000+3600};mocks.read.mockResolvedValue(stored);
  expect((await getAzureSession())?.user).toMatchObject({id:stored.user.id,email:'verified@example.com',user_metadata:{full_name:'Verified Learner'}});
 });
 it('attempts local session deletion even when reading its protocol fails',async()=>{
  mocks.read.mockRejectedValue(new Error('Protocol read failed'));mocks.remove.mockResolvedValue('external-id');expect(await revokeAzureSession()).toBe('google');expect(mocks.remove).toHaveBeenCalledWith(hash);
 });
 it('keeps Google logout local and expires a Google session with no refresh grant',async()=>{
  const stored=row('');mocks.read.mockResolvedValue(stored);mocks.remove.mockResolvedValue('external-id');
  expect(await revokeAzureSession()).toBe('google');expect(await refreshAzureSession(hash,stored)).toBeNull();expect(mocks.exchange).not.toHaveBeenCalled();
 });
});
