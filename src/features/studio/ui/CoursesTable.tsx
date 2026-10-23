"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpenIcon, CopyIcon, SquarePenIcon } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DataCard,
  DataPagination,
  DataToolbar,
  EmptyState,
  RowActions,
  SortableHead,
  StatusBadge,
  type SortState,
} from '@/features/staff-ui/components';
import { CONTENT_STAGES, type ContentStage } from '@/features/content-review/lifecycle';
import type { CourseRow } from '@/features/studio/courses-data';
import { STAGE_TONES } from './home/stages';

export type CoursesTableProps = {
  rows: CourseRow[];
  /** 'unavailable' when review requests could not be read; the status filter then offers content states only. */
  reviews?: 'ready' | 'unavailable';
};

const PAGE_SIZE = 20;
const CONTENT_ONLY_STAGES: readonly ContentStage[] = ['draft', 'published', 'archived'];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase();
}

/**
 * The course list: search, a status filter that includes the review state (from each course's
 * latest review request), Title/Updated sorting and client paging. The whole scoped list is
 * loaded, so the footer total is honest.
 */
export function CoursesTable({ rows, reviews = 'ready' }: CoursesTableProps) {
  const t = useTranslations('staffUi.studio.courses');
  const legacy = useTranslations('studio.courses');
  const format = useFormatter();
  const locale = useLocale();
  const [values, setValues] = useState<Record<string, string | undefined>>({});
  const [sort, setSort] = useState<SortState>({ column: 'updated', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  const untitled = legacy('untitled');
  const titleOf = (row: CourseRow) => row.title ?? untitled;
  const stageOf = (row: CourseRow): ContentStage => (reviews === 'ready' ? row.stage : row.status);
  const stageOptions = reviews === 'ready' ? CONTENT_STAGES : CONTENT_ONLY_STAGES;

  const filtered = useMemo(() => {
    const query = normalize(values.q?.trim() ?? '');
    const matching = rows.filter((row) => {
      if (values.status && (reviews === 'ready' ? row.stage : row.status) !== values.status) return false;
      if (!query) return true;
      return [row.title ?? '', row.id, row.owner ?? ''].some((part) => normalize(part).includes(query));
    });
    if (!sort) return matching;
    const direction = sort.direction === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    return [...matching].sort((left, right) => {
      if (sort.column === 'title') return direction * collator.compare(left.title ?? untitled, right.title ?? untitled);
      // Courses without a date sort last in either direction.
      if (!left.updatedAt || !right.updatedAt) return left.updatedAt ? -1 : right.updatedAt ? 1 : 0;
      return direction * left.updatedAt.localeCompare(right.updatedAt);
    });
  }, [locale, reviews, rows, sort, untitled, values]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setNotice(t('list.copied', { id }));
    } catch {
      setNotice(t('list.copyError'));
    }
  }

  const noRows = rows.length === 0;
  return (
    <DataCard
      title={t('list.title')}
      description={reviews === 'unavailable' ? t('list.reviewsUnavailable') : undefined}
      toolbar={noRows ? undefined : (
        <DataToolbar
          values={values}
          onValuesChange={(next) => { setValues(next); setPage(1); }}
          searchLabel={t('list.search')}
          searchPlaceholder={t('list.search')}
          filters={[{
            param: 'status',
            label: t('list.status'),
            options: stageOptions.map((stage) => ({ value: stage, label: t(`stages.${stage}`) })),
          }]}
        />
      )}
      footer={noRows ? undefined : (
        <DataPagination mode="page" page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      )}
    >
      <p role="status" aria-live="polite" className="sr-only">{notice}</p>
      {noRows ? (
        <div className="p-6"><EmptyState icon={<BookOpenIcon />} title={legacy('empty')} /></div>
      ) : visible.length === 0 ? (
        <div className="p-6"><EmptyState title={t('list.noMatches')} /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead column="title" sort={sort} onSortChange={(next) => { setSort(next); setPage(1); }} allowUnsorted={false}>{legacy('table.title')}</SortableHead>
              <TableHead scope="col">{legacy('table.status')}</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">{legacy('table.version')}</TableHead>
              <SortableHead column="updated" defaultDirection="desc" sort={sort} onSortChange={(next) => { setSort(next); setPage(1); }} allowUnsorted={false} className="hidden lg:table-cell">{legacy('table.updated')}</SortableHead>
              <TableHead scope="col" className="hidden lg:table-cell">{legacy('table.owner')}</TableHead>
              <TableHead scope="col" className="w-12"><span className="sr-only">{t('list.actions')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const title = titleOf(row);
              const href = `/studio/courses/${encodeURIComponent(row.id)}`;
              const stage = stageOf(row);
              return (
                <TableRow key={row.id}>
                  <TableCell className="min-w-40 py-2 whitespace-normal md:min-w-72">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {/* Two lines before clipping, so long Vietnamese titles stay readable on phones too. */}
                      <Link href={href} title={title} className="line-clamp-2 break-words font-medium leading-normal underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</Link>
                      <span className="truncate text-xs leading-normal text-muted-foreground">{row.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="content" value={stage} tone={STAGE_TONES[stage]} label={t(`stages.${stage}`)} />
                  </TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell" title={row.version === null ? legacy('noVersion') : undefined}>{row.version === null ? '—' : `v${row.version}`}</TableCell>
                  <TableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground lg:table-cell">
                    {row.updatedAt ? format.dateTime(new Date(row.updatedAt), { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell" title={row.owner ?? legacy('unknownOwner')}>{row.owner ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      label={t('list.actionsFor', { title })}
                      items={[
                        { label: t('list.open'), href, icon: <SquarePenIcon aria-hidden="true" /> },
                        { label: t('list.copyId'), onSelect: () => copyId(row.id), icon: <CopyIcon aria-hidden="true" /> },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}
