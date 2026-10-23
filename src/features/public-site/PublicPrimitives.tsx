import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import type { RouteQuery } from '@/lib/routes';
import { PublicLink, PublicResults } from './PublicNavigation';
import { publicCopy } from './public-copy';

export function PublicPageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <header className="public-page-header" data-public-header>
    {eyebrow ? <p className="public-kicker">{eyebrow}</p> : null}
    <div className="public-page-header__row"><h1 className="public-title">{title}</h1>{description ? <p className="public-copy public-page-header__description">{description}</p> : null}</div>
    {children ? <div className="public-page-header__actions">{children}</div> : null}
    <div className="public-rule" data-public-rule aria-hidden="true" />
  </header>;
}

export function PublicCatalogPage({ header, filters, summary, children }: { header: ReactNode; filters?: ReactNode; summary: ReactNode; children: ReactNode }) {
  return <main id="main-content" className="public-page public-catalog" tabIndex={-1}>
    <div className="public-container">{header}
      {filters ? <div className="public-catalog__filters">{filters}</div> : null}
      <PublicResults summary={summary}>{children}</PublicResults>
    </div>
  </main>;
}

export function PublicEmptyState({ title, description, resetHref, resetLabel }: { title: string; description?: string; resetHref?: string; resetLabel?: string }) {
  return <div className="public-empty">
    <span className="public-empty__mark" aria-hidden="true">—</span>
    <h2>{title}</h2>{description ? <p className="public-copy">{description}</p> : null}
    {resetHref && resetLabel ? <PublicLink href={resetHref} className="public-button public-button--secondary" resultNavigation>{resetLabel}<ArrowRight size={16} aria-hidden="true" /></PublicLink> : null}
  </div>;
}

export function PublicPagination({ page, pageSize, total, query, href, labels }: { page: number; pageSize: number; total: number; query: RouteQuery; href: (query: RouteQuery) => string; labels: { navigation: string; previous: string; next: string; summary: string } }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const base = query instanceof URLSearchParams ? Object.fromEntries(query.entries()) : query;
  return <nav aria-label={labels.navigation} className="public-pagination">
    {page > 1 ? <PublicLink href={href({ ...base, page: page - 1 })} className="public-button public-button--secondary" resultNavigation rel="prev"><ArrowLeft size={16} aria-hidden="true" />{labels.previous}</PublicLink> : <span />}
    <span className="public-meta">{labels.summary}</span>
    {page < totalPages ? <PublicLink href={href({ ...base, page: page + 1 })} className="public-button public-button--secondary" resultNavigation rel="next">{labels.next}<ArrowRight size={16} aria-hidden="true" /></PublicLink> : <span />}
  </nav>;
}

export function PublicBreadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  const locale = useLocale();
  return <nav className="public-breadcrumbs" aria-label={publicCopy[locale === 'en' ? 'en' : 'vi'].breadcrumbs}><ol>
    {items.map((item, index) => <li key={`${item.label}-${index}`}>
      {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
      {item.href ? <PublicLink href={item.href}>{item.label}</PublicLink> : <span aria-current="page">{item.label}</span>}
    </li>)}
  </ol></nav>;
}

export function PublicDetailLayout({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main id="main-content" className={`public-page public-detail ${className}`.trim()} tabIndex={-1}><div className="public-container">{children}</div></main>;
}

export function PublicBackLink({ href, children }: { href: string; children: ReactNode }) {
  return <PublicLink href={href} className="public-back-link"><ArrowLeft size={15} aria-hidden="true" />{children}</PublicLink>;
}
