"use client";

import { useId, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/ui-cn';

// Recharts stays out of every page and shell bundle: the chart bodies are the
// only modules that import it (through src/components/ui/chart), and this card
// loads them on the client after hydration. Type-only imports from here are fine.
const AreaTrendChart = dynamic(() => import('./charts/AreaTrendChart'), { ssr: false, loading: ChartSkeleton });
const BarBreakdownChart = dynamic(() => import('./charts/BarBreakdownChart'), { ssr: false, loading: ChartSkeleton });

export type ChartSeries = {
  key: string;
  label: string;
  color?: string;
  /** Area charts: false draws a dashed line with no fill, so two close greys stay apart. */
  fill?: boolean;
};
export type ChartRow = Record<string, string | number | null | undefined>;
/** What the chart bodies receive: the formatted category in `label`, plus one number (or null) per series key. */
export type ChartDatum = { label: string } & Record<string, string | number | null>;
export type ChartBodyProps = {
  data: ChartDatum[];
  series: ChartSeries[];
  locale: string;
  stacked?: boolean;
  /** Bar charts only: 'rows' draws horizontal bars for rankings. */
  orientation?: 'columns' | 'rows';
};

export type ChartCardProps = {
  title: string;
  description?: string;
  /** Header slot, e.g. a range select. */
  actions?: ReactNode;
  footer?: ReactNode;
  kind: 'area' | 'bar';
  data: readonly ChartRow[];
  /** The row field that names each point or bar. */
  categoryKey: string;
  /** 'day' and 'month' read ISO dates in UTC (analytics days are UTC). */
  categoryFormat?: 'text' | 'day' | 'month';
  /** Header of the first column of the accessible table. */
  categoryLabel?: string;
  series: readonly ChartSeries[];
  stacked?: boolean;
  orientation?: 'columns' | 'rows';
  /** Fixed body height in px, so the card never jumps while the chart loads. */
  height?: number;
  state?: 'ready' | 'unavailable';
  emptyLabel?: string;
  unavailableLabel?: string;
  /** Caption of the screen-reader table; defaults to the title. */
  tableCaption?: string;
  className?: string;
};

/** Grayscale ramp by default; the staff tokens swap it for dark mode. */
export function seriesColor(series: ChartSeries, index: number) {
  return series.color ?? `var(--chart-${(index % 5) + 1})`;
}

function ChartSkeleton() {
  return <Skeleton data-slot="chart-skeleton" className="size-full rounded-md" />;
}

export function ChartCard({
  title, description, actions, footer, kind, data, categoryKey, categoryFormat = 'text', categoryLabel, series, stacked, orientation,
  height = 240, state = 'ready', emptyLabel, unavailableLabel, tableCaption, className,
}: ChartCardProps) {
  const t = useTranslations('staffUi.insights.chart');
  const format = useFormatter();
  const locale = useLocale();
  const titleId = useId();

  const formatCategory = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    if (categoryFormat === 'text') return String(value);
    const raw = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
    if (Number.isNaN(date.getTime())) return raw;
    return categoryFormat === 'day'
      ? format.dateTime(date, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      : format.dateTime(date, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const rows: ChartDatum[] = data.map((row) => {
    const datum: ChartDatum = { label: formatCategory(row[categoryKey]) };
    for (const item of series) {
      const value = row[item.key];
      datum[item.key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return datum;
  });
  const plainSeries = series.map((item, index) => ({ ...item, color: seriesColor(item, index) }));
  const Body = kind === 'area' ? AreaTrendChart : BarBreakdownChart;
  const message = state === 'unavailable' ? (unavailableLabel ?? t('unavailable')) : rows.length ? null : (emptyLabel ?? t('empty'));

  return <section data-slot="chart-card" aria-labelledby={titleId} className={cn('flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={titleId} className="text-sm font-medium leading-normal">{title}</h2>
        {description ? <p className="text-sm leading-normal text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {message
      ? <div className="grid place-items-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted-foreground" style={{ height }}>{message}</div>
      : <>
        <div data-slot="chart-body" aria-hidden="true" className="min-w-0" style={{ height }}>
          <Body data={rows} series={plainSeries} locale={locale} stacked={stacked} orientation={orientation} />
        </div>
        {/* A table ignores `width: 1px`, so the clipping wrapper keeps the hidden table from widening the page on phones. */}
        <div className="sr-only"><table className="sr-only">
          <caption>{tableCaption ?? title}</caption>
          <thead>
            <tr>
              <th scope="col">{categoryLabel ?? t('category')}</th>
              {plainSeries.map((item) => <th key={item.key} scope="col">{item.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => <tr key={`${row.label}-${index}`}>
              <th scope="row">{row.label}</th>
              {plainSeries.map((item) => {
                const value = row[item.key];
                return <td key={item.key}>{typeof value === 'number' ? format.number(value) : '—'}</td>;
              })}
            </tr>)}
          </tbody>
        </table></div>
      </>}
    {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
  </section>;
}
