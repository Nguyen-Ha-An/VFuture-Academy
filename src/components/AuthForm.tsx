'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Button, Input } from '@/components/ui/classic';
import { PendingSubmit } from '@/features/workspace-ui/auth/PendingSubmit';
import { Kicker } from '@/features/workspace-ui/ui/primitives';
import { navigateAfterAuth } from '@/lib/post-auth-navigation';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { supabaseBrowser } from '@/lib/supabase/client';

const credentialsSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8) });
const emailSchema = credentialsSchema.pick({ email: true });

export const LOGIN_COOLDOWN_MS = 3000;

const PROFILE_STATE_PATH = '/api/v1/auth/profile-state';
/** A bounded wait so a hung profile read ends in the retryable profile error, not a stuck form. */
export const PROFILE_STATE_TIMEOUT_MS = 15_000;

/** `bench` renders the Calibration Bench visuals (spec 4.1); without it the legacy markup is unchanged. */
type AuthFormProps = { mode: 'login' | 'signup'; bench?: boolean };

function callbackUrl(next: string) {
  const url = new URL(routes.auth.callback(), window.location.origin);
  url.searchParams.set('next', next);
  return url.toString();
}

/**
 * Asks the server for the caller's onboarding state through the authenticated
 * same-origin endpoint. Any failure (status, body, abort, network) is "unavailable".
 */
