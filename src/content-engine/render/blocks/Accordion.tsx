'use client';
import { useState } from 'react';
import type { AccordionBlock, LessonBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { BlockList } from '../BlockList';
import { asText } from '../text';
import { useSectionTag } from '../render-context';
export function Accordion({ block, runtime, path, depth }: BlockRendererProps<AccordionBlock<LessonBlock>>) {
  const Title = useSectionTag();
  const [open, setOpen] = useState<string[]>(runtime.getBlockState<{ open: string[] }>(block.id)?.open ?? []);
  const toggle = (id: string) => { const next = open.includes(id) ? open.filter((x) => x !== id) : block.allowMultipleOpen ? [...open, id] : [id]; setOpen(next); runtime.setBlockState(block.id, { open: next }); };
  return (
    <div className={depth > 0 ? 'divide-y divide-border border-y border-border' : 'divide-y divide-border rounded-lg border border-border bg-card'}>
      {block.items.map((it, i) => { const isOpen = open.includes(it.id); return (
        <div key={it.id}>
          <Title><button type="button" aria-expanded={isOpen} aria-controls={`${block.id}-${it.id}`} onClick={() => toggle(it.id)} className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left font-medium hover:bg-muted">{asText(it.title)}<span aria-hidden="true" className="text-muted-foreground">{isOpen ? '−' : '+'}</span></button></Title>
          {isOpen ? <div id={`${block.id}-${it.id}`} className="px-4 pb-4"><BlockList blocks={it.blocks} runtime={runtime} path={`${path}/items/${i}/blocks`} depth={depth + 1} /></div> : null}
        </div>); })}
    </div>
  );
}
