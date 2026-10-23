"use client";

import { useState } from 'react';
import { File, FileAudio, FileImage, FileText, FileType, FileVideo, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/ui-cn';
import type { InsightTone } from './PipelineStrip';

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'other';

export type FileGridItem = {
  id: string;
  name: string;
  kind: FileKind;
  thumbnailUrl?: string | null;
  /** Already formatted, e.g. "PNG · 240 KB". */
  meta?: string;
  status?: { tone: InsightTone; label: string };
};

export type FileGridProps = {
  items: readonly FileGridItem[];
  view?: 'grid' | 'list';
  selectable?: boolean;
  /** Controlled selection; leave out to let the grid keep its own. */
  selectedIds?: readonly string[];
  defaultSelectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  onOpen?: (item: FileGridItem) => void;
  /** Accessible name of the list. */
  label?: string;
  emptyLabel?: string;
  selectLabel?: (item: FileGridItem) => string;
  openLabel?: (item: FileGridItem) => string;
  className?: string;
};

const kindIcons: Record<FileKind, LucideIcon> = { image: FileImage, video: FileVideo, audio: FileAudio, pdf: FileType, doc: FileText, other: File };

// Media library tiles (Catmin file manager): type icon or thumbnail, name, meta,
// optional status pill, a selection checkbox and an open action.
export function FileGrid({
  items, view = 'grid', selectable = false, selectedIds, defaultSelectedIds, onSelectionChange, onOpen, label, emptyLabel, selectLabel, openLabel, className,
}: FileGridProps) {
  const t = useTranslations('staffUi.insights.files');
  const [ownSelection, setOwnSelection] = useState<readonly string[]>(defaultSelectedIds ?? []);
  const selection = selectedIds ?? ownSelection;
  const selected = new Set(selection);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selection.filter((value) => value !== id), id] : selection.filter((value) => value !== id);
    if (!selectedIds) setOwnSelection(next);
    onSelectionChange?.(next);
  };

  if (!items.length) return <p className={cn('rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground', className)}>{emptyLabel ?? t('empty')}</p>;

  const grid = view === 'grid';
  return <div data-slot="file-grid" className={cn('flex flex-col gap-2', className)}>
    <ul aria-label={label ?? t('label')} data-view={view} className={grid ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col divide-y divide-border rounded-lg border border-border bg-card'}>
      {items.map((item) => {
        const Icon = kindIcons[item.kind];
        const isSelected = selected.has(item.id);
        const preview = item.thumbnailUrl && item.kind === 'image'
          // Thumbnails come from signed storage URLs of any size, so next/image's loader does not apply.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
          : <Icon className={grid ? 'size-8' : 'size-5'} aria-hidden="true" />;
        const body = <>
          <span className={cn('grid shrink-0 place-items-center overflow-hidden bg-muted text-muted-foreground', grid ? 'aspect-[4/3] w-full rounded-md' : 'size-10 rounded-md')}>{preview}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
            <span className="truncate text-sm font-medium leading-normal">{item.name}</span>
            <span className="truncate text-xs leading-normal text-muted-foreground">{item.meta ?? t(`kind.${item.kind}`)}</span>
          </span>
        </>;
        return <li
          key={item.id}
          data-selected={isSelected || undefined}
          className={cn(
            'relative flex min-w-0 gap-3',
            grid ? 'flex-col rounded-lg border border-border bg-card p-3' : 'items-center px-4 py-3',
            grid && isSelected && 'border-primary bg-accent',
            !grid && isSelected && 'bg-accent',
          )}
        >
          {selectable ? <Checkbox
            checked={isSelected}
            onChange={(event) => toggle(item.id, event.target.checked)}
            aria-label={selectLabel?.(item) ?? t('select', { name: item.name })}
            className={grid ? 'absolute left-4 top-4 z-10 bg-card' : undefined}
          /> : null}
          {onOpen
            ? <button type="button" onClick={() => onOpen(item)} aria-label={openLabel?.(item) ?? t('open', { name: item.name })} className={cn('flex min-w-0 flex-1 gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', grid ? 'flex-col' : 'items-center')}>{body}</button>
            : <div className={cn('flex min-w-0 flex-1 gap-3', grid ? 'flex-col' : 'items-center')}>{body}</div>}
          {item.status ? <Badge variant={item.status.tone} className={grid ? 'h-auto min-h-[22px] max-w-full self-start whitespace-normal text-left' : 'max-w-full whitespace-normal text-left'}>{item.status.label}</Badge> : null}
        </li>;
      })}
    </ul>
    {selectable ? <p role="status" className="min-h-4 text-xs text-muted-foreground tabular-nums">{selection.length ? t('selected', { count: selection.length }) : null}</p> : null}
  </div>;
}
