import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Kicker } from './primitives';

/** One breadcrumb. The last item is the current page and renders without a link. */
export type Crumb = { label: string; href?: string };

/**
 * Page-owned breadcrumbs (DESIGN D3): rendered inside the column by the page header, so hrefs can
 * carry the list query. The last crumb is the current page (`aria-current="page"`).
 */
export function Crumbs({ items }: { items: readonly Crumb[] }) {
  const common = useTranslations('common');
  if (!items.length) return null;
  return <nav aria-label={common('breadcrumbs')}>
    <ol className="vf-crumbs">
      {items.map((item, index) => {
        const current = index === items.length - 1;
        // The separator closes the previous crumb, so a wrapped trail never starts a line with "/".
        return <li key={`${index}:${item.label}`}>
          {current
            ? <span aria-current="page">{item.label}</span>
            : item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
          {current ? null : <span aria-hidden="true">/</span>}
        </li>;
      })}
    </ol>
  </nav>;
}

export type PageHeaderProps = {
  kicker?: ReactNode;
  title: ReactNode;
  titleId?: string;
  /** `page` is the 28–40px page title; `anchor` is the 28px title of an anchor card. */
  titleSize?: 'page' | 'anchor';
  lead?: ReactNode;
  /** Mono meta line; items are separated with a middle dot. */
  meta?: ReactNode[];
  tags?: ReactNode;
  /** The one primary action of the page. */
  actions?: ReactNode;
  crumbs?: readonly Crumb[];
  as?: 'header' | 'section' | 'div';
  children?: ReactNode;
  className?: string;
};

/**
 * One header anatomy for every learner page: crumbs, kicker, tags, h1 with one primary action,
 * lead, meta, then any page-specific controls (segmented tabs, filters) as children.
 */
export function PageHeader({ kicker, title, titleId, titleSize = 'page', lead, meta, tags, actions, crumbs, as: Tag = 'header', children, className }: PageHeaderProps) {
  const metaItems = (meta ?? []).filter(item => item !== null && item !== undefined && item !== false && item !== '');
  const heading = <h1 id={titleId} className={titleSize === 'anchor' ? 'vf-title-sm' : 'vf-title'}>{title}</h1>;
  const leadNode = lead ? typeof lead === 'string' ? <p className="vf-l-lead">{lead}</p> : lead : null;
  return <Tag className={cn('vf-page-head', className)} aria-labelledby={Tag === 'section' && titleId ? titleId : undefined}>
    {crumbs?.length ? <Crumbs items={crumbs} /> : null}
    {kicker ? <Kicker>{kicker}</Kicker> : null}
    {tags ? <div className="vf-l-head-tags">{tags}</div> : null}
    {actions
      ? <div className="vf-page-head-row"><div className="vf-l-head-main">{heading}{leadNode}</div><div className="vf-l-head-action" data-slot="action">{actions}</div></div>
      : <>{heading}{leadNode}</>}
    {metaItems.length ? <p className="vf-meta vf-l-head-meta m-0">{metaItems.map((item, index) => <span key={index}>{item}</span>)}</p> : null}
    {children}
  </Tag>;
}
