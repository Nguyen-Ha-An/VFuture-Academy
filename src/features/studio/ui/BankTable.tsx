'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { CanvasButton as Button } from '@/features/canvas/ui';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { CanvasTable } from '@/features/canvas/ui';
import { StudioResponsiveTable } from './StudioResponsiveTable';
import { authoringFieldLabel } from '@/features/studio/authoring-labels';
import { QUESTION_TYPES } from '@/content-engine/schema/questions';
import { DataCard, DataPagination, EmptyState, StatusBadge } from '@/features/staff-ui/components';

export type BankListItem = {
  id: string;
  type: string;
  tags: string[];
  difficulty: string | null;
  status: string;
  usages: ReadonlyArray<{ versionId: string; itemId: string; courseId: string }>;
};

export type BankTableFilters = {
  types?: string[];
  tags?: string[];
  difficulties?: string[];
  status?: 'draft' | 'published' | 'archived';
  page?: number;
};

/** The bank service returns at most this many rows per page. */
const BANK_PAGE_SIZE = 50;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const STATUSES = ['draft', 'published', 'archived'] as const;

function pageHref(filters: BankTableFilters, page: number): string {
  const params = new URLSearchParams();
  for (const value of filters.types ?? []) params.append('type', value);
  for (const value of filters.tags ?? []) params.append('tags', value);
  for (const value of filters.difficulties ?? []) params.append('difficulty', value);
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(page));
  return `/studio/bank?${params.toString()}`;
}

/**
 * Question bank table. Filtering stays a plain GET form so the server does the work
 * (and the URL keeps the filters); it sits in the data card toolbar. Paging is "Page n"
 * because the service only knows whether a full page came back.
 */
export function BankTable({ questions, filters }: { questions: BankListItem[]; filters: BankTableFilters }) {
  const t = useTranslations('studio.bank');
  const locale = useLocale() === 'vi' ? 'vi' : 'en';
  const questionTypeLabel = (value: string) => (QUESTION_TYPES as readonly string[]).includes(value) ? authoringFieldLabel(value, locale) : value;
  const review = useTranslations('studioReview.bank');
  const content = useTranslations('staffUi.studio.content.bank');
  const page = filters.page ?? 1;
  const hasMore = questions.length === BANK_PAGE_SIZE;

  const toolbar = (
    <form action="/studio/bank" method="get" aria-label={content('filtersLabel')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor="bank-type-filter">{t('filters.type')}</label>
        <NativeSelect id="bank-type-filter" name="type" defaultValue={filters.types?.[0] ?? 'all'} wrapperClassName="w-full">
          <NativeSelectOption value="all">{t('filters.allTypes')}</NativeSelectOption>
          {QUESTION_TYPES.map((value) => <NativeSelectOption key={value} value={value}>{questionTypeLabel(value)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor="bank-tag-filter">{t('filters.tag')}</label>
        <Input id="bank-tag-filter" name="tags" defaultValue={filters.tags?.[0] ?? ''} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor="bank-difficulty-filter">{t('filters.difficulty')}</label>
        <NativeSelect id="bank-difficulty-filter" name="difficulty" defaultValue={filters.difficulties?.[0] ?? 'all'} wrapperClassName="w-full">
          <NativeSelectOption value="all">{t('filters.allDifficulties')}</NativeSelectOption>
          {DIFFICULTIES.map((value) => <NativeSelectOption key={value} value={value}>{t(`difficulty.${value}`)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor="bank-status-filter">{t('filters.status')}</label>
        <NativeSelect id="bank-status-filter" name="status" defaultValue={filters.status ?? 'all'} wrapperClassName="w-full">
          <NativeSelectOption value="all">{t('filters.allStatuses')}</NativeSelectOption>
          {STATUSES.map((value) => <NativeSelectOption key={value} value={value}>{t(`status.${value}`)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline">{review('applyFilters')}</Button>
    </form>
  );

  const footer = page > 1 || hasMore ? (
    <DataPagination
      mode="hasMore"
      page={page}
      hasMore={hasMore}
      label={review('paginationLabel')}
      labels={{ previous: review('previousPage'), next: review('nextPage') }}
      hrefForPage={(target) => pageHref(filters, target)}
    />
  ) : null;

  return (
    <DataCard title={content('title')} toolbar={toolbar} footer={footer}>
      {questions.length === 0 ? (
        <div className="p-6"><EmptyState title={t('emptyFiltered')} /></div>
      ) : (
        <StudioResponsiveTable caption={content('title')}>
          <CanvasTable.Head>
            <CanvasTable.Row className="hover:bg-transparent">
              <CanvasTable.ColHeader id="bank-column-1" scope="col">{t('table.id')}</CanvasTable.ColHeader>
              <CanvasTable.ColHeader id="bank-column-2" scope="col" className="">{t('table.type')}</CanvasTable.ColHeader>
              <CanvasTable.ColHeader id="bank-column-3" scope="col" className="">{t('table.tags')}</CanvasTable.ColHeader>
              <CanvasTable.ColHeader id="bank-column-4" scope="col" className="">{t('table.difficulty')}</CanvasTable.ColHeader>
              <CanvasTable.ColHeader id="bank-column-5" scope="col">{t('table.status')}</CanvasTable.ColHeader>
              <CanvasTable.ColHeader textAlign="end" id="bank-column-6" scope="col" className="text-right">{t('table.usages')}</CanvasTable.ColHeader>
            </CanvasTable.Row>
          </CanvasTable.Head>
          <CanvasTable.Body>
            {questions.map((question) => {
              const knownStatus = (STATUSES as readonly string[]).includes(question.status);
              const knownDifficulty = question.difficulty !== null && (DIFFICULTIES as readonly string[]).includes(question.difficulty);
              return (
                <CanvasTable.Row key={question.id} className="align-top">
                  <CanvasTable.Cell className="py-3">
                    <Link href={`/studio/bank/${encodeURIComponent(question.id)}`} className="break-all font-medium leading-normal underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{question.id}</Link>
                  </CanvasTable.Cell>
                  <CanvasTable.Cell className="py-3 text-muted-foreground">{questionTypeLabel(question.type)}</CanvasTable.Cell>
                  <CanvasTable.Cell className="py-3">
                    <div className="flex max-w-xs flex-wrap gap-1">{question.tags.map((value) => <Badge key={value} variant="neutral">{value}</Badge>)}</div>
                  </CanvasTable.Cell>
                  <CanvasTable.Cell className="py-3 text-muted-foreground">{knownDifficulty ? t(`difficulty.${question.difficulty}`) : '—'}</CanvasTable.Cell>
                  <CanvasTable.Cell className="py-3">
                    <StatusBadge kind="content" value={question.status} label={knownStatus ? t(`status.${question.status}`) : question.status} />
                  </CanvasTable.Cell>
                  <CanvasTable.Cell textAlign="end" className="py-3 text-right">
                    <span className="tabular-nums">{question.usages.length}</span>
                    {question.usages.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-1 text-xs leading-normal">
                        {question.usages.map((usage) => (
                          <li key={`${usage.versionId}-${usage.itemId}`}>
                            <Link className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/studio/courses/${encodeURIComponent(usage.courseId)}#workspace-editor`}>
                              {t('usageDestination', { courseId: usage.courseId, itemId: usage.itemId })}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CanvasTable.Cell>
                </CanvasTable.Row>
              );
            })}
          </CanvasTable.Body>
        </StudioResponsiveTable>
      )}
    </DataCard>
  );
}
