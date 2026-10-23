'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { BenchState } from '../ui/BenchState';

/** Route-level fault panel (spec 4.12): FAULT kicker, digest, Try again and Go to Learning. */
export function BenchFault({ digest, reset }: { digest?: string; reset: () => void }) {
  const t = useTranslations('bench.shared');
  return <BenchState
    kind="fault"
    kicker={t('fault')}
    title={t('errorTitle')}
    titleAs="h1"
    titleId="bench-fault-title"
    body={t('errorBody')}
    meta={digest ? `${t('digest')} ${digest}` : undefined}
    actions={<>
      <button type="button" onClick={reset} className="vf-btn vf-btn-primary vf-btn-lg">{t('tryAgain')}</button>
      <Link href={routes.learner.dashboard()} className="vf-btn vf-btn-lg">{t('goLearning')}</Link>
    </>}
  />;
}
