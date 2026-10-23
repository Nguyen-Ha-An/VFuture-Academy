'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { allowedConsentReturn } from './redirect-allowlist';

export type ConsentPanelState =
  | { kind: 'ready'; authorizationId: string; callback: string; host: string; clientName: string; scopes: string[]; accountEmail: string }
  | { kind: 'unsafe'; authorizationId: string }
  | { kind: 'redirect'; redirectUrl: string }
  | { kind: 'tester' | 'access' | 'missing' | 'expired' | 'unavailable' };

export function ConsentPanel({ state }: { state: ConsentPanelState }) {
  const t = useTranslations('studioConnect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (state.kind !== 'redirect') return;
    const destination = allowedConsentReturn(state.redirectUrl);
    if (destination) window.location.assign(destination);
    else setError(t('invalidResponse'));
  }, [state, t]);

  async function decide(decision: 'approve' | 'deny') {
    if (busy || (state.kind !== 'ready' && state.kind !== 'unsafe')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/oauth/consent', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizationId: state.authorizationId, decision }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? t('rateLimited') : response.status === 410 ? t('expiredDescription') : t('requestFailed'));
        return;
      }
      const payload: unknown = await response.json();
      const data = typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : null;
      const returned = typeof data === 'object' && data !== null && 'redirectUrl' in data ? data.redirectUrl : undefined;
      if (returned === null && decision === 'deny') {
        setDenied(true);
        return;
      }
      const destination = allowedConsentReturn(returned, state.kind === 'ready' ? state.callback : undefined);
      if (!destination) {
        setError(t('invalidResponse'));
        return;
      }
      window.location.assign(destination);
    } catch {
      setError(t('requestFailed'));
    } finally {
      setBusy(false);
    }
  }

  const page = denied ? 'denied' : state.kind;
  const title = page === 'ready' ? t('readyTitle', { host: state.kind === 'ready' ? state.host : '' })
    : page === 'unsafe' ? t('unsafeTitle')
    : page === 'tester' ? t('testerTitle')
    : page === 'access' ? t('accessTitleBlocked')
    : page === 'missing' ? t('missingTitle')
    : page === 'expired' ? t('expiredTitle')
    : page === 'unavailable' ? t('unavailableTitle')
    : page === 'redirect' ? t('redirectingTitle')
    : t('deniedTitle');
  const description = page === 'ready' ? t('description')
    : page === 'unsafe' ? t('unsafeDescription')
    : page === 'tester' ? t('testerDescription')
    : page === 'access' ? t('accessDescriptionBlocked')
    : page === 'missing' ? t('missingDescription')
    : page === 'expired' ? t('expiredDescription')
    : page === 'unavailable' ? t('unavailableDescription')
    : page === 'redirect' ? t('redirectingDescription')
    : t('deniedDescription');

  return (
    <div className="mx-auto w-full max-w-2xl py-6 text-foreground md:py-10">
      <p className="mb-4 text-xs font-semibold leading-normal text-muted-foreground">{t('eyebrow')}</p>
      <section className="rounded-lg border border-border bg-card p-6 text-card-foreground md:p-8" aria-labelledby="studio-connect-title">
        <h1 id="studio-connect-title" className="text-2xl font-bold leading-[1.4] tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-normal text-muted-foreground">{description}</p>

        {state.kind === 'ready' && !denied ? (
          <div className="mt-6 space-y-6">
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs font-semibold leading-normal text-muted-foreground">{t('verifiedHost')}</p>
              <p className="mt-1 break-all text-lg font-semibold leading-normal">{state.host}</p>
              <p className="mt-4 text-xs font-semibold leading-normal text-muted-foreground">{t('callbackUrlLabel')}</p>
              <p className="mt-1 break-all font-mono text-xs leading-relaxed">{state.callback}</p>
              <p className="mt-1 text-xs leading-normal text-muted-foreground">{t('callbackCompare')}</p>
              <p className="mt-4 text-xs font-semibold leading-normal text-muted-foreground">{t('clientName')}</p>
              <p className="mt-1 break-words text-sm leading-normal">{state.clientName}</p>
              <p className="mt-3 break-all text-xs leading-normal text-muted-foreground">{t('signedInAs', { email: state.accountEmail })}</p>
            </div>

            <div>
              <h2 className="text-sm font-medium leading-normal">{t('accessTitle')}</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-normal text-muted-foreground">
                <li>{t('readCourses')}</li>
                <li>{t('answerKeys')}</li>
                <li>{t('readOnlyTools')}</li>
                <li>{t('tokenScope')}</li>
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-medium leading-normal">{t('scopesTitle')}</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {state.scopes.map((scope) => <li key={scope} className="max-w-full break-all rounded-md border border-border bg-muted px-2 py-1 text-xs leading-normal">{scope}</li>)}
              </ul>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-5 text-sm leading-normal text-destructive">{error}</p> : null}

        {!denied && (state.kind === 'ready' || state.kind === 'unsafe') ? (
          <div className="mt-7 flex flex-wrap gap-3 border-t border-border pt-6">
            <Button variant="outline" className="min-h-11" disabled={busy} aria-busy={busy || undefined} onClick={() => void decide('deny')}>{busy ? t('working') : t('deny')}</Button>
            {state.kind === 'ready' ? <Button className="min-h-11" disabled={busy} aria-busy={busy || undefined} onClick={() => void decide('approve')}>{busy ? t('working') : t('allow')}</Button> : null}
          </div>
        ) : (
          <div className="mt-7 border-t border-border pt-6">
            <Button asChild variant="outline" className="min-h-11"><a href="/studio">{t('backToStudio')}</a></Button>
          </div>
        )}
      </section>
    </div>
  );
}
