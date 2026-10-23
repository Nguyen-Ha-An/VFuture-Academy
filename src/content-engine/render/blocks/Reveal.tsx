'use client';
import { useState } from 'react';
import type { RevealBlock, LessonBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { BlockList } from '../BlockList';
import { asText } from '../text';
import { blockFrame } from '../tone';
export function Reveal({ block, runtime, path, depth }: BlockRendererProps<RevealBlock<LessonBlock>>) {
  const [open, setOpen] = useState(!!runtime.getBlockState<{ opened: boolean }>(block.id)?.opened);
  return open ? <div className={blockFrame(depth)}><BlockList blocks={block.blocks} runtime={runtime} path={`${path}/blocks`} depth={depth + 1} /></div>
    : <button type="button" onClick={() => { setOpen(true); runtime.setBlockState(block.id, { opened: true }); }} className="min-h-11 rounded-md border border-dashed border-input px-4 py-3 text-left font-medium hover:bg-muted">{asText(block.label)}</button>;
}
