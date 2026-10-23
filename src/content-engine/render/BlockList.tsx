import type { LessonBlock } from '../schema/types';
import type { LessonRuntime } from './runtime';
import { blockRegistry, UnavailableBlock } from './registry';

export function BlockList({ blocks, runtime, path, depth }: { blocks: LessonBlock[]; runtime: LessonRuntime; path: string; depth: number }) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        const C = blockRegistry[block.type];
        const key = ('id' in block && block.id) || `${path}/${i}`;
        return C ? <C key={key} block={block as never} runtime={runtime} path={`${path}/${i}`} depth={depth} /> : <UnavailableBlock key={key} type={block.type} locale={runtime.locale} />;
      })}
    </div>
  );
}
