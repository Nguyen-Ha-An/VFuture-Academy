import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies:vi.fn(), save:vi.fn(), consume:vi.fn(), revokeAccount:vi.fn(), revokeBrowser:vi.fn(),
  createSession:vi.fn(), resolveUser:vi.fn(), keys:vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({cookies:mocks.cookies}));
vi.mock('@/lib/database/azure-client', () => ({createAzureDataClient:() => ({})}));
vi.mock('@/lib/rate-limit', () => ({enforceRequestRateLimit:vi.fn()}));
vi.mock('@/lib/identity/store', () => ({
  storeIdentityTransaction:mocks.save, consumeIdentityTransaction:mocks.consume,
  revokeRecoveredAccountSessions:mocks.revokeAccount, createStoredSession:mocks.createSession,
  resolveIdentityUser:mocks.resolveUser, initializeIdentityProfile:vi.fn(),
}));
vi.mock('@/lib/identity/server', () => ({
  SESSION_COOKIE:'academy_session', sessionCookieOptions:{httpOnly:true,sameSite:'lax',path:'/'},
  revokeAzureSession:mocks.revokeBrowser,
}));
vi.mock('@/lib/identity/oidc', async original => ({
  ...await original<typeof import('@/lib/identity/oidc')>(), getOidcMetadata:vi.fn(), getSigningKeys:mocks.keys,
}));
import { POST } from '@/app/api/v1/public/auth/native/route';
import { hashToken } from '@/lib/identity/oidc';

const tenant = 'f3152aa5-61de-40fd-bb76-780b9fbe5428';
const clientId = '22222222-2222-4222-8222-222222222222';
const objectId = '33333333-3333-4333-8333-333333333333';
const otherSession = 'b'.repeat(43);
const issuer = 'https://vfutureacademy.ciamlogin.com/'+tenant+'/v2.0';
const origin = 'https://academy.example';
const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
function resetToken(claims:Record<string,unknown> = {}) {
  const now = Math.floor(Date.now()/1000);
  const encode = (value:unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = [encode({alg:'RS256',kid:'recovery'}),encode({
    iss:issuer,tid:tenant,aud:clientId,sub:'pairwise-subject',oid:objectId,
    exp:now+3600,iat:now,email:'directory-alias@example.test',...claims,
  })].join('.');
  return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
}

type ProviderReply = Record<string,unknown> | Response | Error;
async function resetFlow(claims:Record<string,unknown> = {}, legacyPoll = false, completion?:(idToken:string)=>ProviderReply[]) {
  const idToken = resetToken(claims);
  const providerReplies:ProviderReply[] = [
    {continuation_token:'reset'}, {challenge_type:'oob',continuation_token:'code',challenge_target_label:'r***@example.test'},
    {continuation_token:'verified'}, {continuation_token:'pending',poll_interval:5},
    ...(completion?completion(idToken):[{status:'succeeded',continuation_token:'successor'}, {id_token:idToken}]),
  ];
  const transport = vi.fn(async (_input:RequestInfo|URL,_init?:RequestInit) => {
    const reply = providerReplies.shift();
    if (!reply) throw new Error('Unexpected provider request');
    if (reply instanceof Response) return reply;
    if (reply instanceof Error) throw reply;
    return Response.json(reply,{status:reply.error?400:200});
  });
  vi.stubGlobal('fetch',transport);
  const jar = new Map([['academy_session',otherSession]]);
  const stored = new Map<string,Record<string,unknown>>();
  mocks.cookies.mockImplementation(async () => ({get:(name:string) => jar.has(name) ? {value:jar.get(name)} : undefined}));
  mocks.save.mockImplementation(async (state:string,browser:string,payload:Record<string,unknown>) => { stored.set(state+browser,payload); });
  mocks.consume.mockImplementation(async (state:string,browser:string) => {
    const value = stored.get(state+browser);
    stored.delete(state+browser);
    return value ?? null;
  });
  let handle = {flowId:'',attemptId:''};
  async function send(payload:Record<string,unknown>) {
    const response = await POST(new Request(origin+'/api/v1/public/auth/native',{
      method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload),
    }));
    const body = await response.json();
    if (body.flowId) handle = {flowId:body.flowId,attemptId:body.attemptId};
    for (const match of response.headers.getSetCookie()) {
      const [name,value] = match.split(';')[0].split('=');
      if (value) jar.set(name,value); else jar.delete(name);
    }
    return {response,body};
  }
  const advance = (fields:Record<string,unknown> = {}) => send({action:'continue',...handle,...fields});
  const start=await send({action:'start',mode:'reset',email:'recovery@example.test'});
  expect(start.body.step).toBe('code');expect(start.body.target).toBeUndefined();
  expect((await advance({code:'12345678'})).body.step).toBe('new-password');
  expect((await advance({password:'New-Password1!'})).body.step).toBe('poll');
  for (const payload of stored.values()) {
    expect(payload.kind).toBe('native-recovery-v2');
    // A poll issued by the preceding release used the common native kind.
    if (legacyPoll) payload.kind='native';
  }
  expect(mocks.revokeAccount).not.toHaveBeenCalled();
  const poll = () => { vi.setSystemTime(Date.now()+5000); return advance(); };
  return {poll,advance,jar,transport,attemptId:handle.attemptId};
}

