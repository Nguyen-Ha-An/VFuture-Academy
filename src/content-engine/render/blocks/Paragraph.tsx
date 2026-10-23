import type { ParagraphBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichText } from '../RichText';
export const alignClass = (a?: string) => (a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : a === 'justify' ? 'text-justify' : 'text-left');
export function Paragraph({ block }: BlockRendererProps<ParagraphBlock>) {
  return <p className={`leading-7 ${alignClass(block.align)}`}><RichText runs={block.content} /></p>;
}
