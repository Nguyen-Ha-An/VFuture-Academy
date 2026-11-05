'use client';

import type { ReactNode } from 'react';
import { CanvasResponsive, CanvasTable } from '@/features/canvas/ui';

/** Keep every column available on narrow screens using InstUI's labelled stacked rows. */
export function StudioResponsiveTable({ caption, children }: { caption: string; children: ReactNode }) {
  return <CanvasResponsive match="element" query={{ narrow: { maxWidth: '47.99rem' }, wide: { minWidth: '48rem' } }} render={(_props, matches) => <CanvasTable caption={() => caption} layout={matches?.includes('narrow') ? 'stacked' : 'auto'} hover>{children}</CanvasTable>} />;
}
