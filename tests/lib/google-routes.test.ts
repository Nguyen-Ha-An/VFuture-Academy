import {generateKeyPairSync,sign} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({cookies:vi.fn(),consume:vi.fn(),store:vi.fn(),resolve:vi.fn(),initialize:vi.fn(),create:vi.fn(),revoke:vi.fn(),directory:vi.fn(),exchange:vi.fn(),metadata:vi.fn(),keys:vi.fn(),entraExchange:vi.fn(),entraMetadata:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:mocks.cookies}));
vi.mock('@/lib/identity/store',()=>({consumeLoginTransaction:mocks.consume,storeLoginTransaction:mocks.store,resolveMappedGoogleUser:mocks.resolve,initializeMappedGoogleProfile:mocks.initialize,createStoredSession:mocks.create,resolveIdentityUser:vi.fn(),initializeIdentityProfile:vi.fn(),findMicrosoftStaffUser:vi.fn()}));
vi.mock('@/lib/identity/server',()=>({LOGIN_COOKIE:'academy_login',SESSION_COOKIE:'academy_session',sessionCookieOptions:{httpOnly:true,sameSite:'lax',path:'/'},revokeAzureSession:mocks.revoke}));
vi.mock('@/lib/database/azure-client',()=>({createAzureDataClient:()=>({})}));
vi.mock('@/lib/rate-limit',()=>({enforceRequestRateLimit:vi.fn()}));
vi.mock('@/lib/identity/google',async original=>({...await original<typeof import('@/lib/identity/google')>(),exchangeGoogleTokens:mocks.exchange,getGoogleMetadata:mocks.metadata}));
vi.mock('@/lib/identity/google-directory',()=>({createGoogleDirectory:()=>({resolve:mocks.directory})}));
vi.mock('@/lib/identity/oidc',async original=>({...await original<typeof import('@/lib/identity/oidc')>(),getSigningKeys:mocks.keys,exchangeTokens:mocks.entraExchange,getOidcMetadata:mocks.entraMetadata}));
import {azureCallback,azureLogin,azureLogout} from '@/lib/identity/routes';
import {decryptRefreshToken,readIdentitySessionConfiguration} from '@/lib/identity/oidc';
import {decodeGoogleRefresh} from '@/lib/identity/google';
const env={NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64'),GOOGLE_CLIENT_ID:'123-example.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'google-secret'};
const issuer='https://directory.example/v2.0';const objectId='22222222-2222-4222-8222-222222222222';const userId='33333333-3333-4333-8333-333333333333';const subject='107691503500061507151';const state='a'.repeat(43);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
function signed(change:Record<string,unknown>={}) {const now=Math.floor(Date.now()/1000);const body=[{alg:'RS256',kid:'google-key'},{iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:subject,email:'learner@example.com',email_verified:true,name:'Learner Name',nonce:'bound-nonce',iat:now,exp:now+3600,...change}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');}
describe('direct Google authentication routes',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);mocks.cookies.mockResolvedValue({get:()=>({value:'b'.repeat(43)})});mocks.consume.mockResolvedValue({provider:'external-id',kind:'google-v1',state,nonce:'bound-nonce',verifier:'c'.repeat(43),next:'/app/courses/test'});mocks.exchange.mockResolvedValue({idToken:signed(),refreshToken:'google-refresh'});mocks.metadata.mockResolvedValue({jwks_uri:'https://www.googleapis.com/oauth2/v3/certs'});mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'google-key'}]);mocks.directory.mockResolvedValue({issuer,objectId});mocks.resolve.mockResolvedValue({id:userId});});
 it('starts Google without any Entra client credential or hosted details form',async()=>{
  const response=await azureLogin(new Request('https://academy.example/auth/login?provider=google&popup=1&attempt='+ 'a'.repeat(48)));
  const url=new URL(response.headers.get('location')!);expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);expect(mocks.store.mock.calls[0][2]).toMatchObject({kind:'google-v1',popupAttempt:'a'.repeat(48)});
 });
 it('uses server-selected Google state despite query relabeling and preserves the mapped Academy UUID',async()=>{
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?state=${state}&code=google-code&provider=microsoft`));
  expect(response.headers.get('location')).toBe('https://academy.example/welcome?next=%2Fapp%2Fcourses%2Ftest');
  const [hash,session]=mocks.create.mock.calls[0];expect(session).toMatchObject({provider:'external-id',issuer,subject:objectId,oidcSubject:subject,user:{id:userId}});expect(mocks.resolve).toHaveBeenCalledWith({issuer,objectId},expect.objectContaining({issuer:'https://accounts.google.com',subject,email:'learner@example.com',name:'Learner Name'}));
  const credential=decodeGoogleRefresh(decryptRefreshToken(session.refreshCiphertext,hash,{...readIdentitySessionConfiguration(),provider:'external-id'}));expect(credential).toMatchObject({subject,email:'learner@example.com',displayName:'Learner Name'});expect(mocks.entraExchange).not.toHaveBeenCalled();expect(response.headers.get('set-cookie')).not.toContain('google-refresh');
 });
 it.each([{nonce:'unbound'},{email_verified:false},{aud:'other-client'}])('refuses invalid Google tokens before resolving any directory or Academy identity',async change=>{
  mocks.exchange.mockResolvedValue({idToken:signed(change)});const response=await azureCallback(new Request(`https://academy.example/auth/callback?state=${state}&code=google-code`));
  expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.directory).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
 });
 it('does not create an Academy session when immutable directory binding or profile repair fails',async()=>{
  mocks.directory.mockRejectedValue(new Error('Identity mapping required'));let response=await azureCallback(new Request(`https://academy.example/auth/callback?state=${state}&code=google-code`));expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.create).not.toHaveBeenCalled();
  mocks.directory.mockResolvedValue({issuer,objectId});mocks.initialize.mockRejectedValue(new Error('Profile repair failed'));response=await azureCallback(new Request(`https://academy.example/auth/callback?state=${state}&code=google-code`));expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.create).not.toHaveBeenCalled();
 });
 it('deletes the Google session and returns to Academy without the CIAM logout endpoint',async()=>{
  mocks.revoke.mockResolvedValue('google');const response=await azureLogout(new Request('https://academy.example/auth/signout',{method:'POST',headers:{origin:'https://academy.example'}}));expect(response.headers.get('location')).toBe('https://academy.example/login');expect(response.cookies.get('academy_session')?.value).toBe('');expect(mocks.entraMetadata).not.toHaveBeenCalled();
 });
});
