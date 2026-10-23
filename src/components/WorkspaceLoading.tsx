"use client";

import { useTranslations } from 'next-intl';

export function WorkspaceLoading() {
  const t = useTranslations('studioWorkspace');
  return <div role="status" aria-live="polite" className="space-y-5 p-4">
    <p className="text-sm text-muted-foreground">{t('updating')}</p>
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
      <div className="h-10 w-1/3 rounded bg-muted" />
      <div className="h-[55dvh] rounded-lg border border-border bg-muted/40" />
    </div>
  </div>;
}
