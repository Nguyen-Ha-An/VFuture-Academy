import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { googleAuthorizationRequest, readGoogleConfiguration, verifyGoogleIdToken, exchangeGoogleTokens, getGoogleMetadata, encodeGoogleRefresh, decodeGoogleRefresh } from '@/lib/identity/google';
import { decryptRefreshToken, encryptRefreshToken, readIdentitySessionConfiguration } from '@/lib/identity/oidc';
const env={NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_CLIENT_ID:'1234567890-example.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'google-secret'};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const keys=[{...publicKey.export({format:'jwk'}),kid:'google-key'}];
function token(change:Record<string,unknown>={}) {
 const now=Math.floor(Date.now()/1000);
 const body=[{alg:'RS256',kid:'google-key'},{iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'107691503500061507151',nonce:'bound-nonce',email:'learner@example.com',email_verified:true,name:'Learner Name',iat:now,exp:now+3600,...change}].map(p=>Buffer.from(JSON.stringify(p)).toString('base64url')).join('.');
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
describe('direct Google identity protocol',()=>{
 beforeEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
 it('opens Google directly with PKCE, bound nonce and a Google transaction kind',()=>{
  const result=googleAuthorizationRequest(readGoogleConfiguration(env),{next:'https://evil.example'});const url=new URL(result.url);
  expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('scope')).toBe('openid profile email');expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('nonce')).toBe(result.transaction.nonce);expect(url.searchParams.get('access_type')).toBe('offline');expect(url.searchParams.get('prompt')).toBe('select_account consent');
  expect(result.transaction).toMatchObject({provider:'external-id',kind:'google-v1',next:'/app'});expect(url.searchParams.has('domain_hint')).toBe(false);
 });
 it('validates signed Google claims without treating a Google token as an Entra token',async()=>{
  const config=readGoogleConfiguration(env);expect(await verifyGoogleIdToken(token(),config,keys,'bound-nonce')).toMatchObject({issuer:'https://accounts.google.com',subject:'107691503500061507151',email:'learner@example.com',name:'Learner Name'});
  for(const change of [{iss:'https://evil.example'},{aud:'other'},{azp:'other'},{nonce:'wrong'},{exp:0},{iat:Infinity},{email_verified:false},{email_verified:'true'},{email:''},{sub:''},{sub:"id' or true"},{aud:[env.GOOGLE_CLIENT_ID,'other']}]) await expect(verifyGoogleIdToken(token(change),config,keys,'bound-nonce')).rejects.toThrow();
  await expect(verifyGoogleIdToken(token().replace(/.$/,'!'),config,keys,'bound-nonce')).rejects.toThrow();
 });
 it('rejects discovery documents redirecting token credentials or keys to any other endpoint',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://evil.example/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs'})));
  await expect(getGoogleMetadata()).rejects.toThrow('Untrusted Google endpoint');
 });
 it('sends PKCE only to the fixed Google token endpoint and treats revoked grants as rejected',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({id_token:'signed-token',refresh_token:'private-refresh'}));vi.stubGlobal('fetch',fetcher);
  const result=await exchangeGoogleTokens(readGoogleConfiguration(env),{code:'private-code',verifier:'bound-verifier'});
  expect(result.refreshToken).toBe('private-refresh');const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://oauth2.googleapis.com/token');
  expect(options.body.get('code_verifier')).toBe('bound-verifier');expect(options.body.get('client_secret')).toBe('google-secret');
  fetcher.mockResolvedValue(Response.json({error:'invalid_grant'},{status:400}));await expect(exchangeGoogleTokens(readGoogleConfiguration(env),{refreshToken:'revoked'})).rejects.toThrow('Sign-in is required');
 });
 it('authenticates the Google protocol marker, client and subject inside session ciphertext',()=>{
  const config={...readIdentitySessionConfiguration(env),provider:'external-id' as const};
  const credential=encodeGoogleRefresh({clientId:env.GOOGLE_CLIENT_ID,subject:'107691503500061507151',refreshToken:'private-google-refresh',email:'learner@example.com'});
  const cipher=encryptRefreshToken(credential,'session-a',config);
  expect(decodeGoogleRefresh(decryptRefreshToken(cipher,'session-a',config))).toEqual({clientId:env.GOOGLE_CLIENT_ID,subject:'107691503500061507151',refreshToken:'private-google-refresh',email:'learner@example.com'});
  expect(()=>decryptRefreshToken(cipher,'session-b',config)).toThrow();expect(()=>decryptRefreshToken(cipher,'session-a',{...config,provider:'microsoft'})).toThrow();
  expect(()=>decodeGoogleRefresh('google-v1:{"refreshToken":"x"}')).toThrow();
 });
});
