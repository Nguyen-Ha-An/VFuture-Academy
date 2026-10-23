import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import { CircleCheck, CircleDashed, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/ui-cn';

/** 'unverified': an automatic check waiting on a current report; 'manual': a person must confirm it. */
export type ReadinessStatus = 'pass' | 'fail' | 'warn' | 'manual' | 'unverified';

export type ReadinessItem = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail?: ReactNode;
  href?: string;
};

export type ReadinessCardProps = {
  items: readonly ReadinessItem[];
  title?: string;
  description?: string;
  /** Overrides the passing count; defaults to the items whose status is 'pass'. */
  done?: number;
  /** Overrides the total; defaults to the number of items. */
  total?: number;
  statusLabels?: Partial<Record<ReadinessStatus, string>>;
  footer?: ReactNode;
  /** h2 by default; 3 when the card sits under another h2 (e.g. a sheet title). */
  headingLevel?: 2 | 3;
  className?: string;
};

const statusIcons = { pass: CircleCheck, fail: CircleX, warn: TriangleAlert, manual: CircleDashed, unverified: CircleHelp } as const;
const statusColors: Record<ReadinessStatus, string> = {
  pass: 'text-success-foreground',
  fail: 'text-destructive',
  warn: 'text-warning-foreground',
  manual: 'text-muted-foreground',
  unverified: 'text-muted-foreground',
};

// Publish readiness (Catmin "profile completion"): n/total progress and a checklist.
export function ReadinessCard({ items, title, description, done, total, statusLabels, footer, headingLevel = 2, className }: ReadinessCardProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const t = useTranslations('staffUi.insights.readiness');
  const titleId = useId();
  const passing = done ?? items.filter((item) => item.status === 'pass').length;
  const count = total ?? items.length;
  return <section data-slot="readiness-card" aria-labelledby={titleId} className={cn('flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}>
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Heading id={titleId} className="text-sm font-medium leading-snug">{title ?? t('title')}</Heading>
        <span aria-hidden="true" className="text-sm font-semibold tabular-nums">{t('count', { done: passing, total: count })}</span>
      </div>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
    <Progress value={passing} max={Math.max(count, 1)} aria-labelledby={titleId} aria-valuetext={t('progress', { done: passing, total: count })} />
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => {
        const Icon = statusIcons[item.status];
        const statusLabel = statusLabels?.[item.status] ?? t(`status.${item.status}`);
        const label = item.href
          ? <Link href={item.href} className="underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{item.label}</Link>
          : item.label;
        return <li key={item.id} data-status={item.status} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <Icon className={cn('mt-0.5 size-4 shrink-0', statusColors[item.status])} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="break-words text-sm font-medium leading-snug">{label}<span className="sr-only">: {statusLabel}</span></p>
            {item.detail ? <div className="break-words text-xs leading-snug text-muted-foreground">{item.detail}</div> : null}
          </div>
          <span aria-hidden="true" className={cn('shrink-0 text-xs font-semibold', statusColors[item.status])}>{statusLabel}</span>
        </li>;
      })}
    </ul>
    {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">{footer}</div> : null}
  </section>;
}
