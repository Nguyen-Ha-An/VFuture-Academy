import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/ui-cn';

export type SectionCardProps = {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions (save, cancel), right-aligned under a hairline. */
  footer?: ReactNode;
  /** Two columns from 768px by default; 1 keeps a single column. */
  columns?: 1 | 2;
  headingLevel?: 2 | 3;
  id?: string;
  className?: string;
  contentClassName?: string;
};

// Editor form section: heading and description, fields in a grid, optional footer actions.
export function SectionCard({ title, description, children, footer, columns = 2, headingLevel = 2, id, className, contentClassName }: SectionCardProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return <section id={id} data-slot="section-card" aria-labelledby={titleId} className={cn('flex flex-col rounded-lg border border-border bg-card text-card-foreground', className)}>
    <div className="flex flex-col gap-1 px-6 pt-6">
      <Heading id={titleId} className="text-sm font-medium leading-snug">{title}</Heading>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
    </div>
    {children ? <div className={cn('grid grid-cols-1 gap-6 p-6', columns === 2 && 'md:grid-cols-2', contentClassName)}>{children}</div> : <div className="pb-6" />}
    {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
  </section>;
}
