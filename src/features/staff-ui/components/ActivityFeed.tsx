import { useId } from 'react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/ui-cn';

export type ActivityItem = {
  id: string;
  actor: { name: string; avatarUrl?: string | null };
  /** Already formatted, e.g. with formatStaffAuditAction from src/features/admin/audit-format.ts. */
  action: string;
  target?: string;
  href?: string;
  /** ISO timestamp. */
  at: string;
};

export type ActivityFeedProps = {
  items: readonly ActivityItem[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  footerHref?: string;
  footerLabel?: string;
  /** Fixed "now" for relative times (tests, server snapshots). */
  now?: Date;
  className?: string;
};

/** Up to two initials from the first and last word, safe for Vietnamese diacritics. */
export function actorInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return `${first}${last}`.toLocaleUpperCase();
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Audit and home activity: avatar, "actor action target", relative time with an absolute title.
export function ActivityFeed({ items, title, description, emptyLabel, footerHref, footerLabel, now, className }: ActivityFeedProps) {
  const t = useTranslations('staffUi.insights.activity');
  const format = useFormatter();
  const currentNow = useNow();
  const reference = now ?? currentNow;
  const titleId = useId();
  return <section data-slot="activity-feed" aria-labelledby={titleId} className={cn('flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}>
    <div className="flex flex-col gap-1">
      <h2 id={titleId} className="text-sm font-medium leading-snug">{title ?? t('title')}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {items.length ? <ul className="flex flex-col gap-4">
      {items.map((item) => {
        const at = parseDate(item.at);
        const target = item.target
          ? item.href
            ? <Link href={item.href} className="font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{item.target}</Link>
            : <span className="font-medium text-foreground">{item.target}</span>
          : null;
        const action = !item.target && item.href
          ? <Link href={item.href} className="underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{item.action}</Link>
          : item.action;
        return <li key={item.id} className="flex min-w-0 items-start gap-3">
          <Avatar className="size-8">
            {item.actor.avatarUrl ? <AvatarImage src={item.actor.avatarUrl} alt="" /> : null}
            <AvatarFallback aria-hidden="true">{actorInitials(item.actor.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="break-words text-sm leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">{item.actor.name}</span> {action}{target ? <> {target}</> : null}
            </p>
            {at ? <time dateTime={item.at} title={format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' })} suppressHydrationWarning className="text-xs text-muted-foreground tabular-nums">
              {format.relativeTime(at, reference)}
            </time> : null}
          </div>
        </li>;
      })}
    </ul> : <p className="text-sm text-muted-foreground">{emptyLabel ?? t('empty')}</p>}
    {footerHref ? <div className="border-t border-border pt-4">
      <Link href={footerHref} className="text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{footerLabel ?? t('viewAll')}</Link>
    </div> : null}
  </section>;
}
