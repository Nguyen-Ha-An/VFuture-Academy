import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState, PageHeader, SurfaceCard } from '@/components/ui/page';
import type { RouteQuery } from '@/lib/routes';

export { EmptyState, PageHeader, SurfaceCard };

export function lastPublicPage(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function PublicCatalogLayout({ header, filters, summary, children }: { header: ReactNode; filters?: ReactNode; summary: ReactNode; children: ReactNode }) {
  return <main id="main-content" className="mx-auto min-h-[70vh] max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">{header}{filters ? <div className="mt-10">{filters}</div> : null}<div className="mt-8 font-mono text-xs uppercase tracking-wide text-muted-foreground">{summary}</div><div className="mt-8">{children}</div></main>;
}

export function PublicPagination({ page, pageSize, total, query, href, labels }: { page: number; pageSize: number; total: number; query: RouteQuery; href: (query: RouteQuery) => string; labels: { navigation: string; previous: string; next: string; summary: string } }) {
  const totalPages = lastPublicPage(total, pageSize);
  if (totalPages <= 1) return null;
  const linkClass = 'inline-flex min-h-11 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const base = query instanceof URLSearchParams ? Object.fromEntries(query.entries()) : query;
  return <nav aria-label={labels.navigation} className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6">{page > 1 ? <Link href={href({ ...base, page: page - 1 })} className={linkClass}>{labels.previous}</Link> : <span />}<span className="text-sm text-muted-foreground">{labels.summary}</span>{page < totalPages ? <Link href={href({ ...base, page: page + 1 })} className={linkClass}>{labels.next}</Link> : <span />}</nav>;
}

export function TagList({ values, label }: { values: string[]; label: string }) {
  if (!values.length) return null;
  return <div role="list" aria-label={label} className="flex flex-wrap gap-2">{values.map(value => <span role="listitem" key={value} className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">{value}</span>)}</div>;
}
