'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { publicCopy } from '@/features/public-site/public-copy';
import { VFutureLogo } from './VFutureLogo';
import { CENTRAL_URL, COMPETITION_URL } from './product-origins';

/** Academy navigation keeps catalogs local and other products on configured origins. */
export function AcademyHeader() {
  const t = useTranslations('labs.navigation');
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const routeWhenOpened = useRef<string | null>(null);
  const currentRoute = `${pathname}?${query}`;
  // A stale expanded menu never survives history, locale, or route navigation.
  const expanded = open && routeWhenOpened.current === currentRoute;

  useEffect(() => { setOpen(false); }, [currentRoute]);


  useEffect(() => {
    if (!expanded) return;
    header.current?.querySelector<HTMLAnchorElement>('#academy-shell-navigation a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    const onOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    const onResize = () => { if (window.innerWidth >= 1100) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      window.removeEventListener('resize', onResize);
    };
  }, [expanded]);

  const items: Array<{ label: string; href: string }> = (['academy', 'courses', 'projects', 'opportunities', 'resources'] as const).map((key) => ({ label: publicCopy[locale].navigation[key], href: `/${key}` }));
  if (COMPETITION_URL) items.push({ label: locale === 'vi' ? 'Cuộc thi' : 'Competitions', href: COMPETITION_URL });
  if (CENTRAL_URL) items.push({ label: 'VFuture Labs', href: CENTRAL_URL });

  return <header ref={header} className="academy-shell-header academy-shell-header--public" data-menu-open={expanded}>
    <div className="academy-shell-container academy-shell-header__inner">
      <PublicLink href="/" className="academy-shell-brand" aria-label="VFuture Academy"><VFutureLogo academy /></PublicLink>
      <nav id="academy-shell-navigation" aria-label={t('label')} className="academy-shell-navigation" data-open={expanded}>
        {items.map(({ href, label }) => <PublicLink key={href} href={href} onClick={() => setOpen(false)} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}>{label}</PublicLink>)}
        <PublicLink href="/login" className="academy-shell-navigation__mobile-signin" onClick={() => setOpen(false)}>{t('signIn')}<ArrowUpRight size={14} aria-hidden="true" /></PublicLink>
      </nav>
      <div className="academy-shell-header__actions">
        <nav className="academy-shell-locale" aria-label={t('language')}>
          {(['vi', 'en'] as const).map((value) => {
            const params = new URLSearchParams(query);
            params.set('lang', value);
            return <a key={value} href={`?${params}`} hrefLang={value} lang={value} aria-label={value === 'vi' ? 'Tiếng Việt' : 'English'} aria-current={locale === value ? 'page' : undefined}>{value.toUpperCase()}</a>;
          })}
        </nav>
        <PublicLink href="/login" className="academy-shell-header__signin">{t('signIn')}<ArrowUpRight size={14} aria-hidden="true" /></PublicLink>
        <button ref={button} type="button" className="academy-shell-menu-toggle" aria-expanded={expanded} aria-controls="academy-shell-navigation" aria-label={t(expanded ? 'closeMenu' : 'menu')} onClick={() => { routeWhenOpened.current = currentRoute; setOpen(!expanded); }}>
          {expanded ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </div>
    <noscript><nav className="academy-shell-navigation-static" aria-label={t('label')}>{items.map(({ href, label }) => <a key={href} href={href.startsWith('/') ? `${href}?lang=${locale}` : href}>{label}</a>)}<a href="/login">{t('signIn')}</a></nav></noscript>
  </header>;
}
