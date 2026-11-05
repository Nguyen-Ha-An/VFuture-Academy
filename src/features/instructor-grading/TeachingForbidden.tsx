'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CanvasButton } from '@/features/canvas/ui';
import { routes } from '@/lib/routes';

/** Shared by Teaching boundaries; permissions are decided by the server. */
export function TeachingForbidden() {
  const vi = useLocale() === 'vi';
  const common = useTranslations('studio.forbidden');
  return <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-foreground">
    <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 sm:p-8" aria-labelledby="teaching-forbidden-title">
      <p className="text-xs font-medium text-muted-foreground">403</p>
      <h1 tabIndex={-1} id="teaching-forbidden-title" className="mt-2 text-2xl font-bold leading-snug">{vi ? 'Cần quyền truy cập Giảng dạy' : 'Teaching access required'}</h1>
      <p className="my-4 text-sm leading-relaxed text-muted-foreground">{vi ? 'Bạn không có quyền truy cập không gian Giảng dạy trong phạm vi này.' : 'You do not have permission to access Teaching in this scope.'}</p>
      <CanvasButton href={routes.learner.dashboard()}>{common('back')}</CanvasButton>
    </section>
  </div>;
}
