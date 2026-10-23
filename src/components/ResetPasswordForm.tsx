'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';
import { Button, Input } from '@/components/ui/classic';
import { PendingSubmit } from '@/features/workspace-ui/auth/PendingSubmit';
import { Kicker } from '@/features/workspace-ui/ui/primitives';
import { navigateAfterAuth } from '@/lib/post-auth-navigation';
import { routes } from '@/lib/routes';
import { supabaseBrowser } from '@/lib/supabase/client';

const passwordSchema = z.object({ password: z.string().min(8) });

/** `bench` renders the Calibration Bench visuals (spec 4.1); without it the legacy markup is unchanged. */
export function ResetPasswordForm({ bench = false }: { bench?: boolean } = {}) {
  const t = useTranslations('auth');
  const tb = useTranslations('bench.auth');
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const updatePassword = async (formData: FormData) => {
    if (submitting) return;
    setServerError(null);
    setFieldErrors({});
    setLinkInvalid(false);
    const password = formData.get('password');
    const confirm = formData.get('confirm');
    const parsed = passwordSchema.safeParse({ password });
    if (!parsed.success) {
      setFieldErrors({ password: t('invalidPassword') });
      passwordRef.current?.focus();
      return;
    }
    if (parsed.data.password !== confirm) {
      setFieldErrors({ confirm: t('passwordMismatch') });
      confirmRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password: parsed.data.password });
      if (error) {
        // A missing session means the one-time recovery grant was consumed or expired.
        if (isAuthSessionMissingError(error)) setLinkInvalid(true);
        else setServerError(t('passwordUpdateError'));
        return;
      }
      navigateAfterAuth(routes.learner.dashboard());
    } catch {
      setServerError(t('passwordUpdateError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="new-password-title" className={bench ? 'vf-auth-form' : 'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
      {bench ? <Kicker>{tb('kicker.reset')}</Kicker> : null}
      <h1 id="new-password-title" className={bench ? 'vf-title-sm' : 'text-2xl font-semibold'}>{t('newPasswordTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('newPasswordDescription')}</p>
      <form action={updatePassword} noValidate className="mt-6 space-y-4">
        <div className="space-y-1.5"><label htmlFor="new-password" className="text-sm font-medium">{t('newPassword')}</label><Input ref={passwordRef} id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'new-password-error' : undefined} aria-errormessage={fieldErrors.password ? 'new-password-error' : undefined} />{fieldErrors.password ? <p id="new-password-error" role="alert" className="text-sm text-destructive">{fieldErrors.password}</p> : null}</div>
        <div className="space-y-1.5"><label htmlFor="confirm-password" className="text-sm font-medium">{t('confirmPassword')}</label><Input ref={confirmRef} id="confirm-password" name="confirm" type="password" autoComplete="new-password" required minLength={8} aria-invalid={Boolean(fieldErrors.confirm)} aria-describedby={fieldErrors.confirm ? 'confirm-password-error' : undefined} aria-errormessage={fieldErrors.confirm ? 'confirm-password-error' : undefined} />{fieldErrors.confirm ? <p id="confirm-password-error" role="alert" className="text-sm text-destructive">{fieldErrors.confirm}</p> : null}</div>
        {serverError ? <p aria-live="assertive" role="alert" className="text-sm text-destructive">{serverError}</p> : null}
        {linkInvalid ? <p aria-live="assertive" role="alert" className="text-sm text-destructive">{t('resetLinkInvalid')}</p> : null}
        {bench
          ? <PendingSubmit className="min-h-11 w-full" disabled={submitting} label={t('updatePassword')} pendingLabel={tb('pending.updatePassword')} />
          : <Button type="submit" className="min-h-11 w-full" disabled={submitting}>{t('updatePassword')}</Button>}
      </form>
      {linkInvalid ? <p className="mt-6 text-center text-sm text-muted-foreground"><Link href={routes.auth.forgotPassword()} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('requestNewResetLink')}</Link></p> : null}
    </section>
  );
}
