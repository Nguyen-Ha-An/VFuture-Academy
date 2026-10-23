import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/ui-cn';

export type StatDelta = {
  value: number;
  /** '%' renders "12%"; 'abs' (default) renders the plain count. */
  unit?: '%' | 'abs';
  /** Comparison window, e.g. "vs previous 30 days". */
  label?: string;
  /** Which direction is good news; waiting counts improve downwards. */
  goodDirection?: 'up' | 'down';
};

export type StatCardProps = {
  label: string;
  /** A number is formatted for the locale; null or undefined reads as unavailable, never 0. */
  value?: number | string | null;
  /** A lucide icon component or element, shown muted in the top-right corner. */
  icon?: LucideIcon | ReactElement;
  hint?: ReactNode;
  /** Rendered only when given: a delta needs a previous value with the same source and window. */
  delta?: StatDelta;
  /** Makes the whole card a link (stretched over the card, focus ring on the card). */
  href?: string;
  state?: 'ready' | 'unavailable';
  unavailableLabel?: string;
  className?: string;
};

// One KPI: <dt> label, <dd> value, inside the <dl> that StatGrid renders.
// Shared (no "use client") so server pages can render it directly.
export function StatCard({ label, value, icon, hint, delta, href, state = 'ready', unavailableLabel, className }: StatCardProps) {
  const t = useTranslations('staffUi.insights');
  const format = useFormatter();
  const unavailable = state === 'unavailable' || value === null || value === undefined;
  const iconNode = icon ? (isValidElement(icon) ? icon : createElement(icon, { className: 'size-4', 'aria-hidden': true })) : null;
  return <div
    data-slot="stat-card"
    data-state={unavailable ? 'unavailable' : 'ready'}
    className={cn('relative flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6', href && 'transition-colors hover:bg-accent/50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background motion-reduce:transition-none', className)}
  >
    {/* dt and dd stay direct children of this card div (valid dl grouping), so the icon lives inside the dt. */}
    <dt className="flex items-start justify-between gap-3 text-sm font-medium leading-normal">
      <span className="min-w-0">
        {href ? <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']">{label}</Link> : label}
      </span>
      {iconNode ? <span aria-hidden="true" className="shrink-0 text-muted-foreground [&>svg]:size-4">{iconNode}</span> : null}
    </dt>
    <dd className="flex min-w-0 flex-col gap-1">
      {unavailable
        ? <span className="text-sm font-medium leading-normal text-muted-foreground">{unavailableLabel ?? t('unavailable')}</span>
        : <span className="break-words text-2xl font-bold leading-[1.4] tracking-tight tabular-nums">{typeof value === 'number' ? format.number(value) : value}</span>}
      {!unavailable && delta ? <StatDeltaLine delta={delta} /> : null}
      {hint ? <span className="text-xs leading-normal text-muted-foreground">{hint}</span> : null}
    </dd>
  </div>;
}

function StatDeltaLine({ delta }: { delta: StatDelta }) {
  const t = useTranslations('staffUi.insights.stat');
  const format = useFormatter();
  const { value, unit = 'abs', label, goodDirection = 'up' } = delta;
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const magnitude = `${format.number(Math.abs(value), { maximumFractionDigits: 1 })}${unit === '%' ? '%' : ''}`;
  const good = direction !== 'flat' && direction === goodDirection;
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const spoken = direction === 'flat' ? t('flat') : t(direction, { value: magnitude });
  return <span data-slot="stat-delta" data-direction={direction} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-normal">
    <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', direction === 'flat' ? 'text-muted-foreground' : good ? 'text-success-foreground' : 'text-destructive')}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">{direction === 'up' ? '+' : direction === 'down' ? '−' : ''}{magnitude}</span>
      <span className="sr-only">{spoken}</span>
    </span>
    {label ? <span className="text-muted-foreground">{label}</span> : null}
  </span>;
}
