import { useTranslations } from 'next-intl';

import { FilterLink, PagerFocus } from './FilterBar';

export type DirectoryPaginationProps = {
  /** 1-based; clamped into range. */
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
  /** Formatted labels; default to `learner.directory.pagination.*`. */
  labels?: { navigation: string; previous: string; next: string; summary: string };
  /** The results header that takes focus after a page change (DirectoryPage passes its own). */
  resultsId?: string;
};

/** The learner pager: previous/next buttons around a mono "Page n of m". Nothing on one page. */
export function DirectoryPagination({ page, pageSize, total, href, labels, resultsId }: DirectoryPaginationProps) {
  const t = useTranslations('learner.directory.pagination');
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pages <= 1) return null;
  const current = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  const text = labels ?? {
    navigation: t('navigation'),
    previous: t('previous'),
    next: t('next'),
    summary: t('summary', { page: current, pages }),
  };
  return <nav aria-label={text.navigation} className="vf-l-pager">
    {/* The activated link can vanish with the old page (Next on the page before the last), so focus follows the results. */}
    <PagerFocus page={current} resultsId={resultsId} />
    {current > 1 ? <FilterLink href={href(current - 1)} rel="prev" className="vf-btn vf-btn-lg" data-dir="prev"><span className="vf-l-arrow" aria-hidden="true">←&nbsp;</span>{text.previous}</FilterLink> : null}
    <p className="vf-meta">{text.summary}</p>
    {current < pages ? <FilterLink href={href(current + 1)} rel="next" className="vf-btn vf-btn-lg" data-dir="next">{text.next}<span className="vf-l-arrow" aria-hidden="true">&nbsp;→</span></FilterLink> : null}
  </nav>;
}
