'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StudioForbidden } from '@/features/studio/ui/StudioForbidden';
import { reportError } from '@/lib/observability';

type ErrorPayload = Error & {
  status?: unknown;
  code?: unknown;
  digest?: unknown;
  cause?: unknown;
  error?: unknown;
};

function isForbiddenPayload(value: unknown, depth = 0): boolean {
  if (depth > 2 || typeof value !== 'object' || value === null) return false;
  const payload = value as ErrorPayload;
  if (payload.status === 403 || payload.code === 'FORBIDDEN') return true;
  if (typeof payload.digest === 'string' && payload.digest.includes(';403')) return true;
  return isForbiddenPayload(payload.cause, depth + 1) || isForbiddenPayload(payload.error, depth + 1);
}

export default function GradingError({ error, reset }: { error: ErrorPayload; reset: () => void }) {
  const t = useTranslations('studioReview.error');
  const forbidden = isForbiddenPayload(error);
  useEffect(() => {
    if (!forbidden) reportError(error, { area: 'grading', digest: error.digest });
  }, [error, forbidden]);

  if (forbidden) return <StudioForbidden />;

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-foreground">
      <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground sm:p-8" aria-labelledby="grading-error-title">
        <h1 id="grading-error-title" className="text-2xl font-bold leading-[1.4] tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-sm leading-normal text-muted-foreground">{t('description')}</p>
        <Button className="mt-6" onClick={reset}>{t('retry')}</Button>
      </section>
    </div>
  );
}
