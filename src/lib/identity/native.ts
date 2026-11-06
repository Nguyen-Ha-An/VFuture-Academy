import 'server-only';
import type { IdentityConfiguration } from './oidc';

export type NativeMode = 'login' | 'signup' | 'reset';
export type NativeStep = 'code' | 'mfa-code' | 'new-password' | 'poll';
export type NativeFlow = {
  mode: NativeMode; step: NativeStep; continuation: string; email: string;
  next: string; expiresAt: number; verifiedEmail?: boolean; displayName?: string;
  codeLength?: number; target?: string; pollNotBefore?: number; decoy?: boolean;
};
export type NativeInput = { email: string; password?: string; displayName?: string; next: string };
export type NativeResult = { step: NativeStep | 'reset-complete'; flow: NativeFlow }
  | { step: 'complete'; flow: NativeFlow; tokens: { idToken: string; refreshToken?: string } };
export type NativeErrorCode = 'invalid_credentials' | 'invalid_code' | 'password_policy' | 'expired' | 'unsupported_method' | 'rate_limited' | 'unavailable' | 'request_failed' | 'wait';
export class NativeAuthError extends Error {
  constructor(public code: NativeErrorCode, public flow?: NativeFlow) { super(code); this.name='NativeAuthError'; }
}
type ProviderResponse = Record<string, unknown>;

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
    catch { throw new NativeAuthError('unavailable'); }
    if(response.status===429)throw new NativeAuthError('rate_limited');
    if(response.status>=500)throw new NativeAuthError('unavailable');
    const text=await response.text(); if(text.length>262144)throw new NativeAuthError('unavailable');
    let data: ProviderResponse;
    try { data=JSON.parse(text); } catch { throw new NativeAuthError('unavailable'); }
    if(!data || typeof data!=='object' || Array.isArray(data))throw new NativeAuthError('unavailable');
    if(data.challenge_type==='redirect')throw new NativeAuthError('unsupported_method');
    if(!response.ok && typeof data.error!=='string')throw new NativeAuthError('unavailable');
    return data;
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
    if(typeof data.continuation_token!=='string'||!data.continuation_token||data.continuation_token.length>65536)throw new NativeAuthError('unavailable');
    return {...flow,continuation:data.continuation_token};
  }
  function code(flow: NativeFlow, data: ProviderResponse, mfa=false): NativeResult {
    check(data,flow);
    if(data.challenge_type!=='oob')throw new NativeAuthError('unsupported_method');
    const updated=continued(flow,data);updated.step=mfa?'mfa-code':'code';
    updated.codeLength=Number.isInteger(data.code_length)&&Number(data.code_length)>=4&&Number(data.code_length)<=16?Number(data.code_length):8;
    if(typeof data.challenge_target_label==='string')updated.target=data.challenge_target_label.slice(0,160);
    return {step:updated.step,flow:updated};
  }
  async function tokens(flow: NativeFlow, fields: Record<string,string>): Promise<NativeResult> {
    const data=await call('oauth2/v2.0/token',{continuation_token:flow.continuation,scope:'openid profile email offline_access',...fields});
    if(data.suberror==='mfa_required'||data.error==='mfa_required') {
      const next=continued(flow,data);
      const registered=check(await call('oauth2/v2.0/introspect',{continuation_token:next.continuation}),next);
      const methods=Array.isArray(registered.methods)?registered.methods:[];
      const method=methods.find(value=>value&&typeof value==='object'&&value.challenge_type==='oob'&&value.challenge_channel==='email'&&typeof value.id==='string'&&value.id.length<=256);
      if(!method)throw new NativeAuthError('unsupported_method');
      const selected=continued(next,registered);
      return code(selected,await call('oauth2/v2.0/challenge',{continuation_token:selected.continuation,challenge_type:'oob redirect',id:method.id}),true);
    }
    check(data,flow);
    if(typeof data.id_token!=='string'||data.id_token.length>32768 || (data.refresh_token!==undefined&&typeof data.refresh_token!=='string'))throw new NativeAuthError('unavailable');
    return {step:'complete',flow,tokens:{idToken:data.id_token,refreshToken:data.refresh_token as string|undefined}};
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
      if(flow.step==='poll') {
        if((flow.pollNotBefore??0)>Date.now())throw new NativeAuthError('wait',flow);
        const data=check(await call('resetpassword/v1.0/poll_completion',{continuation_token:flow.continuation}),flow);
        if(data.status==='succeeded')return {step:'reset-complete',flow};
        if(!['not_started','inProgress','in_progress','inprogress'].includes(String(data.status)))throw new NativeAuthError('request_failed');
        return {step:'poll',flow:{...continued(flow,data),pollNotBefore:Date.now()+5000}};
      }
      if(flow.step==='mfa-code')return tokens(flow,{grant_type:'mfa_oob',oob:input.code??''});
      if(flow.mode==='login')return tokens(flow,{grant_type:'oob',oob:input.code??''});
      if(flow.mode==='signup') {
        const data=await call('signup/v1.0/continue',{continuation_token:flow.continuation,grant_type:flow.step==='new-password'?'password':'oob',...(flow.step==='new-password'?{password:input.password??''}:{oob:input.code??''})});
        const verified={...flow,verifiedEmail:flow.verifiedEmail||flow.step==='code'};
        if(data.error==='password_required')return {step:'new-password',flow:{...continued(verified,data),step:'new-password'}};
        const complete=continued(verified,check(data,flow));
        return tokens(complete,{grant_type:'continuation_token',username:flow.email});
      }
      if(flow.step==='code') {
        const data=check(await call('resetpassword/v1.0/continue',{continuation_token:flow.continuation,grant_type:'oob',oob:input.code??''}),flow);
        return {step:'new-password',flow:{...continued(flow,data),step:'new-password',verifiedEmail:true}};
      }
      const data=check(await call('resetpassword/v1.0/submit',{continuation_token:flow.continuation,new_password:input.password??''}),flow);
      const interval=typeof data.poll_interval==='number'&&data.poll_interval>0?Math.min(60,Math.max(5,data.poll_interval)):5;
      return {step:'poll',flow:{...continued(flow,data),step:'poll',pollNotBefore:Date.now()+interval*1000}};
    },
  };
}
