"use client";

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FileTextIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CONTENT_STATUSES,
  DataCard,
  DataPagination,
  DataToolbar,
  EmptyState,
  PROJECT_STATUSES,
  RowActions,
  StatusBadge,
  type DataToolbarFilter,
} from '@/features/staff-ui/components';
import type { ContentListKind, ContentListRow } from '@/features/studio/content-lists-data';

export type ContentListTableProps = {
  kind: ContentListKind;
  rows: ContentListRow[];
  /** Server page (resources and opportunities load 50 rows per page). */
  page?: number;
  /** A full server page came back, so another page may exist. */
  hasMore?: boolean;
  /** Empty-state action, e.g. the "New resource" link. */
  emptyAction?: ReactNode;
};

const CLIENT_PAGE_SIZE = 20;
const MESSAGE_AREA = { resource: 'studio.resources', opportunity: 'studio.opportunities', project: 'studio.projects' } as const;
const ROUTE = { resource: '/studio/resources', opportunity: '/studio/opportunities', project: '/studio/projects' } as const;

type Values = Record<string, string | undefined>;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase();
}

/**
 * The Studio table for resources, opportunities and projects: search, status and type
 * filters over the loaded rows, a StatusBadge per row and a "…" menu.
 * When the whole list is loaded it pages on the client with an honest total; when the
 * server returned a full page it shows "Page n" links instead and says the filters only
 * cover this page.
 */
