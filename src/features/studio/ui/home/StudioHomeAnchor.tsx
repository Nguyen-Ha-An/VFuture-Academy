import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataCard } from '@/features/staff-ui/components/DataCard';
import { EmptyState } from '@/features/staff-ui/components/EmptyState';
import { StatusBadge } from '@/features/staff-ui/components/StatusBadge';
import type { StudioHomeData, StudioOwner } from '@/features/studio/home-data';
import { STAGE_TONES } from './stages';

function formatDate(format: ReturnType<typeof useFormatter>, value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The home page's anchor list: reviewers see the oldest requests waiting for review, everyone else
 * the most recently updated content. Hidden when the actor can read neither.
 */
export function StudioHomeAnchor({ data }: { data: StudioHomeData }) {
  const t = useTranslations('staffUi.studio.home');
  const types = useTranslations('cmsAdmin.types');
  const format = useFormatter();
  const typeLabel = (type: string) => (types.has(type) ? types(type) : type);
  const ownerLabel = (owner: StudioOwner) => (owner.kind === 'central' ? t('central') : owner.name);
  const footerLink = (href: string | null, label: string) =>
    href ? (
      <Link href={href} className="text-sm font-medium leading-normal underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
        {label}
      </Link>
    ) : undefined;

  if (data.reviewer && data.reviews.state !== 'hidden') {
    const reviews = data.reviews;
    return (
      <DataCard title={t('waiting.title')} description={t('waiting.description')} footer={footerLink(data.reviewsHref, t('waiting.footer'))}>
        {reviews.state === 'unavailable' ? (
          <p className="px-6 py-8 text-sm leading-normal text-muted-foreground">{t('waiting.unavailable')}</p>
        ) : reviews.waiting.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t('waiting.empty')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('columns.content')}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{t('columns.owner')}</TableHead>
                <TableHead scope="col">{t('columns.submitted')}</TableHead>
                <TableHead scope="col">{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.waiting.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-72 whitespace-normal">
                    <p className="break-words font-medium leading-normal">{row.title}</p>
                    <p className="text-xs leading-normal text-muted-foreground">{typeLabel(row.contentType)}</p>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell">{ownerLabel(row.owner)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <p className="leading-normal tabular-nums">{formatDate(format, row.submittedAt) ?? '—'}</p>
                    {row.submitter ? <p className="text-xs leading-normal text-muted-foreground">{t('waiting.by', { name: row.submitter })}</p> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="review" value={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
    );
  }

  if (data.content.state === 'hidden') return null;
  const content = data.content;
  return (
    <DataCard title={t('recent.title')} description={t('recent.description')} footer={footerLink(data.libraryHref, t('recent.footer'))}>
      {content.state === 'unavailable' ? (
        <p className="px-6 py-8 text-sm leading-normal text-muted-foreground">{t('recent.unavailable')}</p>
      ) : content.recent.length === 0 ? (
        <div className="p-6">
          <EmptyState title={t('recent.empty')} />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('columns.content')}</TableHead>
              <TableHead scope="col">{t('columns.status')}</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">{t('columns.updated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {content.recent.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-80 whitespace-normal">
                  <Link href={row.href} className="break-words font-medium leading-normal underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
                    {row.title}
                  </Link>
                  <p className="text-xs leading-normal text-muted-foreground">{typeLabel(row.contentType)}</p>
                </TableCell>
                <TableCell>
                  {row.stage ? <StatusBadge kind="content" value={row.stage} label={t(`stages.${row.stage}`)} tone={STAGE_TONES[row.stage]} /> : <StatusBadge kind="content" value={row.status} />}
                </TableCell>
                <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">{formatDate(format, row.updatedAt) ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}
