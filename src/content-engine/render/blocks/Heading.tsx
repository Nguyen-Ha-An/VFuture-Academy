'use client';
import type { HeadingBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichText } from '../RichText';
import { useHeadingTag } from '../render-context';
import { alignClass } from './Paragraph';
/** Sized by the rendered level (DESIGN.md scale), so a demoted heading never outranks the page title. */
const sizeFor = (tag: string) => (tag === 'h1' || tag === 'h2' ? 'text-[28px] leading-tight tracking-[-0.02em]' : tag === 'h3' ? 'text-xl leading-snug tracking-[-0.01em]' : 'text-base leading-snug');
export function Heading({ block }: BlockRendererProps<HeadingBlock>) {
  const Tag = useHeadingTag(block.level);
  return <Tag id={block.id} className={`font-medium ${sizeFor(Tag)} ${alignClass(block.align)}`}><RichText runs={block.content} /></Tag>;
}