describe('native password recovery session revocation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({toFake:['Date']});
    for (const [key,value] of Object.entries({
      ACADEMY_BACKEND:'azure',NEXT_PUBLIC_ACADEMY_BACKEND:'azure',NEXT_PUBLIC_APP_URL:origin,
      ENTRA_TENANT_ID:tenant,ENTRA_CLIENT_ID:clientId,ENTRA_CLIENT_SECRET:'test',ENTRA_ISSUER:issuer,
      ENTRA_AUTHORITY:issuer,ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),
    })) vi.stubEnv(key,value);
    mocks.keys.mockResolvedValue([{...publicKey.export({format:'jwk'}),kid:'recovery',alg:'RS256'}]);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([false,true])('revokes the recovered immutable identity and preserves a different browser account (legacy poll %s)', async legacyPoll => {
    const {poll,jar,attemptId} = await resetFlow({},legacyPoll);
    const {body,response} = await poll();
    expect(body).toEqual({step:'reset-complete'});
    expect(mocks.revokeAccount).toHaveBeenCalledExactlyOnceWith(issuer,objectId,hashToken(attemptId));
    expect(mocks.resolveUser).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.revokeBrowser).not.toHaveBeenCalled(); expect(response.headers.get('set-cookie')).not.toContain('academy_session');
    expect(jar.get('academy_session')).toBe(otherSession);
    expect(jar.has('academy_native_'+attemptId)).toBe(false);
  });
  it.each([{aud:'other-client'},{oid:'unbound'},{tid:'other-tenant'}])('requires a valid signed proof for this client and tenant (%o)',async claims => {
    const {poll,jar} = await resetFlow(claims);
    const {response,body} = await poll();
    expect(response.status).toBe(400); expect(body.error).toBe('request_failed');
    expect(jar.get('academy_session')).toBe(otherSession);
    expect(mocks.revokeAccount).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it('retries uncertain storage completion with the same proof and idempotency key',async () => {
    mocks.revokeAccount.mockRejectedValueOnce(new Error('Storage unavailable'));
    const {poll,attemptId,transport} = await resetFlow();
    const first = await poll();
    expect(first.body).toMatchObject({step:'poll',retryAfterSeconds:5});
    expect(JSON.stringify(first.body)).not.toContain('token');
    const providerCalls = transport.mock.calls.length;
    expect((await poll()).body).toEqual({step:'reset-complete'});
    expect(transport).toHaveBeenCalledTimes(providerCalls);
    expect(mocks.revokeAccount.mock.calls).toEqual(Array(2).fill([issuer,objectId,hashToken(attemptId)]));
  });
  it('resumes the precise poll, grant, method selection, challenge and MFA-code steps after temporary failures',async()=>{
    const {poll,advance,transport}=await resetFlow({},false,idToken=>[
      new Response(null,{status:503}), {status:'succeeded',continuation_token:'grant'},
      Response.json({error:'temporarily_unavailable',continuation_token:'grant-retry'},{status:503}),
      {error:'invalid_grant',suberror:'mfa_required',continuation_token:'methods'},
      new TypeError('Temporary read failure'),
      {continuation_token:'selected',methods:[{id:'email-method',challenge_type:'oob',challenge_channel:'email'}]},
      Response.json({error:'temporarily_unavailable',continuation_token:'challenge-retry'},{status:429,headers:{'retry-after':'8'}}),
      {challenge_type:'oob',continuation_token:'mfa',challenge_target_label:'v***@verification.test',code_length:6},
      Response.json({error:'temporarily_unavailable',continuation_token:'mfa-retry'},{status:429}),
      {id_token:idToken},
    ]);
    for (const seconds of [5,5,5,8]) expect((await poll()).body).toMatchObject({step:'poll',retryAfterSeconds:seconds});
    vi.setSystemTime(Date.now()+3000);
    expect((await poll()).body).toMatchObject({step:'mfa-code',target:'v***@verification.test',codeLength:6});
    const limited=await advance({code:'123456'});
    expect(limited.body).toMatchObject({step:'mfa-code',error:'rate_limited'});
    expect(mocks.revokeAccount).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now()+5000);
    expect((await advance({code:'234567'})).body).toEqual({step:'reset-complete'});
    const calls=transport.mock.calls.slice(4).map(([url,options])=>[
      new URL(String(url)).pathname.split('/').at(-1), new URLSearchParams(String(options?.body)).get('continuation_token'),
    ]);
    expect(calls).toEqual([['poll_completion','pending'],['poll_completion','pending'],['token','grant'],['token','grant-retry'],
      ['introspect','methods'],['introspect','methods'],['challenge','selected'],['challenge','challenge-retry'],['token','mfa'],['token','mfa-retry']]);
    expect(mocks.revokeAccount).toHaveBeenCalledOnce();
  });
  it.each([undefined,'verification@example.test'])('omits the post-reset challenge destination for an absent or unmasked label (%s)',async label=>{
    const {poll}=await resetFlow({},false,()=>[
      {status:'succeeded',continuation_token:'grant'},{error:'mfa_required',continuation_token:'methods'},
      {continuation_token:'selected',methods:[{id:'email-method',challenge_type:'oob',challenge_channel:'email'}]},
      {challenge_type:'oob',continuation_token:'code',challenge_target_label:label},
    ]);
    const {body}=await poll();
    expect(body.step).toBe('mfa-code');expect(body.target).toBeUndefined();
  });
  it('requests a new flow when the provider may already have issued an MFA challenge',async()=>{
    const {poll,transport}=await resetFlow({},false,()=>[
      {status:'succeeded',continuation_token:'grant'},{error:'mfa_required',continuation_token:'methods'},
      {continuation_token:'selected',methods:[{id:'email-method',challenge_type:'oob',challenge_channel:'email'}]},
      new TypeError('Challenge response lost'),
    ]);
    const failed=await poll();
    expect(failed.response.status).toBe(409);expect(failed.body).toEqual({error:'restart_required'});
    expect((await poll()).body).toEqual({error:'expired'});
    expect(transport).toHaveBeenCalledTimes(8);expect(mocks.revokeAccount).not.toHaveBeenCalled();
  });
});
