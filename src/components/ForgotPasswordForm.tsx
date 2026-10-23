'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Button, Input } from '@/components/ui/classic';
import { PendingSubmit } from '@/features/workspace-ui/auth/PendingSubmit';
import { Kicker } from '@/features/workspace-ui/ui/primitives';
import { routes } from '@/lib/routes';
import { supabaseBrowser } from '@/lib/supabase/client';

const emailSchema = z.object({ email: z.string().trim().email() });

export const RESET_REQUEST_COOLDOWN_MS = 3000;

/** Absolute recovery destination; Supabase requires an origin it can redirect back to. */
function recoveryUrl() {
  return new URL(routes.auth.recovery(), window.location.origin).toString();
}

/** `bench` renders the Calibration Bench visuals (spec 4.1); without it the legacy markup is unchanged. */
export function ForgotPasswordForm({ bench = false }: { bench?: boolean } = {}) {
  const t = useTranslations('auth');
  const tb = useTranslations('bench.auth');
  const searchParams = useSearchParams();
  const linkExpired = searchParams.get('error') === 'expired';
  const emailRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(linkExpired ? t('resetLinkExpired') : null);
  const [status, setStatus] = useState<string | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const requestResetLink = async (formData: FormData) => {
    if (submitting || coolingDown) return;
    setServerError(null);
    setFieldError(null);
    setStatus(null);
    const parsed = emailSchema.safeParse({ email: formData.get('email') });
    if (!parsed.success) {
      setFieldError(t('invalidEmail'));
      emailRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabaseBrowser().auth.resetPasswordForEmail(parsed.data.email, { redirectTo: recoveryUrl() });
      // A neutral confirmation on success keeps the form from disclosing which addresses have accounts.
      if (error) setServerError(t('genericError'));
      else setStatus(t('resetEmailSent'));
    } catch {
      setServerError(t('genericError'));
    } finally {
      setCoolingDown(true);
      window.setTimeout(() => setCoolingDown(false), RESET_REQUEST_COOLDOWN_MS);
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="reset-title" className={bench ? 'vf-auth-form' : 'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
      {bench ? <Kicker>{tb(linkExpired ? 'kicker.linkExpired' : 'kicker.forgot')}</Kicker> : null}
      <h1 id="reset-title" className={bench ? 'vf-title-sm' : 'text-2xl font-semibold'}>{t('resetTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('resetDescription')}</p>
      <form action={requestResetLink} noValidate className="mt-6 space-y-4">
        <div className="space-y-1.5"><label htmlFor="reset-email" className="text-sm font-medium">{t('email')}</label><Input ref={emailRef} id="reset-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'reset-email-error' : undefined} aria-errormessage={fieldError ? 'reset-email-error' : undefined} />{fieldError ? <p id="reset-email-error" role="alert" className="text-sm text-destructive">{fieldError}</p> : null}</div>
        {serverError ? <p aria-live="assertive" role="alert" className="text-sm text-destructive">{serverError}</p> : null}
        {status ? <p aria-live="polite" role="status" className="text-sm text-muted-foreground">{status}</p> : null}
        {bench
          ? <PendingSubmit className="min-h-11 w-full" disabled={submitting || coolingDown} label={t('sendResetLink')} pendingLabel={tb('pending.sendResetLink')} />
          : <Button type="submit" className="min-h-11 w-full" disabled={submitting || coolingDown}>{t('sendResetLink')}</Button>}
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground"><Link href={routes.auth.login()} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('backToLogin')}</Link></p>
    </section>
  );
}
