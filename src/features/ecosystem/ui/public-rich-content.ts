import type { ContentBlock, RichContent } from '@/content-engine/schema/types';

function publicBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const transformed = blocks.map((block): ContentBlock => {
    if (block.type === 'heading' && block.level === 1) return { ...block, level: 2 };
    // Callouts are the recursive container allowed by the RichContent schema.
    if (block.type === 'callout') {
      const children = publicBlocks(block.blocks);
      return children === block.blocks ? block : { ...block, blocks: children };
    }
    return block;
  });
  return transformed.every((block, index) => block === blocks[index]) ? blocks : transformed;
}

/** The surrounding public page owns h1; preserve author content and anchor IDs. */
export function publicRichContentHeadings(content: RichContent): RichContent {
  const blocks = publicBlocks(content.blocks);
  return blocks === content.blocks ? content : { ...content, blocks };
}
