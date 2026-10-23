import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { CookiePreferencesButton } from '@/features/public-site/ConsentPanel';
import { publicCopy } from '@/features/public-site/public-copy';
import { CONTACT_EMAIL } from '@/features/public-site/site-config';
import { VFutureLogo } from './VFutureLogo';

export function AcademyFooter() {
  const t = useTranslations('labs.footer');
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const copy = publicCopy[locale].navigation;
  return <footer className="academy-shell-footer" data-public-footer>
    <div className="academy-shell-container">
      <div className="academy-shell-footer__top">
        <PublicLink href="/" className="academy-shell-brand" aria-label="VFuture Academy"><VFutureLogo academy /></PublicLink>
        <p>{t('tagline')}<a className="academy-shell-footer__contact" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}<ArrowUpRight size={14} aria-hidden="true" /></a></p>
        <nav aria-label={t('navigation')}>
          {(['academy', 'courses', 'projects', 'opportunities', 'resources', 'contact'] as const).map((key) => <PublicLink key={key} href={`/${key}`}>{copy[key]}<ArrowUpRight size={14} aria-hidden="true" /></PublicLink>)}
        </nav>
      </div>
      <div className="academy-shell-footer__legal">
        <PublicLink href="/privacy">{copy.privacy}</PublicLink>
        <PublicLink href="/terms">{copy.terms}</PublicLink>
        <CookiePreferencesButton />
      </div>
      <div className="academy-shell-footer__bottom"><span>© {new Date().getFullYear()} VFuture Academy</span><span>{t('note')}</span><a href="#main-content">{t('backToTop')} ↑</a></div>
    </div>
  </footer>;
}
