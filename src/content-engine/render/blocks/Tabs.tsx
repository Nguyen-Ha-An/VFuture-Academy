'use client';
import { useState } from 'react';
import * as RTabs from '@radix-ui/react-tabs';
import type { TabsBlock, LessonBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { BlockList } from '../BlockList';
import { asText } from '../text';
import { engineStrings, tr } from '../strings';
import { tabListClass, tabTriggerClass } from '../tone';

/** ARIA tabs with roving focus and automatic activation; the active tab persists in block state. */
export function Tabs({ block, runtime, path, depth }: BlockRendererProps<TabsBlock<LessonBlock>>) {
  const [active, setActive] = useState(runtime.getBlockState<{ active: string }>(block.id)?.active ?? block.items[0].id);
  const select = (id: string) => { setActive(id); runtime.setBlockState(block.id, { active: id }); };
  const value = block.items.some((t) => t.id === active) ? active : block.items[0].id;
  return (
    <RTabs.Root value={value} onValueChange={select} activationMode="automatic" className={depth > 0 ? 'border-t border-border' : 'rounded-lg border border-border bg-card'}>
      <RTabs.List aria-label={tr(runtime.locale, engineStrings.tabs.label)} className={tabListClass}>
        {block.items.map((t) => <RTabs.Trigger key={t.id} value={t.id} className={tabTriggerClass}>{asText(t.title)}</RTabs.Trigger>)}
      </RTabs.List>
      {block.items.map((t, i) => <RTabs.Content key={t.id} value={t.id} className="p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><BlockList blocks={t.blocks} runtime={runtime} path={`${path}/items/${i}/blocks`} depth={depth + 1} /></RTabs.Content>)}
    </RTabs.Root>
  );
}
