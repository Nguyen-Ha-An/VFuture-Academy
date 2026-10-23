import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';

import { StatusBadge, type StatusKind } from '@/features/staff-ui/components';

export type EditorPageHeaderProps = {
  backHref: string;
  backLabel: string;
  title: string;
  eyebrow?: string;
  status?: { kind: StatusKind; value: string; label?: string };
  /** Right-aligned secondary facts, e.g. an interest count. */
  meta?: ReactNode;
};

/**
 * Header of a Studio record editor (resource, opportunity, project): back link, H1 and the
 * record's StatusBadge. The editor below owns the single save indicator.
 */
export function EditorPageHeader({ backHref, backLabel, title, eyebrow, status, meta }: EditorPageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm leading-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
        {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className="text-sm font-medium leading-normal text-muted-foreground">{eyebrow}</p> : null}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="break-words text-2xl font-bold leading-[1.4] tracking-tight">{title}</h1>
            {status ? <StatusBadge kind={status.kind} value={status.value} label={status.label} /> : null}
          </div>
        </div>
        {meta ? <div className="text-sm leading-normal text-muted-foreground">{meta}</div> : null}
      </div>
    </header>
  );
}
