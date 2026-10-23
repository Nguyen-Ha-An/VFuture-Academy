import type { ReactNode } from 'react';
import { DirectoryPagination, type DirectoryPaginationProps } from './DirectoryPagination';
import { FilterBar, type FilterBarProps } from './FilterBar';
import { ResultsHeader, type ResultsHeaderProps } from './ResultsHeader';

export type DirectoryPageProps = {
  /** The page header (PageHeader). */
  header: ReactNode;
  /** Segmented tabs under the header. */
  tabs?: ReactNode;
  /** An invalid-filter or other notice above the filters. */
  notice?: ReactNode;
  filters?: FilterBarProps;
  results: ResultsHeaderProps;
  /** The empty or filtered-empty state; when set (not null, undefined, false or ''), the list and the pager are not rendered. */
  empty?: ReactNode | null;
  pagination?: DirectoryPaginationProps | null;
  /** The list: one or more DirectoryTables. */
  children?: ReactNode;
};

/** A learner directory: header, tabs, notice, filters, results line, list (or empty state), pager. */
export function DirectoryPage({ header, tabs, notice, filters, results, empty, pagination, children }: DirectoryPageProps) {
  // `empty={rows.length === 0 && <BenchState …/>}` passes false for a non-empty list.
  const isEmpty = empty !== undefined && empty !== null && typeof empty !== 'boolean' && empty !== '';
  return <div className="vf-l-directory">
    {header}
    {tabs}
    {notice}
    {filters ? <FilterBar {...filters} resultsId={filters.resultsId ?? results.id} /> : null}
    <section className="vf-l-dir-results" aria-labelledby={results.id}>
      <ResultsHeader {...results} live={results.live ?? !filters} />
      {isEmpty ? <div className="vf-l-dir-empty">{empty}</div> : <div className="vf-l-dir-list">{children}</div>}
    </section>
    {!isEmpty && pagination ? <DirectoryPagination {...pagination} resultsId={pagination.resultsId ?? results.id} /> : null}
  </div>;
}
