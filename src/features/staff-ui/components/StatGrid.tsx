import { Children, type ComponentProps } from 'react';
import { cn } from '@/lib/ui-cn';

export type StatGridProps = ComponentProps<'dl'>;

// KPI row: two columns from the smallest phone (values are short), four from 1280px, or
// three when there are exactly three cards so no slot stays empty. Children are StatCards.
export function StatGrid({ className, children, ...props }: StatGridProps) {
  const count = Children.toArray(children).length;
  return <dl data-slot="stat-grid" className={cn('grid grid-cols-2 gap-3 sm:gap-4', count === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4', className)} {...props}>{children}</dl>;
}
