import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), consume: vi.fn(), store: vi.fn(), resolve: vi.fn(), staff: vi.fn(), create: vi.fn(), revoke: vi.fn(), metadata: vi.fn(), exchange: vi.fn(), keys: vi.fn(), rateLimit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/identity/store', () => ({ consumeLoginTransaction: mocks.consume, storeLoginTransaction: mocks.store, resolveIdentityUser: mocks.resolve, initializeIdentityProfile: vi.fn().mockResolvedValue("STU-test"), findMicrosoftStaffUser: mocks.staff, createStoredSession: mocks.create }));
vi.mock('@/lib/identity/server', () => ({ LOGIN_COOKIE: 'academy_login', SESSION_COOKIE: 'academy_session', sessionCookieOptions: { httpOnly: true, sameSite: 'lax', path: '/' }, revokeAzureSession: mocks.revoke }));
vi.mock('@/lib/identity/oidc', async (original) => ({ ...await original<typeof import('@/lib/identity/oidc')>(), getOidcMetadata: mocks.metadata, exchangeTokens: mocks.exchange, getSigningKeys: mocks.keys }));
vi.mock('@/lib/database/azure-client', () => ({ createAzureDataClient: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ enforceRequestRateLimit: mocks.rateLimit }));
import { azureCallback, azureLogin, azureLogout } from '@/lib/identity/routes';

const vars = { MICROSOFT_ENTRA_TENANT_ID: '157419c9-2de9-45e7-a6f9-91546dbef629', MICROSOFT_ENTRA_CLIENT_ID: '66666666-6666-4666-8666-666666666666', MICROSOFT_ENTRA_CLIENT_SECRET: 'internal-secret', ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111', ENTRA_CLIENT_ID: '22222222-2222-4222-8222-222222222222', ENTRA_CLIENT_SECRET: 'secret', ENTRA_ISSUER: 'https://test.ciamlogin.com/tenant/v2.0', ENTRA_AUTHORITY: 'https://test.ciamlogin.com/tenant/v2.0', NEXT_PUBLIC_APP_URL: 'https://academy.example', GOOGLE_CLIENT_ID:'1234567890-example.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET:'google-secret', ENTRA_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') };
describe('Azure authentication routes', () => {
  beforeEach(() => { vi.clearAllMocks(); for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value); mocks.cookies.mockResolvedValue({ get: () => undefined }); });
  it('rejects callbacks without a matching browser-bound single-use transaction', async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'b'.repeat(43) }) });
    mocks.consume.mockResolvedValue(null);
    const response = await azureCallback(new Request(`https://academy.example/auth/callback?code=stolen&state=${'a'.repeat(43)}`));
    expect(response.headers.get('location')).toContain('/login?error=provider');
    expect(response.cookies.get('academy_login')).toBeUndefined();
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('stores the browser-bound transaction before redirect and uses HttpOnly cookies', async () => {
    mocks.metadata.mockResolvedValue({ authorization_endpoint: 'https://test.ciamlogin.com/authorize' });
    const response = await azureLogin(new Request('https://academy.example/auth/login?provider=google&next=https://evil.example'));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).host).toBe('accounts.google.com');
    expect(mocks.store.mock.calls[0][2].kind).toBe('google-v1');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.store.mock.calls[0][2].next).toBe('/app');
  });
  it('keeps password and recovery entry on the Academy UI without starting an OAuth transaction', async () => {
    const response=await azureLogin(new Request('https://academy.example/auth/login?provider=password&mode=recovery'));
    expect(response.headers.get('location')).toBe('https://academy.example/forgot-password');
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('rejects cross-site logout before revoking the current session', async () => {
    const response = await azureLogout(new Request('https://academy.example/auth/signout', { method: 'POST', headers: { origin: 'https://evil.example' } }));
    expect(response.status).toBe(403);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('issues an opaque session only after signed identity validation and preserves onboarding destination', async () => {
    const state = 'a'.repeat(43);
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'b'.repeat(43) }) });
    mocks.consume.mockResolvedValue({ provider: 'external-id', state, nonce: 'bound-nonce', verifier: 'c'.repeat(43), next: '/app/courses/test' });
    const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
    const body = [{alg:'RS256',kid:'route-key'}, {iss:vars.ENTRA_ISSUER,aud:vars.ENTRA_CLIENT_ID,tid:vars.ENTRA_TENANT_ID,sub:'pairwise',oid:'33333333-3333-4333-8333-333333333333',nonce:'bound-nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
    mocks.metadata.mockResolvedValue({});
    mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'route-key'}]);
    mocks.exchange.mockResolvedValue({idToken:body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url'),refreshToken:'private-refresh-token'});
    mocks.resolve.mockResolvedValue({id:'44444444-4444-4444-8444-444444444444'});
    const response = await azureCallback(new Request(`https://academy.example/auth/callback?code=valid&state=${state}`));
    expect(response.headers.get('location')).toBe('https://academy.example/welcome?next=%2Fapp%2Fcourses%2Ftest');
    expect(response.cookies.get('academy_session')?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get('set-cookie')).not.toContain('private-refresh-token');
    expect(mocks.create.mock.calls[0][1].user.id).toBe('44444444-4444-4444-8444-444444444444');
    expect(mocks.create.mock.calls[0][1].refreshCiphertext).not.toContain('private-refresh-token');
    expect(mocks.revoke).toHaveBeenCalledOnce();
    expect(response.cookies.get('academy_session')?.maxAge).toBe(2592000);
    expect(mocks.create.mock.calls[0][1].expiresAt - Math.floor(Date.now()/1000)).toBe(2592000);
  });

});

