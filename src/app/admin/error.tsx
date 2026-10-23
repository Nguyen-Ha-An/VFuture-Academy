'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AdminForbidden } from '@/features/admin/ui/AdminForbidden';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
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

export default function AdminError({ error, reset }: { error: ErrorPayload; reset: () => void }) {
  const t = useTranslations('staffUi.admin.boundary.error');
  const forbidden = isForbiddenPayload(error);
  useEffect(() => {
    if (!forbidden) reportError(error, { area: 'admin', digest: error.digest });
  }, [error, forbidden]);

  if (forbidden) return <AdminForbidden />;

  return (
    <div className="mx-auto grid min-h-[60vh] w-full max-w-2xl content-center py-8">
      <Card>
        <CardContent>
          <StaffPageHeader title={t('title')} description={t('description')} />
          <Button className="min-h-11" onClick={reset}>{t('retry')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
