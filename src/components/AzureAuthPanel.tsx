'use client';
import { useAuthPopup } from '@/lib/identity/use-auth-popup';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { safeInternalPath } from '@/lib/safe-internal-path';

/** Google is the public entry point. Microsoft uses a separate internal staff flow. */
export function AzureAuthPanel({ mode, bench = false }: { mode: 'login' | 'signup' | 'recovery'; bench?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('auth');
  const params = useSearchParams();
  const english = locale === 'en';
  const next = safeInternalPath(params.get('next'));
  const popup = useAuthPopup(next, english);
  const recovery = mode === 'recovery';
  const href = (provider: string) => `/auth/login?${new URLSearchParams({ provider, mode, next })}`;
  const linkBase = 'inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 py-3 text-center font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const button = `${linkBase} border-border bg-secondary text-secondary-foreground hover:bg-secondary/80`;
  const primaryButton = `${linkBase} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
  return <section aria-labelledby="azure-auth-title" className={bench ? 'vf-auth-form' : 'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
    <h1 id="azure-auth-title" className={bench ? 'vf-title-sm' : 'text-2xl font-semibold'}>{t(recovery ? 'resetTitle' : mode === 'signup' ? 'signupTitle' : 'loginTitle')}</h1>
    <p className="mt-3 text-sm text-muted-foreground">{recovery
      ? english ? 'On the secure sign-in page, choose “Forgot your password?” and follow the email verification steps. Previously registered accounts may need to reset their password the first time.' : 'Trên trang đăng nhập bảo mật, chọn “Quên mật khẩu?” và làm theo bước xác minh email. Tài khoản đã đăng ký trước đây có thể cần đặt lại mật khẩu lần đầu.'
      : english ? 'Use your Google account to sign in or join Academy. Internal staff can also use Microsoft.' : 'Dùng tài khoản Google để đăng nhập hoặc tham gia Academy. Nhân sự nội bộ cũng có thể dùng Microsoft.'}</p>
    {params.get('error') ? <p role="alert" className="mt-3 text-sm text-destructive">{t('providerError')}</p> : null}
    <div className="mt-6 space-y-3">
      {recovery ? <button type="button" disabled={popup.busy} className={button} onClick={() => popup.open(href('password'))}>{english ? 'Continue to password recovery' : 'Tiếp tục khôi phục mật khẩu'}</button> : <>
        <button type="button" disabled={popup.busy} className={primaryButton} onClick={() => popup.open(href('google'))}>{t('continueGoogle')}</button>
        <button type="button" disabled={popup.busy} className={button} onClick={() => popup.open(href('microsoft'))}>{english ? 'Microsoft (internal staff)' : 'Microsoft (nhân sự nội bộ)'}</button>
        <button type="button" disabled={popup.busy} className="inline-flex min-h-11 w-full items-center justify-center text-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => popup.open(href('password'))}>{english ? 'Email and password (backup)' : 'Email và mật khẩu (dự phòng)'}</button>
      </>}
    </div>
    {popup.status ? <p role="status" aria-live="polite" className="mt-4 text-sm">{popup.status}</p> : null}
    {popup.error ? <p role="alert" className="mt-4 text-sm text-destructive">{popup.error}</p> : null}
    {popup.phase ? <button type="button" className="mt-2 min-h-11 underline underline-offset-4" onClick={popup.cancel}>{english ? 'Cancel sign-in' : 'Hủy đăng nhập'}</button> : null}
    <p className="mt-6 text-center text-sm"><Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={recovery ? '/login' : '/forgot-password'}>{t(recovery ? 'backToLogin' : 'forgotPassword')}</Link></p>
  </section>;
}
