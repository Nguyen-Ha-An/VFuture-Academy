import Link from 'next/link';

import { cn } from '@/lib/utils';

export type SegmentedItem = { key: string; label: string; href: string; current: boolean };

/** Link-based segmented control (catalog Learning/Discover, leaderboard scope). */
export function Segmented({ label, items, className }: { label: string; items: readonly SegmentedItem[]; className?: string }) {
  return <nav aria-label={label} className={cn('vf-seg', className)}>
    {items.map(item => <Link key={item.key} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</Link>)}
  </nav>;
}
