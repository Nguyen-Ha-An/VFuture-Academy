import { createElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/ui-cn';

/** The tones the insight components share: the StatusTone vocabulary in status-tones.ts and the Badge variant names. */
export type InsightTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'outline';

export const insightToneClasses: Record<InsightTone, string> = {
  success: 'border-success-border bg-success text-success-foreground',
  info: 'border-info-border bg-info text-info-foreground',
  warning: 'border-warning-border bg-warning text-warning-foreground',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive-soft-foreground',
  neutral: 'border-border bg-muted text-muted-foreground',
  outline: 'border-border bg-card text-muted-foreground',
};

export type PipelineStage = {
  key: string;
  label: string;
  /** null reads as unavailable, never 0. */
  count: number | null;
  tone?: InsightTone;
  href?: string;
  icon?: LucideIcon | ReactElement;
};

export type PipelineStripProps = {
  stages: readonly PipelineStage[];
  title?: string;
  description?: string;
  /** Accessible name for the ordered list; defaults to the title. */
  label?: string;
  actions?: ReactNode;
  unavailableLabel?: string;
  className?: string;
};

// Ordered status distribution (review states, waiting to grade): circle, count, label.
// Circles stay neutral zinc: DESIGN.md keeps semantic colour for status pills, trend deltas and
// destructive actions, so the label carries the meaning. `tone` is kept as a data attribute.
export function PipelineStrip({ stages, title, description, label, actions, unavailableLabel, className }: PipelineStripProps) {
  const t = useTranslations('staffUi.insights');
  const format = useFormatter();
  const titleId = useId();
  return <section
    data-slot="pipeline-strip"
    aria-labelledby={title ? titleId : undefined}
    className={cn('flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}
  >
    {title || actions ? <div className="flex flex-wrap items-start justify-between gap-3">
      {title ? <div className="flex min-w-0 flex-col gap-1">
        <h2 id={titleId} className="text-sm font-medium leading-snug">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div> : null}
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div> : null}
    <ol aria-label={label ?? title ?? t('pipeline.label')} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none lg:gap-0 lg:divide-x lg:divide-border">
      {stages.map((stage) => {
        const icon = stage.icon ? (isValidElement(stage.icon) ? stage.icon : createElement(stage.icon, { className: 'size-4', 'aria-hidden': true })) : null;
        const body = <>
          <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-full border [&>svg]:size-4', insightToneClasses.neutral)}>
            {icon ?? <span className="size-2 rounded-full bg-current" />}
          </span>
          <span className="flex min-w-0 flex-col">
            {stage.count === null
              ? <span className="text-sm font-medium leading-7 text-muted-foreground">{unavailableLabel ?? t('unavailable')}</span>
              : <span className="text-xl font-bold leading-7 tracking-tight tabular-nums">{format.number(stage.count)}</span>}
            <span className="text-sm leading-snug text-muted-foreground">{stage.label}</span>
          </span>
        </>;
        return <li key={stage.key} data-stage={stage.key} data-tone={stage.tone ?? 'neutral'} className="min-w-0 lg:px-4 lg:first:pl-0 lg:last:pr-0">
          {stage.href
            ? <Link href={stage.href} className="-m-1 flex items-center gap-3 rounded-md p-1 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">{body}</Link>
            : <div className="flex items-center gap-3">{body}</div>}
        </li>;
      })}
    </ol>
  </section>;
}
