'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/classic';
import { reportError } from '@/lib/observability';

type AppError = Error & { digest?: string };

export default function ErrorPage({ error, reset }: { error: AppError; reset: () => void }) {
  const t = useTranslations('errors');
  const [correlationId, setCorrelationId] = useState<string>();
  useEffect(() => {
    setCorrelationId(reportError(error, { area: 'app', digest: error.digest }));
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 shadow-sm" aria-labelledby="app-error-title">
        <h1 id="app-error-title" className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-muted-foreground">{t('description')}</p>
        {correlationId ? (
          <p className="mt-3 font-mono text-sm text-muted-foreground">
            {t('reference', { correlationId })}
          </p>
        ) : null}
        <Button className="mt-7" onClick={reset}>{t('retry')}</Button>
      </section>
    </main>
  );
}