export function ContentListTable({ kind, rows, page = 1, hasMore = false, emptyAction }: ContentListTableProps) {
  const t = useTranslations('staffUi.studio.content.list');
  const area = useTranslations(MESSAGE_AREA[kind]);
  const opportunityTypes = useTranslations('studio.opportunities.editor.types');
  const format = useFormatter();
  const [values, setValues] = useState<Values>({});
  const [clientPage, setClientPage] = useState(1);
  const [notice, setNotice] = useState('');

  const serverPaged = page > 1 || hasMore;
  const typeLabel = (type: string) => {
    if (kind === 'opportunity') return opportunityTypes.has(type) ? opportunityTypes(type) : type;
    return t.has(`resourceTypes.${type}`) ? t(`resourceTypes.${type}`) : type;
  };
  const statusKind = kind === 'project' ? 'project' : 'content';
  const statusValues: readonly string[] = kind === 'project' ? PROJECT_STATUSES : CONTENT_STATUSES;
  const untitled = kind === 'project' ? null : area('untitled');
  const titleOf = (row: ContentListRow) => row.title ?? untitled ?? row.id;

  const filters: DataToolbarFilter[] = [
    {
      param: 'status',
      label: t('status'),
      options: statusValues
        .filter((value) => kind !== 'project' || value !== 'published' || rows.some((row) => row.status === value))
        .map((value) => ({ value, label: statusLabel(value) })),
    },
  ];
  const types = [...new Set(rows.flatMap((row) => (row.type ? [row.type] : [])))].sort();
  if (kind !== 'project' && types.length > 1) {
    filters.push({ param: 'type', label: t('type'), options: types.map((value) => ({ value, label: typeLabel(value) })) });
  }
  if (kind === 'project') {
    filters.push({
      param: 'approval',
      label: t('approval'),
      options: [
        { value: 'approved', label: area('approval.approved') },
        { value: 'pending', label: area('approval.pending') },
      ],
    });
  }

  function statusLabel(value: string): string {
    if (kind === 'project') return area.has(`status.${value}`) ? area(`status.${value}`) : value;
    return area.has(`statuses.${value}`) ? area(`statuses.${value}`) : value;
  }

  const filtered = useMemo(() => {
    const query = normalize(values.q?.trim() ?? '');
    return rows.filter((row) => {
      if (values.status && row.status !== values.status) return false;
      if (values.type && row.type !== values.type) return false;
      if (values.approval && (values.approval === 'approved') !== Boolean(row.approved)) return false;
      if (!query) return true;
      return [row.title ?? '', row.id, row.secondary ?? ''].some((part) => normalize(part).includes(query));
    });
  }, [rows, values]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / CLIENT_PAGE_SIZE));
  const currentClientPage = Math.min(clientPage, pageCount);
  const visible = serverPaged ? filtered : filtered.slice((currentClientPage - 1) * CLIENT_PAGE_SIZE, currentClientPage * CLIENT_PAGE_SIZE);

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setNotice(t('copied', { id }));
    } catch {
      setNotice(t('copyError'));
    }
  }

  const footer = serverPaged ? (
    <DataPagination mode="hasMore" page={page} hasMore={hasMore} hrefForPage={(target) => (target > 1 ? `${ROUTE[kind]}?page=${target}` : ROUTE[kind])} />
  ) : rows.length > 0 ? (
    <DataPagination mode="page" page={currentClientPage} pageSize={CLIENT_PAGE_SIZE} total={filtered.length} onPageChange={setClientPage} />
  ) : null;

  // An empty page 2+ (page 1 was exactly full, or ?page= is past the end) is not an empty library.
  const pastEnd = rows.length === 0 && page > 1;
  const noRows = rows.length === 0 && !pastEnd;
  return (
    <DataCard
      title={t(`titles.${kind}`)}
      description={serverPaged ? t('pageNote') : undefined}
      toolbar={noRows || pastEnd ? undefined : (
        <DataToolbar
          values={values}
          onValuesChange={(next) => { setValues(next); setClientPage(1); }}
          searchLabel={t('search')}
          searchPlaceholder={t('search')}
          filters={filters}
        />
      )}
      footer={footer}
    >
      <p role="status" aria-live="polite" className="sr-only">{notice}</p>
      {pastEnd ? (
        <div className="p-6">
          <EmptyState
            title={t('pastEnd')}
            action={<Button asChild variant="outline"><Link href={ROUTE[kind]}>{t('backToFirst')}</Link></Button>}
          />
        </div>
      ) : noRows ? (
        <div className="p-6">
          <EmptyState icon={<FileTextIcon />} title={area('empty')} action={emptyAction} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-6">
          <EmptyState title={t('noMatches')} />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">{t('columns.title')}</TableHead>
              {kind !== 'project' ? <TableHead scope="col" className="hidden md:table-cell">{t('columns.type')}</TableHead> : null}
              <TableHead scope="col">{t('columns.status')}</TableHead>
              {kind === 'project' ? <TableHead scope="col" className="hidden sm:table-cell">{t('columns.approval')}</TableHead> : null}
              <TableHead scope="col" className="hidden lg:table-cell">{t('columns.updated')}</TableHead>
              <TableHead scope="col" className="w-12"><span className="sr-only">{t('columns.actions')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const title = titleOf(row);
              const href = `${ROUTE[kind]}/${encodeURIComponent(row.id)}`;
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-0 min-w-48 py-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={href}
                        aria-label={kind === 'project' ? area('open', { project: title }) : undefined}
                        className="truncate font-medium leading-normal underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {title}
                      </Link>
                      <span className="truncate text-xs leading-normal text-muted-foreground">{row.secondary ?? row.id}</span>
                    </div>
                  </TableCell>
                  {kind !== 'project' ? (
                    <TableCell className="hidden text-muted-foreground md:table-cell">{row.type ? typeLabel(row.type) : '—'}</TableCell>
                  ) : null}
                  <TableCell>
                    <StatusBadge kind={statusKind} value={row.status} label={statusLabel(row.status)} />
                  </TableCell>
                  {kind === 'project' ? (
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge
                        kind="review"
                        value={row.approved ? 'approved' : 'pending'}
                        tone={row.approved ? 'success' : 'warning'}
                        label={area(row.approved ? 'approval.approved' : 'approval.pending')}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground lg:table-cell">
                    {row.updatedAt ? format.dateTime(new Date(row.updatedAt), { dateStyle: 'medium' }) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      label={t('actionsFor', { title })}
                      items={[
                        { label: t('edit'), href },
                        { label: t('copyId'), onSelect: () => copyId(row.id) },
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
