import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({cookies:vi.fn(),rate:vi.fn(),save:vi.fn(),consume:vi.fn(),start:vi.fn(),advance:vi.fn(),resolve:vi.fn(),create:vi.fn(),revoke:vi.fn(),verify:vi.fn(),metadata:vi.fn(),keys:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:mocks.cookies}));
vi.mock('@/lib/database/azure-client',()=>({createAzureDataClient:()=>({})}));
vi.mock('@/lib/rate-limit',()=>({enforceRequestRateLimit:mocks.rate}));
vi.mock('@/lib/identity/store',()=>({storeIdentityTransaction:mocks.save,consumeIdentityTransaction:mocks.consume,resolveIdentityUser:mocks.resolve,initializeIdentityProfile:vi.fn().mockResolvedValue("STU-test"),createStoredSession:mocks.create}));
vi.mock('@/lib/identity/server',()=>({SESSION_COOKIE:'academy_session',sessionCookieOptions:{httpOnly:true,sameSite:'lax',path:'/'},revokeAzureSession:mocks.revoke}));
vi.mock('@/lib/identity/native',async original=>({...await original<typeof import('@/lib/identity/native')>(),createNativeClient:()=>({start:mocks.start,advance:mocks.advance})}));
vi.mock('@/lib/identity/oidc',async original=>({...await original<typeof import('@/lib/identity/oidc')>(),verifyIdToken:mocks.verify,getOidcMetadata:mocks.metadata,getSigningKeys:mocks.keys}));
import { nativeAuthentication } from '@/lib/identity/native-routes';
import { POST as nativePost } from '@/app/api/v1/public/auth/native/route';
const vars={ACADEMY_BACKEND:'azure',NEXT_PUBLIC_ACADEMY_BACKEND:'azure',ENTRA_TENANT_ID:'f3152aa5-61de-40fd-bb76-780b9fbe5428',ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222',ENTRA_CLIENT_SECRET:'private-server-secret',ENTRA_ISSUER:'https://vfutureacademy.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0',ENTRA_AUTHORITY:'https://vfutureacademy.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0',NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
function request(body:unknown,origin='https://academy.example'){return new Request('https://academy.example/api/v1/public/auth/native',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
describe('same-origin native authentication routes',()=>{
  beforeEach(()=>{vi.clearAllMocks();for(const[k,v]of Object.entries(vars))vi.stubEnv(k,v);mocks.cookies.mockResolvedValue({get:()=>undefined});mocks.consume.mockResolvedValue(null);});
  it('rejects cross-origin credentials before rate limiting or provider access',async()=>{
    const result=await nativeAuthentication(request({action:'start',mode:'login',email:'a@example.com',password:'Password1!'},'https://evil.example'));
    expect(result.status).toBe(403);expect(mocks.start).not.toHaveBeenCalled();expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('keeps even the standard handler cross-origin denial uncacheable',async()=>{
    const result=await nativePost(request({action:'start',mode:'login',email:'a@example.com',password:'Password1!'},'https://evil.example'));
    expect(result.status).toBe(403);expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('does not accept a browser-provided provider token as a login',async()=>{
    const result=await nativeAuthentication(request({action:'start',mode:'login',email:'a@example.com',password:'Password1!',idToken:'stolen'}));
    expect(result.status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('issues only an opaque HttpOnly session after server-side token verification',async()=>{
    const flow={mode:'login',step:'new-password',continuation:'private-continuation',email:'a@example.com',next:'/app/courses/test',expiresAt:Date.now()+600000};
    mocks.start.mockResolvedValue({step:'complete',flow,tokens:{idToken:'private-id-token',refreshToken:'private-refresh'}});
    mocks.verify.mockResolvedValue({iss:vars.ENTRA_ISSUER,oid:'33333333-3333-4333-8333-333333333333',sub:'pairwise',exp:Math.floor(Date.now()/1000)+3600});mocks.resolve.mockResolvedValue({id:'user'});
    const result=await nativeAuthentication(request({action:'start',mode:'login',email:'a@example.com',password:'Password1!',next:'/app/courses/test'}));
    expect(result.status).toBe(200);expect(result.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.verify.mock.calls[0][0]).toBe('private-id-token');expect(mocks.create).toHaveBeenCalledOnce();
    const text=await result.text();expect(text).toContain('complete');expect(text).not.toMatch(/private-|Password1/);
    expect(result.headers.get('location')).toBeNull();
  });
  it('encrypts continuation state and binds the one-use handle to the browser cookie',async()=>{
    mocks.start.mockResolvedValue({step:'code',flow:{mode:'signup',step:'code',continuation:'private-continuation',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000}});
    const result=await nativeAuthentication(request({action:'start',mode:'signup',email:'a@example.com',password:'Password1!'}));
    const body=await result.json();expect(body.flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.attemptId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.cookies.get('academy_native_'+body.attemptId)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(mocks.save.mock.calls)).not.toMatch(/private-continuation|Password1!/);
    expect(JSON.stringify(body)).not.toContain('continuation');
    const replay=await nativeAuthentication(request({action:'continue',flowId:body.flowId,attemptId:body.attemptId,code:'12345678'}));
    expect(replay.status).toBe(409);expect(mocks.advance).not.toHaveBeenCalled();
  });
  it('consumes continuation handles once and does not let an older response overwrite a newer browser proof',async()=>{
    const flow={mode:'signup',step:'code',continuation:'private-continuation',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000};
    mocks.start.mockResolvedValue({step:'code',flow});
    const start=await nativeAuthentication(request({action:'start',mode:'signup',email:'a@example.com',password:'Password1!'}));
    const first=await start.json();const proof=start.cookies.get('academy_native_'+first.attemptId)!.value;
    mocks.cookies.mockResolvedValue({get:()=>({value:proof})});
    mocks.consume.mockResolvedValueOnce(mocks.save.mock.calls[0][2]).mockResolvedValueOnce(null);
    mocks.advance.mockResolvedValue({step:'code',flow:{...flow,continuation:'rotated'}});
    const next=await nativeAuthentication(request({action:'continue',flowId:first.flowId,attemptId:first.attemptId,code:'12345678'}));
    expect(next.status).toBe(200);expect(next.cookies.get('academy_native_'+first.attemptId)).toBeUndefined();
    expect((await nativeAuthentication(request({action:'continue',flowId:first.flowId,attemptId:first.attemptId,code:'12345678'}))).status).toBe(409);
  });
  it('returns the same recovery screen metadata for existing and nonexistent customers',async()=>{
    const base={mode:'reset',step:'code',continuation:'private',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000};
    mocks.start.mockResolvedValueOnce({step:'code',flow:{...base,target:'a***@example.com',codeLength:6}}).mockResolvedValueOnce({step:'code',flow:{...base,decoy:true,codeLength:8}});
    const known=await (await nativeAuthentication(request({action:'start',mode:'reset',email:'a@example.com'}))).json();
    const missing=await (await nativeAuthentication(request({action:'start',mode:'reset',email:'a@example.com'}))).json();
    expect(Object.keys(known).sort()).toEqual(Object.keys(missing).sort());expect(known.target).toBeUndefined();expect(known.codeLength).toBe(missing.codeLength);
  });
  it('isolates proof cookies for simultaneous signup attempts in separate tabs',async()=>{
    mocks.start.mockResolvedValue({step:'code',flow:{mode:'signup',step:'code',continuation:'private',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000}});
    const a=await nativeAuthentication(request({action:'start',mode:'signup',email:'a@example.com',password:'Password1!'}));
    const b=await nativeAuthentication(request({action:'start',mode:'signup',email:'b@example.com',password:'Password1!'}));
    const one=await a.json(),two=await b.json();expect(one.attemptId).not.toBe(two.attemptId);
    expect(a.cookies.get('academy_native_'+one.attemptId)).toBeDefined();expect(b.cookies.get('academy_native_'+two.attemptId)).toBeDefined();
  });
  it('initializes a verified signup from its bound submitted name when provider name is absent',async()=>{
    const flow={mode:'signup',step:'code',continuation:'private',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000,verifiedEmail:true,displayName:'Đặng Thị Ánh'};
    mocks.start.mockResolvedValue({step:'complete',flow,tokens:{idToken:'private-id-token',refreshToken:'private-refresh'}});
    mocks.verify.mockResolvedValue({iss:vars.ENTRA_ISSUER,oid:'33333333-3333-4333-8333-333333333333',sub:'subject',exp:Math.floor(Date.now()/1000)+3600});
    mocks.resolve.mockResolvedValue({id:'44444444-4444-4444-8444-444444444444'});
    const result=await nativeAuthentication(request({action:'start',mode:'signup',email:'a@example.com',password:'Password1!',displayName:'Đặng Thị Ánh'}));
    expect(result.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({name:'Đặng Thị Ánh',email_verified:true}));
  });
});
