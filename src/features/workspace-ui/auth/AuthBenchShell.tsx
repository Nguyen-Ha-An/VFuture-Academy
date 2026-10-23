import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { readWorkspaceTheme } from '../theme.server';
import { BrandMark } from '../ui/primitives';
import { WorkspaceSurface } from '../ui/WorkspaceSurface';
import { LocalClock } from './LocalClock';
import './auth.css';

/**
 * Calibration Bench shell for /login and the auth family (spec 4.1). The side panel is an
 * `<aside>`; the page's own `<main>` (and its only h1) renders inside the form panel.
 */
export async function AuthBenchShell({ children }: { children: ReactNode }) {
  const [theme, t, locale] = await Promise.all([readWorkspaceTheme(), getTranslations('bench.auth'), getLocale()]);
  const policyQuery = locale === 'en' ? '?lang=en' : '';
  return (
    <WorkspaceSurface theme={theme}>
      <div className="vf-auth">
        <aside className="vf-auth-side vf-grid-bg" aria-label={t('side.label')}>
          <Link href="/" className="vf-brand self-start"><BrandMark /><span>{t('side.brand')}</span></Link>
          <p className="vf-auth-statement">{t('side.statement')}</p>
          <dl>
            <dt className="vf-label">{t('side.bench')}</dt><dd>{t('side.benchValue')}</dd>
            <dt className="vf-label">{t('side.local')}</dt><dd><LocalClock /> {t('side.timeZone')}</dd>
            <dt className="vf-label">{t('side.status')}</dt><dd><span className="vf-auth-dot" aria-hidden="true" />{t('side.statusValue')}</dd>
          </dl>
        </aside>
        <div className="vf-auth-panel">
          {children}
          <footer className="vf-auth-foot">
            <Suspense fallback={null}><LocaleSwitcher variant="links" /></Suspense>
            <p className="vf-meta vf-auth-foot-bench">{t('side.bench')} · {t('side.benchValue')}</p>
            <p className="vf-auth-policy">
              <Link href={`/privacy${policyQuery}`}>{t('foot.privacy')}</Link>
              <span aria-hidden="true">·</span>
              <Link href={`/terms${policyQuery}`}>{t('foot.terms')}</Link>
            </p>
          </footer>
        </div>
      </div>
    </WorkspaceSurface>
  );
}
