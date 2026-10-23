'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui/classic';
import { Kicker } from '@/features/workspace-ui/ui/primitives';
import { completeOnboarding } from '@/features/auth/onboarding-actions';
import { initialOnboardingState } from '@/features/auth/onboarding-state';
import { safeInternalPath } from '@/lib/safe-internal-path';

/** `bench` renders the Calibration Bench visuals (spec 4.1); without it the legacy markup is unchanged. */
export function WelcomeForm({ next, bench = false }: { next?: string; bench?: boolean }) {
  const t = useTranslations('auth');
  const tb = useTranslations('bench.auth');
  const handleRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(completeOnboarding, initialOnboardingState);
  // Controlled inputs survive React's form reset after a recoverable action error.
  const [handle, setHandle] = useState(state.values.handle);
  const [displayName, setDisplayName] = useState(state.values.displayName);

  useEffect(() => {
    if (state.fieldErrors.handle) handleRef.current?.focus();
    else if (state.fieldErrors.displayName) displayNameRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby="welcome-title" className={bench ? 'vf-auth-form' : 'mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm'}>
      {bench ? <Kicker>{tb('kicker.welcome')}</Kicker> : null}
      <h1 id="welcome-title" className={bench ? 'vf-title-sm' : 'text-2xl font-semibold'}>{t('welcomeTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('welcomeDescription')}</p>
      <form action={formAction} noValidate aria-busy={pending} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeInternalPath(next)} />
        <div className="space-y-1.5">
          <label htmlFor="handle" className="text-sm font-medium">{t('handle')}</label>
          <Input ref={handleRef} id="handle" name="handle" autoComplete="username" required
            value={handle} onChange={event => setHandle(event.target.value)} disabled={pending}
            aria-invalid={Boolean(state.fieldErrors.handle)}
            aria-describedby={state.fieldErrors.handle ? 'handle-error' : undefined}
            aria-errormessage={state.fieldErrors.handle ? 'handle-error' : undefined} />
          {state.fieldErrors.handle ? <p id="handle-error" role="alert" className="text-sm text-destructive">{t(state.fieldErrors.handle)}</p> : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="display-name" className="text-sm font-medium">{t('displayName')}</label>
          <Input ref={displayNameRef} id="display-name" name="displayName" autoComplete="name" required
            value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={pending}
            aria-invalid={Boolean(state.fieldErrors.displayName)}
            aria-describedby={state.fieldErrors.displayName ? 'display-name-error' : undefined}
            aria-errormessage={state.fieldErrors.displayName ? 'display-name-error' : undefined} />
          {state.fieldErrors.displayName ? <p id="display-name-error" role="alert" className="text-sm text-destructive">{t(state.fieldErrors.displayName)}</p> : null}
        </div>
        {state.error ? <p id="welcome-status" aria-live="assertive" role="alert" className="text-sm text-destructive">{t(state.error)}</p> : null}
        <Button type="submit" className="min-h-11 w-full" disabled={pending}>{pending ? t('continuing') : t('continue')}</Button>
      </form>
    </section>
  );
}
