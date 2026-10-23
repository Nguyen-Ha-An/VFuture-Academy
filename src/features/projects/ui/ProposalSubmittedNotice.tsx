'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Notice } from '@/features/workspace-ui/ui/primitives';

/**
 * Confirms a just-submitted proposal once, then strips `?submitted=1` from the
 * URL so a reload or shared link does not repeat it. The notice stays visible
 * after the replace because its state outlives the server re-render.
 */
export function ProposalSubmittedNotice({ show, cleanHref }: { show: boolean; cleanHref: string }) {
  const t = useTranslations('build.proposal');
  const router = useRouter();
  const [visible] = useState(show);
  useEffect(() => {
    if (show) router.replace(cleanHref, { scroll: false });
  }, [show, cleanHref, router]);
  if (!visible) return null;
  return <div className="vf-proposal-submitted"><Notice label={t('submittedLabel')}>{t('submitted')}</Notice></div>;
}
