import type { QuoteBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichText } from '../RichText';
import { asText } from '../text';
export function Quote({ block }: BlockRendererProps<QuoteBlock>) {
  return <blockquote className="border-l-4 border-border pl-4 italic text-foreground"><p><RichText runs={block.content} /></p>{block.author ? <footer className="mt-1 text-sm not-italic text-muted-foreground">— <cite>{asText(block.author)}</cite></footer> : null}</blockquote>;
}
