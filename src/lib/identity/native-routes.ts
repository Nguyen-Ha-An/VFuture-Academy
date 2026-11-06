import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAzureDataClient } from '@/lib/database/azure-client';
import { enforceRequestRateLimit } from '@/lib/rate-limit';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { academyBackend } from './provider';
import { identityDisplayName } from './display-name';
import { createNativeClient, NativeAuthError, type NativeFlow, type NativeResult } from './native';
import { decryptRefreshToken, encryptRefreshToken, getOidcMetadata, getSigningKeys, hashToken, randomToken, readIdentityConfiguration, verifyIdToken, NATIVE_REFRESH_PREFIX, type IdentityConfiguration } from './oidc';
import { consumeIdentityTransaction, createStoredSession, initializeIdentityProfile, resolveIdentityUser, storeIdentityTransaction } from './store';
import { SESSION_COOKIE, revokeAzureSession, sessionCookieOptions } from './server';

export const NATIVE_COOKIE=process.env.NODE_ENV==='production'?'__Host-academy_native':'academy_native';
const handlePattern=/^[A-Za-z0-9_-]{43}$/;
const password=z.string().min(1).max(256);
const inputSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('start'),mode:z.enum(['login','signup','reset']),email:z.string().trim().email().max(320),password:password.optional(),displayName:z.string().trim().max(160).optional(),next:z.string().max(2048).optional()}).strict(),
  z.object({action:z.literal('continue'),flowId:z.string().regex(handlePattern),attemptId:z.string().regex(handlePattern),code:z.string().regex(/^\d{4,16}$/).optional(),password:password.optional()}).strict(),
]);
function response(body:Record<string,unknown>,status=200) {
  const r=NextResponse.json(body,{status});r.headers.set('Cache-Control','no-store');r.headers.set('Referrer-Policy','no-referrer');return r;
}
const binding=(handle:string,browser:string,attempt:string)=>hashToken(`academy-native:${attempt}:${handle}:${browser}`);
const proofCookie=(attempt:string)=>`${NATIVE_COOKIE}_${attempt}`;
async function saveFlow(flow:NativeFlow,browser:string,config:IdentityConfiguration,attemptId:string,error?:string,setProofCookie=false) {
  if(flow.expiresAt<=Date.now())return response({error:'expired'},409);
  const handle=randomToken();
  await storeIdentityTransaction(hashToken(handle),hashToken(browser),{kind:'native',attemptId,ciphertext:encryptRefreshToken(JSON.stringify(flow),binding(handle,browser,attemptId),config)});
  const retryAfterSeconds=flow.step==='poll'?Math.max(1,Math.ceil(((flow.pollNotBefore??Date.now())-Date.now())/1000)):undefined;
  const r=response({step:flow.step,flowId:handle,attemptId,codeLength:flow.mode==='reset'?8:flow.codeLength??8,...(flow.target&&flow.mode!=='reset'?{target:flow.target}:{}),...(retryAfterSeconds?{retryAfterSeconds}:{}),...(error?{error}:{})});
  // A continuation response must not overwrite a later attempt's shared cookie.
  if(setProofCookie)r.cookies.set(proofCookie(attemptId),browser,{...sessionCookieOptions,sameSite:'strict',maxAge:600});return r;
}
function validFlow(value:unknown):value is NativeFlow {
  if(!value||typeof value!=='object')return false;
  const f=value as NativeFlow;
  return ['login','signup','reset'].includes(f.mode)&&['code','mfa-code','new-password','poll'].includes(f.step)
    &&typeof f.continuation==='string'&&f.continuation.length>0&&f.continuation.length<=65536
    &&typeof f.email==='string'&&f.email.length<=320&&typeof f.next==='string'&&f.next===safeInternalPath(f.next)
    &&Number.isSafeInteger(f.expiresAt)&&f.expiresAt>Date.now()&&f.expiresAt<=Date.now()+600000;
}
async function complete(result:NativeResult,browser:string,config:IdentityConfiguration,attemptId:string,setProofCookie=false) {
  if(result.step!=='complete') {
    if(result.step==='reset-complete') {
      await revokeAzureSession();
      const r=response({step:'reset-complete'});r.cookies.set(SESSION_COOKIE,'',{...sessionCookieOptions,maxAge:0});r.cookies.set(proofCookie(attemptId),'',{...sessionCookieOptions,sameSite:'strict',maxAge:0});return r;
    }
    return saveFlow(result.flow,browser,config,attemptId,undefined,setProofCookie);
  }
  const metadata=await getOidcMetadata(config);
  const claims=await verifyIdToken(result.tokens.idToken,config,await getSigningKeys(metadata));
  // The server observed a successful signup OTP exchange in this exact,
  // browser-bound continuation chain. It is independent verification evidence,
  // not an assumption about an absent email_verified token claim.
  if(result.flow.mode==='signup'&&result.flow.verifiedEmail) {
    if(typeof claims.email==='string'&&claims.email.toLowerCase()!==result.flow.email.toLowerCase())throw new NativeAuthError('request_failed');
    claims.email=result.flow.email;claims.email_verified=true;
    if(!identityDisplayName(claims)&&result.flow.displayName)claims.name=result.flow.displayName;
  }
  const user=await resolveIdentityUser(claims);
  await initializeIdentityProfile(user.id,claims);
  const session=randomToken(),hash=hashToken(session);
  const expiresAt=Math.floor(Date.now()/1000)+config.sessionMaxAge;
  await createStoredSession(hash,{provider:'external-id',user,issuer:claims.iss,subject:claims.oid,oidcSubject:claims.sub,expiresAt,tokenExpiresAt:claims.exp,refreshCiphertext:result.tokens.refreshToken?encryptRefreshToken(NATIVE_REFRESH_PREFIX+result.tokens.refreshToken,hash,config):null});
  await revokeAzureSession();
  const r=response({step:'complete',next:routes.auth.welcome({next:result.flow.next})});
  r.cookies.set(SESSION_COOKIE,session,{...sessionCookieOptions,maxAge:config.sessionMaxAge});
  r.cookies.set(proofCookie(attemptId),'',{...sessionCookieOptions,sameSite:'strict',maxAge:0});
  return r;
}
/** Same-origin only: credentials and provider tokens never pass through popup completion or browser storage. */
export async function nativeAuthentication(request:Request):Promise<NextResponse> {
  if(academyBackend()!=='azure')return response({error:'not_available'},404);
  let browser:string|undefined,config:IdentityConfiguration|undefined,attemptId:string|undefined,isStart=false;
  let stage='configuration';
  try {
    config=readIdentityConfiguration();
    const origin=new URL(request.url).origin;
    if(origin!==config.appOrigin||request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return response({error:'origin_denied'},403);
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return response({error:'invalid_input'},415);
    if(Number(request.headers.get('content-length')??0)>16384)return response({error:'invalid_input'},413);
    const text=await request.text();if(Buffer.byteLength(text)>16384)return response({error:'invalid_input'},413);
    let body:unknown;try{body=JSON.parse(text);}catch{return response({error:'invalid_input'},400);}
    const parsed=inputSchema.safeParse(body);if(!parsed.success)return response({error:'invalid_input'},400);
    const input=parsed.data;
    if(input.action==='start'&&input.mode!=='reset'&&(!input.password||(input.mode==='signup'&&input.password.length<8)))return response({error:'invalid_input'},400);
    stage='rate-limit';
    await enforceRequestRateLimit(createAzureDataClient('service_role'),'identity-native',request,{limit:20,windowSeconds:60});
    const client=createNativeClient(config);
    if(input.action==='start') {
      browser=randomToken();attemptId=randomToken();isStart=true;
      stage='provider';const result=await client.start(input.mode,{email:input.email,password:input.password,displayName:input.displayName,next:safeInternalPath(input.next)});
      stage='session';return await complete(result,browser,config,attemptId,true);
    }
    stage='state';
    attemptId=input.attemptId;browser=(await cookies()).get(proofCookie(attemptId))?.value;
    if(!browser||!handlePattern.test(browser))return response({error:'expired'},409);
    const stored=await consumeIdentityTransaction(hashToken(input.flowId),hashToken(browser));
    if(stored?.kind!=='native'||stored.attemptId!==attemptId||typeof stored.ciphertext!=='string')return response({error:'expired'},409);
    let flow:unknown;
    try{flow=JSON.parse(decryptRefreshToken(stored.ciphertext,binding(input.flowId,browser,attemptId),config));}catch{return response({error:'expired'},409);}
    if(!validFlow(flow))return response({error:'expired'},409);
    if((flow.step==='code'||flow.step==='mfa-code')&&!input.code)return saveFlow(flow,browser,config,attemptId,'invalid_code');
    if(flow.step==='new-password'&&(!input.password||input.password.length<8))return saveFlow(flow,browser,config,attemptId,'password_policy');
    stage='provider';const result=await client.advance(flow,{code:input.code,password:input.password});
    stage='session';return await complete(result,browser,config,attemptId);
  } catch(error) {
    if(error instanceof NativeAuthError) {
      if(error.code==='unavailable')console.error('academy_native_unavailable',{stage});
      if(error.flow&&browser&&config&&attemptId)return saveFlow(error.flow,browser,config,attemptId,error.code==='wait'?undefined:error.code,isStart);
      const status=error.code==='expired'?409:error.code==='rate_limited'?429:error.code==='unavailable'?503:400;
      return response({error:error.code},status);
    }
    const status=typeof error==='object'&&error!==null&&'status'in error&&error.status===429?429:503;
    if(status===503)console.error('academy_native_unavailable',{stage});
    return response({error:status===429?'rate_limited':'unavailable'},status);
  }
}
