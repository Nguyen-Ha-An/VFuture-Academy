import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { AcademyHeader } from '@/features/public-site/AcademyHeader';
import { AcademyFooter } from '@/features/public-site/AcademyFooter';
import { PublicNavigationProvider } from '@/features/public-site/PublicNavigation';
import { PublicMotion } from '@/features/public-site/PublicMotion';
import { CookieConsent } from '@/features/public-site/ConsentPanel';
import { OrganizationJsonLd } from '@/features/public-site/metadata';
import '@/features/public-site/academy-base.css';
import '@/features/public-site/public-site.css';


export default async function PublicLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('labs');
  return <div className="academy-shell-site public-site">
    <PublicNavigationProvider>
      <a className="academy-shell-skip" href="#main-content">{t('skipToContent')}</a>
      <AcademyHeader />
      <PublicMotion>{children}</PublicMotion>
      <AcademyFooter />
      <CookieConsent />
      <OrganizationJsonLd />
    </PublicNavigationProvider>
  </div>;
}
