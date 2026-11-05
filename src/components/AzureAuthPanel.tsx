'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui/classic';
import { useAuthPopup } from '@/lib/identity/use-auth-popup';
import { navigateAfterAuth } from '@/lib/post-auth-navigation';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { routes } from '@/lib/routes';

type FlowView={step:'code'|'mfa-code'|'new-password'|'poll';flowId:string;attemptId:string;codeLength?:number;target?:string;retryAfterSeconds?:number};
const handle=/^[A-Za-z0-9_-]{43}$/;

/** Credentials stay on Academy. Only explicitly selected social providers open a popup. */
export function AzureAuthPanel({mode,bench=false}:{mode:'login'|'signup'|'recovery';bench?:boolean}) {
  const locale=useLocale(),english=locale==='en',t=useTranslations('auth');
  const params=useSearchParams(),next=safeInternalPath(params.get('next'));
  const popup=useAuthPopup(next,english);
  const recovery=mode==='recovery';
  const [flow,setFlow]=useState<FlowView|null>(null);
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState<string|null>(params.get('error')?t('providerError'):null);
  const serial=useRef(0),emailRef=useRef<HTMLInputElement>(null),passwordRef=useRef<HTMLInputElement>(null),codeRef=useRef<HTMLInputElement>(null);
  const errorMessage=useCallback((code:unknown)=>{
    if(code==='invalid_credentials')return t('invalidCredentials');
    if(code==='password_policy')return english?'Use a stronger password with at least 8 characters.':'Dùng mật khẩu mạnh hơn, có ít nhất 8 ký tự.';
    if(code==='invalid_code')return english?'That verification code is incorrect. Please try again.':'Mã xác minh không đúng. Vui lòng thử lại.';
    if(code==='expired')return english?'This verification has expired. Please start again.':'Phiên xác minh đã hết hạn. Vui lòng bắt đầu lại.';
    if(code==='rate_limited')return english?'Too many attempts. Please wait a minute and try again.':'Bạn đã thử quá nhiều lần. Vui lòng chờ một phút rồi thử lại.';
    if(code==='unsupported_method')return english?'This account requires a verification method that is not available on this form.':'Tài khoản yêu cầu phương thức xác minh chưa được hỗ trợ trên biểu mẫu này.';
    return t('genericError');
  },[english,t]);
  const send=useCallback(async(payload:Record<string,unknown>)=>{
    const current=++serial.current;setBusy(true);setError(null);
    try {
      const response=await fetch('/api/v1/public/auth/native',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)});
      const data=await response.json() as Record<string,unknown>;
      if(current!==serial.current)return;
      const hasFlow=typeof data.flowId==='string'&&handle.test(data.flowId)&&typeof data.attemptId==='string'&&handle.test(data.attemptId)&&['code','mfa-code','new-password','poll'].includes(String(data.step));
      if(hasFlow)setFlow({step:data.step as FlowView['step'],flowId:data.flowId as string,attemptId:data.attemptId as string,codeLength:typeof data.codeLength==='number'?data.codeLength:8,target:typeof data.target==='string'?data.target:undefined,retryAfterSeconds:typeof data.retryAfterSeconds==='number'?data.retryAfterSeconds:5});
      if(!response.ok||data.error) {
        if(data.error==='expired')setFlow(null);
        setError(errorMessage(data.error));return;
      }
      if(data.step==='complete'&&typeof data.next==='string') {
        const destination=new URL(data.next,window.location.origin);
        const target=destination.origin===window.location.origin&&destination.pathname==='/welcome'
          ? routes.auth.welcome({next:safeInternalPath(destination.searchParams.get('next'))}) : safeInternalPath(data.next);
        navigateAfterAuth(target);return;
      }
      if(data.step==='reset-complete'){setFlow(null);setDone(true);return;}
      if(!hasFlow)throw new Error('Invalid authentication response');
    } catch {
      if(current===serial.current)setError(t('genericError'));
    } finally {
      if(current===serial.current)setBusy(false);
    }
  },[errorMessage,t]);
  useEffect(()=>{
    if(flow?.step!=='poll'||busy)return;
    const timer=window.setTimeout(()=>void send({action:'continue',flowId:flow.flowId,attemptId:flow.attemptId}),Math.max(5,flow.retryAfterSeconds??5)*1000);
    return ()=>window.clearTimeout(timer);
  },[flow,busy,send]);
  useEffect(()=>{if(flow?.step==='code'||flow?.step==='mfa-code')codeRef.current?.focus();else if(flow?.step==='new-password')passwordRef.current?.focus();},[flow?.step]);
  useEffect(()=>()=>{serial.current++;},[]);
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(busy||popup.busy)return;
    if(popup.phase)popup.cancel();
    const data=new FormData(event.currentTarget),password=String(data.get('password')??'');
    setError(null);
    if(flow) {
      if(flow.step==='new-password') {
        if(password.length<8||password.length>256){setError(errorMessage('password_policy'));return;}
        if(password!==String(data.get('confirmPassword')??'')){setError(t('passwordMismatch'));return;}
        void send({action:'continue',flowId:flow.flowId,attemptId:flow.attemptId,password});
      } else {
        const code=String(data.get('code')??'').trim();
        if(!/^\d{4,16}$/.test(code)){setError(errorMessage('invalid_code'));return;}
        void send({action:'continue',flowId:flow.flowId,attemptId:flow.attemptId,code});
      }
      return;
    }
    const normalizedEmail=email.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)||normalizedEmail.length>320){setError(t('invalidEmail'));emailRef.current?.focus();return;}
    if(!recovery) {
      if(!password||password.length>256||(mode==='signup'&&password.length<8)){setError(errorMessage('password_policy'));passwordRef.current?.focus();return;}
      if(mode==='signup'&&password!==String(data.get('confirmPassword')??'')){setError(t('passwordMismatch'));return;}
    }
    setEmail(normalizedEmail);
    void send({action:'start',mode:recovery?'reset':mode,email:normalizedEmail,...(!recovery?{password}:{}),next});
  };
  const startAgain=()=>{serial.current++;setFlow(null);setError(null);setBusy(false);};
  const blocked=busy||popup.busy;
  const codeStep=flow?.step==='code'||flow?.step==='mfa-code';
  const passwordStep=flow?.step==='new-password'||(!flow&&!recovery&&!done);
  const title=done?(english?'Password updated':'Đã cập nhật mật khẩu'):codeStep?(english?'Verify your email':'Xác minh email'):flow?.step==='new-password'?t('newPasswordTitle'):t(recovery?'resetTitle':mode==='signup'?'signupTitle':'loginTitle');
  const submitLabel=busy?(english?'Please wait…':'Vui lòng chờ…'):flow?.step==='new-password'?t('updatePassword'):codeStep?(english?'Verify code':'Xác minh mã'):recovery?(english?'Send verification code':'Gửi mã xác minh'):t(mode==='signup'?'createAccount':'signIn');
  return <section aria-labelledby="azure-auth-title" className={bench?'vf-auth-form':'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
    <h1 id="azure-auth-title" className={bench?'vf-title-sm':'text-2xl font-semibold'}>{title}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{done?(english?'Your password has been updated. You can now sign in.':'Mật khẩu đã được cập nhật. Bạn có thể đăng nhập ngay.'):codeStep?(english?`Enter the code sent to ${flow?.target||email}.`:`Nhập mã được gửi tới ${flow?.target||email}.`):recovery?(english?'Enter your email to verify it and choose a new password here.':'Nhập email để xác minh và đặt mật khẩu mới tại đây.'):t(mode==='signup'?'signupDescription':'loginDescription')}</p>
    {!recovery&&!flow&&!done?<>
      <div className="mt-6 space-y-3">
        <Button type="button" className="min-h-11 w-full" disabled={blocked} onClick={()=>popup.open(`/auth/login?${new URLSearchParams({provider:'google',mode,next})}`)}>{t('continueGoogle')}</Button>
        <Button type="button" className="min-h-11 w-full bg-secondary text-secondary-foreground hover:bg-secondary/80" disabled={blocked} onClick={()=>popup.open(`/auth/login?${new URLSearchParams({provider:'microsoft',mode,next})}`)}>{english?'Microsoft (internal staff)':'Microsoft (nhân sự nội bộ)'}</Button>
      </div>
      <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border"/><span className="text-xs text-muted-foreground">{t('or')}</span><span className="h-px flex-1 bg-border"/></div>
    </>:null}
    {popup.phase?<div className="my-3"><p role="status">{popup.status}</p>{popup.error?<p role="alert">{popup.error}</p>:null}<button type="button" className="min-h-11 underline underline-offset-4" onClick={popup.cancel}>{english?'Cancel sign-in':'Hủy đăng nhập'}</button></div>:null}
    {flow?.step==='poll'?<p role="status" aria-live="polite" className="mt-5">{english?'Updating your password…':'Đang cập nhật mật khẩu…'}</p>:null}
    {!done&&flow?.step!=='poll'?<form method="post" action="/api/v1/public/auth/native" onSubmit={submit} noValidate className="mt-6 space-y-4" aria-busy={busy} aria-describedby={error?'native-auth-error':undefined}>
      {!flow?<div className="space-y-1.5"><label htmlFor="auth-email" className="text-sm font-medium">{t('email')}</label><Input ref={emailRef} id="auth-email" name="email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={event=>setEmail(event.target.value)} disabled={blocked}/></div>:null}
      {codeStep?<div className="space-y-1.5"><label htmlFor="auth-code" className="text-sm font-medium">{english?'Verification code':'Mã xác minh'}</label><Input ref={codeRef} id="auth-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={16} disabled={blocked}/></div>:null}
      {passwordStep?<div className="space-y-1.5"><label htmlFor="auth-password" className="text-sm font-medium">{flow?t('newPassword'):t('password')}</label><Input ref={passwordRef} id="auth-password" name="password" type="password" autoComplete={mode==='login'&&!flow?'current-password':'new-password'} required maxLength={256} disabled={blocked}/></div>:null}
      {(flow?.step==='new-password'||(!flow&&mode==='signup'))?<div className="space-y-1.5"><label htmlFor="auth-confirm-password" className="text-sm font-medium">{t('confirmPassword')}</label><Input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required maxLength={256} disabled={blocked}/></div>:null}
      <Button type="submit" className="min-h-11 w-full" disabled={blocked}>{submitLabel}</Button>
    </form>:null}
    {error?<p id="native-auth-error" role="alert" aria-live="assertive" className="mt-4 text-sm text-destructive">{error}</p>:null}
    {flow?<button type="button" className="mt-3 min-h-11 underline underline-offset-4" disabled={busy} onClick={startAgain}>{english?'Start again':'Bắt đầu lại'}</button>:null}
    {!flow&&!done&&mode==='login'?<p className="mt-4 text-center text-sm"><Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="/forgot-password">{t('forgotPassword')}</Link></p>:null}
    <p className="mt-4 text-center text-sm text-muted-foreground">{recovery?<Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={routes.auth.login({next})}>{t('backToLogin')}</Link>:<>{t(mode==='login'?'needAccount':'haveAccount')} <Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={mode==='login'?routes.auth.signup({next}):routes.auth.login({next})}>{t(mode==='login'?'openSignup':'openLogin')}</Link></>}</p>
    {!bench?<p className="mt-4 text-center text-xs leading-6 text-muted-foreground"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={english?'/privacy?lang=en':'/privacy'}>{english?'Privacy notice':'Quyền riêng tư'}</Link><span aria-hidden="true"> · </span><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={english?'/terms?lang=en':'/terms'}>{english?'Terms of use':'Điều khoản sử dụng'}</Link></p>:null}
  </section>;
}