const workforceIssuer='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0';
describe('Microsoft callback provider and staff binding',()=>{
 const state='a'.repeat(43);
 beforeEach(()=>{
  vi.clearAllMocks();for(const [key,value] of Object.entries(vars))vi.stubEnv(key,value);
  mocks.cookies.mockResolvedValue({get:()=>({value:'b'.repeat(43)})});
  mocks.consume.mockResolvedValue({provider:'microsoft',state,nonce:'bound-nonce',verifier:'c'.repeat(43),next:'/studio'});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const body=[{alg:'RS256',kid:'staff-key'},{iss:workforceIssuer,tid:vars.MICROSOFT_ENTRA_TENANT_ID,aud:vars.MICROSOFT_ENTRA_CLIENT_ID,ver:'2.0',acct:0,upn:'staff@vfuturelabs.org',sub:'staff-pairwise',oid:'77777777-7777-4777-8777-777777777777',nonce:'bound-nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'staff-key'}]);mocks.metadata.mockResolvedValue({});
  mocks.exchange.mockResolvedValue({idToken:body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url'),refreshToken:'staff-refresh'});
 });
 it('uses stored Microsoft state despite a conflicting query and never provisions a staff account',async()=>{
  mocks.staff.mockResolvedValue({id:'88888888-8888-4888-8888-888888888888'});
  vi.stubEnv('ENTRA_CLIENT_SECRET',undefined);vi.stubEnv('ENTRA_TENANT_ID',undefined);
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?code=valid&state=${state}&provider=google`));
  expect(response.headers.get('location')).toBe('https://academy.example/welcome?next=%2Fstudio');
  expect(mocks.create.mock.calls[0][1]).toMatchObject({provider:'microsoft',issuer:workforceIssuer,user:{id:'88888888-8888-4888-8888-888888888888'}});
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(response.cookies.get('academy_session')?.maxAge).toBe(2592000);
  expect(mocks.create.mock.calls[0][1].expiresAt - Math.floor(Date.now()/1000)).toBe(2592000);
 });
 it('denies unmatched or nonstaff Microsoft identities even with a valid signed token',async()=>{
  mocks.staff.mockResolvedValue(null);
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?code=valid&state=${state}`));
  expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.create).not.toHaveBeenCalled();expect(mocks.resolve).not.toHaveBeenCalled();
 });
 it('does not accept a Microsoft token in an External ID transaction by changing the query provider',async()=>{
  mocks.consume.mockResolvedValue({provider:'external-id',state,nonce:'bound-nonce',verifier:'c'.repeat(43),next:'/app'});
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?code=valid&state=${state}&provider=microsoft`));
  expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.staff).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
 });
 it('completes only the server-stored popup attempt after setting the session cookie',async()=>{
  const attempt='a'.repeat(48);mocks.staff.mockResolvedValue({id:'88888888-8888-4888-8888-888888888888'});
  mocks.consume.mockResolvedValue({provider:'microsoft',state,nonce:'bound-nonce',verifier:'c'.repeat(43),next:'/studio',popupAttempt:attempt});
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?code=private-code&state=${state}&attempt=${'b'.repeat(48)}`));
  const destination=new URL(response.headers.get('location')!);
  expect(destination.pathname).toBe('/auth/popup');expect(destination.searchParams.get('attempt')).toBe(attempt);expect(destination.searchParams.get('status')).toBe('success');
  expect(response.cookies.get('academy_session')?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(destination.searchParams.size).toBe(2);expect(destination.href).not.toContain('private-code');expect(destination.href).not.toContain('88888888');
 });
 it('returns a cancelled popup attempt as an error signal without creating a session',async()=>{
  mocks.consume.mockResolvedValue({provider:'microsoft',state,nonce:'bound-nonce',verifier:'c'.repeat(43),next:'/studio',popupAttempt:'a'.repeat(48)});
  const response=await azureCallback(new Request(`https://academy.example/auth/callback?error=access_denied&state=${state}`));
  expect(new URL(response.headers.get('location')!).searchParams.get('status')).toBe('error');expect(mocks.create).not.toHaveBeenCalled();expect(mocks.exchange).not.toHaveBeenCalled();
 });

 it.each(['success','failure'] as const)('never overwrites a retry login cookie when an older valid callback finishes with %s',async outcome=>{
  mocks.staff.mockResolvedValue({id:'88888888-8888-4888-8888-888888888888'});
  const tokens=await mocks.exchange();let entered!:()=>void;let finish!:(value:typeof tokens)=>void;let reject!:(error:Error)=>void;
  const exchanging=new Promise<void>(resolve=>{entered=resolve;});
  const pending=new Promise<typeof tokens>((resolve,fail)=>{finish=resolve;reject=fail;});
  mocks.exchange.mockImplementation(async()=>{entered();return pending;});
  const oldResponsePromise=azureCallback(new Request(`https://academy.example/auth/callback?code=old-code&state=${state}`));
  await exchanging;
  mocks.metadata.mockResolvedValue({authorization_endpoint:'https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/oauth2/v2.0/authorize'});
  const retryResponse=await azureLogin(new Request('https://academy.example/auth/login?provider=microsoft'));
  const currentCookie=retryResponse.cookies.get('academy_login');expect(currentCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  mocks.cookies.mockResolvedValue({get:()=>({value:currentCookie!.value})});
  if(outcome==='success')finish(tokens);else reject(new Error('old callback failed'));
  const oldResponse=await oldResponsePromise;
  expect(oldResponse.cookies.get('academy_login')).toBeUndefined();
  expect(retryResponse.cookies.get('academy_login')?.value).toBe(currentCookie!.value);
 });

});
