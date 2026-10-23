'use client';

import { useLocale, useTranslations } from 'next-intl';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { publicCopy } from '@/features/public-site/public-copy';

export default function PublicDiscoveryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('publicDiscovery');
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const copy = publicCopy[locale];
  return <main id="main-content" className="public-page" tabIndex={-1}>
    <div className="public-container">
      <div className="public-empty">
        <div role="alert">
          <span className="public-empty__mark" aria-hidden="true">—</span>
          <h1 className="public-title">{t('unavailableTitle')}</h1>
          <p className="public-copy">{t('unavailableDescription')}</p>
        </div>
        <div className="public-actions">
          <button type="button" onClick={reset} className="public-button">{t('retry')}</button>
          <PublicLink href="/" className="public-button public-button--secondary">{copy.recoveryHome}</PublicLink>
          <PublicLink href="/contact" className="public-button public-button--secondary">{copy.navigation.contact}</PublicLink>
        </div>
      </div>
    </div>
  </main>;
}