async function readProfileState(): Promise<'complete' | 'incomplete' | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROFILE_STATE_TIMEOUT_MS);
  try {
    const response = await fetch(PROFILE_STATE_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const data = typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : null;
    const state = typeof data === 'object' && data !== null && 'state' in data ? data.state : null;
    return state === 'complete' || state === 'incomplete' ? state : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function postAuthDestination(next: string) {
  const state = await readProfileState();
  if (state === 'complete') return next;
  if (state === 'incomplete') return routes.auth.welcome({ next });
  return null;
}

export function AuthForm({ mode, bench = false }: AuthFormProps) {
  const t = useTranslations('auth');
  const tb = useTranslations('bench.auth');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get('next'));
  const callbackReason = searchParams.get('error');
  const initialCallbackError = callbackReason === 'cancelled'
    ? t('providerCancelled')
    : callbackReason === 'expired'
      ? t('confirmationExpired')
      : callbackReason === 'profile'
        ? t('profileLoadError')
        : callbackReason === 'provider' || callbackReason === 'session' || callbackReason === 'auth'
          ? t('providerError')
          : null;
  const emailRef = useRef<HTMLInputElement>(null);

  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(initialCallbackError);
  const [status, setStatus] = useState<string | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitCredentials = async (formData: FormData) => {
    if (submitting || coolingDown) return;
    setServerError(null);
    setFieldErrors({});
    setStatus(null);
    const parsed = credentialsSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
    if (!parsed.success) {
      const errors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') errors.email ??= t('invalidEmail');
        if (issue.path[0] === 'password') errors.password ??= t('invalidPassword');
      }
      setFieldErrors(errors);
      if (errors.email) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    const supabase = supabaseBrowser();
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: callbackUrl(next) },
        });
        if (signUpError) {
          setServerError(t('signupError'));
          return;
        }
        if (data?.session && data.user) {
          const destination = await postAuthDestination(next);
          if (!destination) setServerError(t('profileLoadError'));
          else navigateAfterAuth(destination);
          return;
        }
        setStatus(t('checkEmail'));
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
      if (signInError) {
        setServerError(t('invalidCredentials'));
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setServerError(t('sessionError'));
        return;
      }
      const destination = await postAuthDestination(next);
      if (!destination) setServerError(t('profileLoadError'));
      else navigateAfterAuth(destination);
    } catch {
      setServerError(t('genericError'));
    } finally {
      if (mode === 'login') {
        setCoolingDown(true);
        window.setTimeout(() => setCoolingDown(false), LOGIN_COOLDOWN_MS);
      }
      setSubmitting(false);
    }
  };

  const signInWithProvider = async (provider: 'google' | 'azure') => {
    if (submitting) return;
    setServerError(null);
    setFieldErrors({});
    setStatus(null);
    setSubmitting(true);
    try {
      const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl(next),
          ...(provider === 'azure' ? { scopes: 'email' } : {}),
        },
      });
      if (oauthError) setServerError(t('providerError'));
    } catch {
      setServerError(t('providerError'));
    } finally {
      setSubmitting(false);
    }
  };

  const sendMagicLink = async () => {
    if (submitting || coolingDown) return;
    setServerError(null);
    setFieldErrors({});
    setStatus(null);
    const parsed = emailSchema.safeParse({ email: emailRef.current?.value });
    if (!parsed.success) {
      setFieldErrors({ email: t('invalidEmail') });
      emailRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          emailRedirectTo: callbackUrl(next),
          shouldCreateUser: false,
        },
      });
      if (error) setServerError(t('genericError'));
      else setStatus(t('magicLinkSent'));
    } catch {
      setServerError(t('genericError'));
    } finally {
      setCoolingDown(true);
      window.setTimeout(() => setCoolingDown(false), LOGIN_COOLDOWN_MS);
      setSubmitting(false);
    }
  };

  const title = mode === 'login' ? t('loginTitle') : t('signupTitle');
  const submitLabel = mode === 'login' ? t('signIn') : t('createAccount');
  const alternateHref = mode === 'login' ? routes.auth.signup({ next }) : routes.auth.login({ next });

  return (
    <section aria-labelledby="auth-title" className={bench ? 'vf-auth-form' : 'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
      {bench ? <Kicker>{callbackReason === 'expired' ? tb('kicker.linkExpired') : tb(mode === 'login' ? 'kicker.login' : 'kicker.signup')}</Kicker> : null}
      <h1 id="auth-title" className={bench ? 'vf-title-sm' : 'text-2xl font-semibold'}>{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{mode === 'login' ? t('loginDescription') : t('signupDescription')}</p>
      <div className="mt-6 space-y-3">
        <Button type="button" className="min-h-11 w-full bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => signInWithProvider('google')} disabled={submitting}>{t('continueGoogle')}</Button>
        <Button type="button" className="min-h-11 w-full bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => signInWithProvider('azure')} disabled={submitting}>{t('continueMicrosoft')}</Button>
      </div>
      <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">{t('or')}</span><span className="h-px flex-1 bg-border" /></div>
      <form action={submitCredentials} noValidate className="space-y-4">
        <div className="space-y-1.5"><label htmlFor="auth-email" className="text-sm font-medium">{t('email')}</label><Input ref={emailRef} id="auth-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} aria-errormessage={fieldErrors.email ? 'auth-email-error' : undefined} />{fieldErrors.email ? <p id="auth-email-error" role="alert" className="text-sm text-destructive">{fieldErrors.email}</p> : null}</div>
        <div className="space-y-1.5"><label htmlFor="auth-password" className="text-sm font-medium">{t('password')}</label><Input ref={passwordRef} id="auth-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} aria-errormessage={fieldErrors.password ? 'auth-password-error' : undefined} />{fieldErrors.password ? <p id="auth-password-error" role="alert" className="text-sm text-destructive">{fieldErrors.password}</p> : null}</div>
        {serverError ? <p id="auth-status" aria-live="assertive" role="alert" className="text-sm text-destructive">{serverError}</p> : null}
        {status ? <p aria-live="polite" role="status" className="text-sm text-muted-foreground">{status}</p> : null}
        {bench
          ? <PendingSubmit className="min-h-11 w-full" disabled={submitting || coolingDown} label={submitLabel} pendingLabel={tb(mode === 'login' ? 'pending.signIn' : 'pending.createAccount')} />
          : <Button type="submit" className="min-h-11 w-full" disabled={submitting || coolingDown}>{submitLabel}</Button>}
        {mode === 'login' ? <Button type="button" className="min-h-11 w-full bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={sendMagicLink} disabled={submitting || coolingDown}>{t('emailMagicLink')}</Button> : null}
      </form>
      {mode === 'login' ? <p className="mt-4 text-center text-sm"><Link href={routes.auth.forgotPassword()} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('forgotPassword')}</Link></p> : null}
      <p className="mt-6 text-center text-sm text-muted-foreground">{mode === 'login' ? t('needAccount') : t('haveAccount')} <Link href={alternateHref} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{mode === 'login' ? t('openSignup') : t('openLogin')}</Link></p>
      {bench ? null : <p className="mt-4 text-center text-xs leading-6 text-muted-foreground"><Link href={locale === 'en' ? '/privacy?lang=en' : '/privacy'} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{locale === 'en' ? 'Privacy notice' : 'Quyền riêng tư'}</Link><span aria-hidden="true"> · </span><Link href={locale === 'en' ? '/terms?lang=en' : '/terms'} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{locale === 'en' ? 'Terms of use' : 'Điều khoản sử dụng'}</Link></p>}
    </section>
  );
}
