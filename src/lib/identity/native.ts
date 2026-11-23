import 'server-only';
import { readTextBodyLimited } from '@/lib/body-limit';
import type { IdentityConfiguration } from './oidc';

export type NativeMode = 'login' | 'signup' | 'reset';
export type NativeStep = 'code' | 'mfa-code' | 'new-password' | 'poll';
export type NativeFlow = {
  mode: NativeMode; step: NativeStep; continuation: string; email: string;
  next: string; expiresAt: number; verifiedEmail?: boolean; displayName?: string;
  codeLength?: number; target?: string; pollNotBefore?: number; decoy?: boolean;
  // After a successful reset poll, a retry redeems its successor or reuses the
  // ID token already received. Both stay in the encrypted, browser-bound flow.
  recoveryProof?: { stage: 'exchange' | 'methods' | 'mfa' } | { stage:'challenge'; methodId:string } | { stage: 'verify'; idToken: string };
};
export type NativeInput = { email: string; password?: string; displayName?: string; next: string };
export type NativeResult = { step: NativeStep; flow: NativeFlow }
  | { step: 'reset-complete'; flow: NativeFlow; idToken: string }
  | { step: 'complete'; flow: NativeFlow; tokens: { idToken: string; refreshToken?: string } };
export type NativeErrorCode = 'invalid_credentials' | 'invalid_code' | 'password_policy' | 'expired' | 'restart_required' | 'unsupported_method' | 'rate_limited' | 'unavailable' | 'request_failed' | 'wait';
export class NativeAuthError extends Error {
  constructor(public code: NativeErrorCode, public flow?: NativeFlow) { super(code); this.name='NativeAuthError'; }
}
type ProviderResponse = Record<string, unknown>;
const validContinuation = (value:unknown):value is string => typeof value==='string' && value.length>0 && value.length<=65536;

class ProviderTemporaryError extends NativeAuthError {
  constructor(code:'unavailable'|'rate_limited',readonly declined:boolean,readonly continuation?:string,readonly retrySeconds=5) { super(code); }
}

