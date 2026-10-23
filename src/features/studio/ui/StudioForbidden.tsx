'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/** Rendered by the staff error and forbidden boundaries inside the layout's <main>, so the root is a <div> (one main landmark). */
export function StudioForbidden() {
  const t = useTranslations('studio.forbidden');

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-foreground">
      <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground sm:p-8" aria-labelledby="studio-forbidden-title">
        <p className="text-xs font-medium leading-normal text-muted-foreground tabular-nums">{t('code')}</p>
        <h1 id="studio-forbidden-title" className="mt-2 text-2xl font-bold leading-[1.4] tracking-tight">{t('title')}</h1>
        <div className="mt-4 space-y-2 text-sm leading-normal text-muted-foreground">
          <p lang="vi">{t('messageVi')}</p>
          <p lang="en">{t('messageEn')}</p>
        </div>
        <Button asChild className="mt-6"><Link href={routes.learner.dashboard()}><ArrowLeft aria-hidden="true" />{t('back')}</Link></Button>
      </section>
    </div>
  );
}
