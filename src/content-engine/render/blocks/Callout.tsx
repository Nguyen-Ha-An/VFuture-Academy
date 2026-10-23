import { useId } from 'react';
import type { CalloutBlock, LessonBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { BlockList } from '../BlockList';
import { asText } from '../text';
import { calloutTone } from '../tone';
export function Callout({ block, runtime, path, depth }: BlockRendererProps<CalloutBlock<LessonBlock>>) {
  const id = useId();
  return (
    <aside role="note" aria-labelledby={block.title ? id : undefined} data-variant={block.variant} className={`rounded-md border-l-4 p-4 ${calloutTone(block.variant)}`}>
      {block.title ? <p id={id} className="mb-2 font-semibold">{asText(block.title)}</p> : null}
      <BlockList blocks={block.blocks} runtime={runtime} path={`${path}/blocks`} depth={depth + 1} />
    </aside>
  );
}
