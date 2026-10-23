import { useId, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/ui-cn';
import type { InsightTone } from './PipelineStrip';

export type TimelineItem = {
  id: string;
  title: string;
  status: { tone: InsightTone; label: string };
  description?: ReactNode;
  /** ISO timestamp; an unparseable value is left out rather than shown as a wrong date. */
  at?: string | null;
  actor?: string | null;
};

export type TimelineCardProps = {
  items: readonly TimelineItem[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  actions?: ReactNode;
  /** h2 by default; 3 when the card sits under another h2 (a tab inside a preview section). */
  headingLevel?: 2 | 3;
  className?: string;
};

const dotClasses: Record<InsightTone, string> = {
  success: 'bg-success-foreground',
  info: 'bg-info-foreground',
  warning: 'bg-warning-foreground',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
  outline: 'border-2 border-muted-foreground bg-card',
};

// Review and member history: a vertical line of events, each with a state pill.
export function TimelineCard({ items, title, description, emptyLabel, actions, headingLevel = 2, className }: TimelineCardProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const t = useTranslations('staffUi.insights.timeline');
  const format = useFormatter();
  const titleId = useId();
  return <section data-slot="timeline-card" aria-labelledby={titleId} className={cn('flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={titleId} className="text-sm font-medium leading-snug">{title ?? t('title')}</Heading>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {items.length ? <ol className="flex flex-col">
      {items.map((item, index) => {
        const date = item.at ? new Date(item.at) : null;
        const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
        const last = index === items.length - 1;
        return <li key={item.id} className="relative flex gap-3 pb-6 last:pb-0">
          {!last ? <span aria-hidden="true" className="absolute left-[5px] top-5 bottom-1 w-px bg-border" /> : null}
          <span aria-hidden="true" className={cn('relative mt-1.5 size-[11px] shrink-0 rounded-full', dotClasses[item.status.tone])} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 break-words text-sm font-medium leading-snug">{item.title}</p>
              <Badge variant={item.status.tone}>{item.status.label}</Badge>
            </div>
            {item.description ? <div className="break-words text-sm text-muted-foreground">{item.description}</div> : null}
            {validDate || item.actor ? <p className="text-xs text-muted-foreground">
              {validDate ? <time dateTime={item.at ?? undefined} className="tabular-nums">{format.dateTime(validDate, { dateStyle: 'medium', timeStyle: 'short' })}</time> : null}
              {validDate && item.actor ? ' · ' : null}
              {item.actor ? t('by', { actor: item.actor }) : null}
            </p> : null}
          </div>
        </li>;
      })}
    </ol> : <p className="text-sm text-muted-foreground">{emptyLabel ?? t('empty')}</p>}
  </section>;
}
