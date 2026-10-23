'use client';
import type { RichContent, LessonBlock } from '../schema/types';
import type { LessonRuntime } from './runtime';
import { BlockList } from './BlockList';
import { useFrameDepth } from './render-context';
/** Without an explicit `depth`, the blocks take the surrounding `FrameScope` depth (0 outside one). */
export function RichContentView({ content, runtime, path = '/content', depth }: { content: RichContent | undefined; runtime: LessonRuntime; path?: string; depth?: number }) {
  const scoped = useFrameDepth();
  if (!content?.blocks?.length) return null;
  return <BlockList blocks={content.blocks as LessonBlock[]} runtime={runtime} path={`${path}/blocks`} depth={depth ?? scoped} />;
}
