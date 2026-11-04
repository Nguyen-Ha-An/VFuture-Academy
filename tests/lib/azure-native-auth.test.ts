import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createNativeClient, NativeAuthError } from '@/lib/identity/native';
import { readIdentityConfiguration } from '@/lib/identity/oidc';

const config=()=>readIdentityConfiguration({ENTRA_TENANT_ID:'f3152aa5-61de-40fd-bb76-780b9fbe5428',ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222',ENTRA_CLIENT_SECRET:'server-only',ENTRA_ISSUER:'https://vfutureacademy.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0',ENTRA_AUTHORITY:'https://vfutureacademy.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0',NEXT_PUBLIC_APP_URL:'https://academy.example',ENTRA_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
function provider(responses:Record<string,unknown>[]) {
  const requests:{path:string;body:URLSearchParams}[]=[];
  const fetcher:typeof fetch=async(url,options)=>{
    requests.push({path:new URL(String(url)).pathname,body:new URLSearchParams(String(options?.body))});
    const body=responses.shift();if(!body)throw new Error('Unexpected provider request');
    return Response.json(body,{status:body.error?400:200});
  };
  return {requests,client:createNativeClient(config(),fetcher)};
}
describe('server-side Entra native protocol',()=>{
  it('authenticates password through a continuation-bound native challenge without returning a redirect',async()=>{
    const {client,requests}=provider([{continuation_token:'init'},{challenge_type:'password',continuation_token:'password-challenge'},{id_token:'private-id-token',refresh_token:'private-refresh'}]);
    const result=await client.start('login',{email:'learner@example.com',password:'Password1!',next:'/app'});
    expect(result.step).toBe('complete');
    if(result.step==='complete')expect(result.tokens).toEqual({idToken:'private-id-token',refreshToken:'private-refresh'});
    expect(requests.map(r=>r.path.split('/').pop())).toEqual(['initiate','challenge','token']);
    expect(requests[2].body.get('continuation_token')).toBe('password-challenge');
    expect(requests[2].body.get('password')).toBe('Password1!');
    expect(requests.every(r=>!r.body.has('client_secret'))).toBe(true);
  });
  it('verifies signup email inline before creating the authenticated session',async()=>{
    const {client}=provider([{continuation_token:'signup'},{continuation_token:'code',challenge_type:'oob',code_length:8},{continuation_token:'verified'},{id_token:'id',refresh_token:'refresh'}]);
    const start=await client.start('signup',{email:'new@example.com',password:'Password1!',displayName:'New learner',next:'/app'});
    expect(start.step).toBe('code');
    if(start.step!=='code')throw new Error('Expected verification');
    expect(JSON.stringify(start.flow)).not.toContain('Password1!');
    const done=await client.advance(start.flow,{code:'12345678'});
    expect(done.step).toBe('complete');expect(done.flow.verifiedEmail).toBe(true);
  });
  it('preserves a wrong-code retry but never forwards provider error text',async()=>{
    const {client}=provider([{continuation_token:'signup'},{continuation_token:'code',challenge_type:'oob'},{error:'invalid_grant',suberror:'invalid_oob_value',error_description:'PRIVATE TRACE',continuation_token:'retry'}]);
    const start=await client.start('signup',{email:'new@example.com',password:'Password1!',next:'/app'});
    if(start.step!=='code')throw new Error('Expected verification');
    try{await client.advance(start.flow,{code:'00000000'});throw new Error('Expected rejection');}catch(error){
      expect(error).toBeInstanceOf(NativeAuthError);
      expect((error as NativeAuthError).code).toBe('invalid_code');
      expect((error as NativeAuthError).flow?.continuation).toBe('retry');
      expect(String(error)).not.toContain('PRIVATE TRACE');
    }
  });
  it('keeps password reset code, new password and completion on the native protocol',async()=>{
    const {client,requests}=provider([{continuation_token:'reset'},{continuation_token:'code',challenge_type:'oob'},{continuation_token:'verified'},{continuation_token:'pending',poll_interval:2},{status:'succeeded',continuation_token:'done'}]);
    const start=await client.start('reset',{email:'learner@example.com',next:'/app'});
    if(start.step!=='code')throw new Error('Expected code');
    const verified=await client.advance(start.flow,{code:'12345678'});
    expect(verified.step).toBe('new-password');
    const submitted=await client.advance(verified.flow,{password:'NewPassword1!'});
    expect(submitted.step).toBe('poll');
    const finished=await client.advance({...submitted.flow,pollNotBefore:0},{});
    expect(finished.step).toBe('reset-complete');
    expect(requests.map(r=>r.path.split('/').pop())).toEqual(['start','challenge','continue','submit','poll_completion']);
  });
  it('does not silently turn a native credentials request into a Microsoft popup',async()=>{
    const {client}=provider([{challenge_type:'redirect',redirect_uri:'https://example.ciamlogin.com/login'}]);
    await expect(client.start('login',{email:'learner@example.com',password:'Password1!',next:'/app'})).rejects.toMatchObject({code:'unsupported_method'});
  });
  it('rejects expired native state before any provider operation',async()=>{
    const {client,requests}=provider([]);
    await expect(client.advance({mode:'signup',step:'code',continuation:'private',email:'learner@example.com',next:'/app',expiresAt:1}, {code:'12345678'})).rejects.toMatchObject({code:'expired'});
    expect(requests).toHaveLength(0);
  });
  it('completes a required email MFA challenge inline without skipping the second factor',async()=>{
    const {client,requests}=provider([{continuation_token:'init'},{challenge_type:'password',continuation_token:'password'},{error:'invalid_grant',suberror:'mfa_required',continuation_token:'mfa'},{continuation_token:'methods',methods:[{id:'email-method',challenge_type:'oob',challenge_channel:'email'}]},{challenge_type:'oob',continuation_token:'code',code_length:8},{id_token:'id',refresh_token:'refresh'}]);
    const start=await client.start('login',{email:'learner@example.com',password:'Password1!',next:'/app'});
    expect(start.step).toBe('mfa-code');
    const done=await client.advance(start.flow,{code:'12345678'});
    expect(done.step).toBe('complete');expect(requests.at(-1)?.body.get('grant_type')).toBe('mfa_oob');
    expect(requests[3].path.endsWith('/introspect')).toBe(true);expect(requests[4].body.get('id')).toBe('email-method');
  });
  it('uses the same recovery code screen for a missing customer without disclosing account existence',async()=>{
    const {client,requests}=provider([{error:'user_not_found',error_description:'PRIVATE ADDRESS'}]);
    const start=await client.start('reset',{email:'missing@example.com',next:'/app'});
    expect(start.step).toBe('code');
    await expect(client.advance(start.flow,{code:'12345678'})).rejects.toMatchObject({code:'invalid_code'});
    expect(requests).toHaveLength(1);
  });
  it('reports missing app consent as a setup outage instead of blaming the password',async()=>{
    const {client}=provider([{continuation_token:'init'},{challenge_type:'password',continuation_token:'password'},{error:'invalid_grant',suberror:'consent_required'}]);
    await expect(client.start('login',{email:'learner@example.com',password:'Password1!',next:'/app'})).rejects.toMatchObject({code:'unavailable'});
  });
  it('keeps a reset continuation when password processing has not started yet',async()=>{
    const {client}=provider([{status:'not_started',continuation_token:'waiting'}]);
    const result=await client.advance({mode:'reset',step:'poll',continuation:'private',email:'a@example.com',next:'/app',expiresAt:Date.now()+600000,pollNotBefore:0},{});
    expect(result.step).toBe('poll');expect(result.flow.continuation).toBe('waiting');
  });
});