/** Native credentials use a server back channel. No browser-supplied endpoint or bearer token is accepted. */
export function createNativeClient(config: IdentityConfiguration, request: typeof fetch = fetch) {
  if (config.provider!=='external-id' || config.tenantId!=='f3152aa5-61de-40fd-bb76-780b9fbe5428'
    || new URL(config.authority).hostname!=='vfutureacademy.ciamlogin.com') throw new NativeAuthError('unavailable');
  const base='https://vfutureacademy.ciamlogin.com/vfutureacademy.onmicrosoft.com';
  const paths = new Set(['oauth2/v2.0/initiate','oauth2/v2.0/challenge','oauth2/v2.0/token','oauth2/v2.0/introspect',
    'signup/v1.0/start','signup/v1.0/challenge','signup/v1.0/continue',
    'resetpassword/v1.0/start','resetpassword/v1.0/challenge','resetpassword/v1.0/continue','resetpassword/v1.0/submit','resetpassword/v1.0/poll_completion']);
  async function call(path: string, fields: Record<string,string>): Promise<ProviderResponse> {
    if(!paths.has(path))throw new NativeAuthError('unavailable');
    let response: Response;
    try { response=await request(`${base}/${path}`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,...fields})}); }
    catch { throw new ProviderTemporaryError('unavailable',false); }
    let data: ProviderResponse | undefined;
    try { data=JSON.parse(await readTextBodyLimited(response,256*1024)); }
    catch { /* An HTTP refusal can omit its optional JSON details. */ }
    const providerError=data?.error;
    const limited=response.status===429 || providerError==='slow_down';
    if (limited || response.status>=500 || providerError==='temporarily_unavailable' || providerError==='server_error') {
      const retryHeader=response.headers.get('retry-after');
      const delay=retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader??'')-Date.now())/1000);
      const retrySeconds=Number.isNaN(delay)?5:Math.min(600,Math.max(5,delay));
      const retryToken=(limited || providerError==='temporarily_unavailable' || providerError==='server_error')
        && validContinuation(data?.continuation_token) ? data.continuation_token : undefined;
      throw new ProviderTemporaryError(limited?'rate_limited':'unavailable',limited || providerError==='temporarily_unavailable',
        retryToken,retrySeconds);
    }
    if(!data || typeof data!=='object' || Array.isArray(data))throw new ProviderTemporaryError('unavailable',false);
    if(data.challenge_type==='redirect')throw new NativeAuthError('unsupported_method');
    if(!response.ok && typeof data.error!=='string')throw new NativeAuthError('unavailable');
    return data;
  }
  async function callForFlow(flow:NativeFlow,path:string,fields:Record<string,string>):Promise<ProviderResponse> {
    try { return await call(path,fields); }
    catch (error) {
      if (flow.mode!=='reset' || !(error instanceof ProviderTemporaryError)) throw error;
      // A lost response can follow a successful write. Only repeat a write
      // when Entra declined it or supplied a continuation for another attempt.
      const readOnly=path==='resetpassword/v1.0/poll_completion' || path==='oauth2/v2.0/introspect';
      if (!readOnly && !error.declined && !error.continuation) throw new NativeAuthError('restart_required');
      throw new NativeAuthError(flow.step==='poll'?'wait':error.code,{
        ...flow, continuation:error.continuation??flow.continuation, pollNotBefore:Date.now()+error.retrySeconds*1000,
      });
    }
  }
  function check(data: ProviderResponse, flow?: NativeFlow): ProviderResponse {
    if(!data.error)return data;
    const error=String(data.error),sub=String(data.suberror??'');
    const retry=flow?{...flow,continuation:typeof data.continuation_token==='string'?data.continuation_token:flow.continuation}:undefined;
    if(error==='expired_token')throw new NativeAuthError('expired');
    if(error==='invalid_client'||error==='unauthorized_client'||sub==='consent_required'||error==='consent_required')throw new NativeAuthError('unavailable');
    if(sub==='invalid_oob_value'||error==='invalid_oob_value')throw new NativeAuthError('invalid_code',retry);
    if(sub.startsWith('password_')||error.startsWith('password_'))throw new NativeAuthError('password_policy',retry);
    if(flow?.continuation && ['code','mfa-code'].includes(flow.step) && error==='invalid_grant')throw new NativeAuthError('invalid_code',retry);
    throw new NativeAuthError(flow?.mode==='login'?'invalid_credentials':'request_failed');
  }
  function continued(flow: NativeFlow, data: ProviderResponse): NativeFlow {
    if(!validContinuation(data.continuation_token))throw new NativeAuthError('unavailable');
    return {...flow,continuation:data.continuation_token};
  }
  function code(flow: NativeFlow, data: ProviderResponse, mfa=false): NativeResult {
    check(data,flow);
    if(data.challenge_type!=='oob')throw new NativeAuthError('unsupported_method');
    const updated=continued(flow,data);updated.step=mfa?'mfa-code':'code';
    updated.codeLength=Number.isInteger(data.code_length)&&Number(data.code_length)>=4&&Number(data.code_length)<=16?Number(data.code_length):8;
    updated.target=typeof data.challenge_target_label==='string'?data.challenge_target_label.slice(0,160):undefined;
    return {step:updated.step,flow:updated};
  }
  async function tokens(flow: NativeFlow, fields: Record<string,string>): Promise<NativeResult> {
    const scope = flow.mode === 'reset' ? 'openid profile' : 'openid profile email offline_access';
    const data=await callForFlow(flow,'oauth2/v2.0/token',{continuation_token:flow.continuation,scope,...fields});
    if(data.suberror==='mfa_required'||data.error==='mfa_required') {
      const next=continued(flow,data);
      if (flow.mode==='reset') {next.step='poll';next.recoveryProof={stage:'methods'};}
      return selectMfaMethod(next);
    }
    check(data,flow);
    if(typeof data.id_token!=='string'||!data.id_token||data.id_token.length>32768 || (data.refresh_token!==undefined&&typeof data.refresh_token!=='string'))throw new NativeAuthError('unavailable');
    if (flow.mode === 'reset') return {step:'reset-complete', flow, idToken:data.id_token};
    return {step:'complete',flow,tokens:{idToken:data.id_token,refreshToken:data.refresh_token as string|undefined}};
  }
  async function selectMfaMethod(flow:NativeFlow):Promise<NativeResult> {
    const registered=check(await callForFlow(flow,'oauth2/v2.0/introspect',{continuation_token:flow.continuation}),flow);
    const methods=Array.isArray(registered.methods)?registered.methods:[];
    const method=methods.find(value=>value&&typeof value==='object'&&value.challenge_type==='oob'&&value.challenge_channel==='email'&&typeof value.id==='string'&&value.id.length>0&&value.id.length<=256);
    if(!method)throw new NativeAuthError('unsupported_method');
    const selected=continued(flow,registered);
    if (flow.mode==='reset') selected.recoveryProof={stage:'challenge',methodId:method.id};
    return challengeMfaMethod(selected,method.id);
  }
  async function challengeMfaMethod(flow:NativeFlow,methodId:string):Promise<NativeResult> {
    const data=await callForFlow(flow,'oauth2/v2.0/challenge',{continuation_token:flow.continuation,challenge_type:'oob redirect',id:methodId});
    const challenged=code(flow,data,true);
    if (flow.mode==='reset') challenged.flow.recoveryProof={stage:'mfa'};
    return challenged;
  }
  function exchangeRecoveryGrant(flow:NativeFlow) {
    return tokens(flow,{grant_type:'continuation_token',username:flow.email});
  }
  return {
    async start(mode: NativeMode, input: NativeInput): Promise<NativeResult> {
      const flow: NativeFlow={mode,step:'code',email:input.email,next:input.next,expiresAt:Date.now()+600000,continuation:'',...(input.displayName?{displayName:input.displayName}:{})};
      if(mode==='login') {
        const initiated=check(await call('oauth2/v2.0/initiate',{username:input.email,challenge_type:'password oob redirect',capabilities:'mfa_required'}),flow);
        const started=continued(flow,initiated);
        const selected=check(await call('oauth2/v2.0/challenge',{continuation_token:started.continuation,challenge_type:'password oob redirect'}),started);
        const challenged=continued(started,selected);
        if(selected.challenge_type==='password')return tokens({...challenged,step:'new-password'},{grant_type:'password',password:input.password??''});
        return code(challenged,selected);
      }
      const path=mode==='signup'?'signup/v1.0':'resetpassword/v1.0';
      // Full name belongs to the bound application flow; the hosted Google flow
      // no longer selects Display Name as a provider-collected attribute.
      const data=await call(`${path}/start`,{username:input.email,challenge_type:'oob password redirect',...(mode==='signup'?{password:input.password??''}:{})});
      // Password recovery must not disclose whether a customer exists.
      if(mode==='reset'&&['user_not_found','invalid_grant'].includes(String(data.error)))return {step:'code',flow:{...flow,continuation:'unavailable',decoy:true,codeLength:8}};
      const started=continued(flow,check(data));
      return code(started,await call(`${path}/challenge`,{continuation_token:started.continuation,challenge_type:'oob redirect'}));
    },
    async advance(flow: NativeFlow, input: {code?: string; password?: string}): Promise<NativeResult> {
      if(flow.expiresAt<=Date.now())throw new NativeAuthError('expired');
      if(flow.decoy)throw new NativeAuthError('invalid_code',flow);
      if (flow.mode === 'reset' && flow.step !== 'code' && flow.verifiedEmail !== true) throw new NativeAuthError('expired');
      if (flow.mode==='reset' && (flow.pollNotBefore??0)>Date.now()) throw new NativeAuthError(flow.step==='poll'?'wait':'rate_limited',flow);
      if(flow.step==='poll') {
        if (flow.mode !== 'reset') throw new NativeAuthError('expired');
        if (flow.recoveryProof?.stage === 'verify') return {step:'reset-complete', flow, idToken:flow.recoveryProof.idToken};
        if (flow.recoveryProof?.stage === 'exchange') return exchangeRecoveryGrant(flow);
        if (flow.recoveryProof?.stage === 'methods') return selectMfaMethod(flow);
        if (flow.recoveryProof?.stage === 'challenge') return challengeMfaMethod(flow,flow.recoveryProof.methodId);
        const data=check(await callForFlow(flow,'resetpassword/v1.0/poll_completion',{continuation_token:flow.continuation}),flow);
        if (data.status === 'succeeded') {
          // Entra binds the successor from a successful poll to this password
          // reset. Only its signed token can identify the account to revoke.
          return exchangeRecoveryGrant({...continued(flow,data), recoveryProof:{stage:'exchange'}});
        }
        if(!['not_started','inProgress','in_progress','inprogress'].includes(String(data.status)))throw new NativeAuthError('request_failed');
        return {step:'poll',flow:{...continued(flow,data),pollNotBefore:Date.now()+5000}};
      }
      if(flow.step==='mfa-code') {
        if (flow.mode === 'reset' && flow.recoveryProof?.stage !== 'mfa') throw new NativeAuthError('expired');
        return tokens(flow,{grant_type:'mfa_oob',oob:input.code??''});
      }
      if(flow.mode==='login')return tokens(flow,{grant_type:'oob',oob:input.code??''});
      if(flow.mode==='signup') {
        const data=await call('signup/v1.0/continue',{continuation_token:flow.continuation,grant_type:flow.step==='new-password'?'password':'oob',...(flow.step==='new-password'?{password:input.password??''}:{oob:input.code??''})});
        const verified={...flow,verifiedEmail:flow.verifiedEmail||flow.step==='code'};
        if(data.error==='password_required')return {step:'new-password',flow:{...continued(verified,data),step:'new-password'}};
        const complete=continued(verified,check(data,flow));
        return tokens(complete,{grant_type:'continuation_token',username:flow.email});
      }
      if(flow.step==='code') {
        const data=check(await callForFlow(flow,'resetpassword/v1.0/continue',{continuation_token:flow.continuation,grant_type:'oob',oob:input.code??''}),flow);
        return {step:'new-password',flow:{...continued(flow,data),step:'new-password',verifiedEmail:true}};
      }
      const data=check(await callForFlow(flow,'resetpassword/v1.0/submit',{continuation_token:flow.continuation,new_password:input.password??''}),flow);
      const interval=typeof data.poll_interval==='number'&&data.poll_interval>0?Math.min(60,Math.max(5,data.poll_interval)):5;
      return {step:'poll',flow:{...continued(flow,data),step:'poll',pollNotBefore:Date.now()+interval*1000}};
    },
  };
}
