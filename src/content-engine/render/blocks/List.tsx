import type { ListBlock, ListItem } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichText } from '../RichText';
function Items({ items, ordered }: { items: ListItem[]; ordered: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-6`}>{items.map((it, i) => <li key={i}><RichText runs={it.content} />{it.items?.length ? <Items items={it.items} ordered={ordered} /> : null}</li>)}</Tag>;
}
export function List({ block }: BlockRendererProps<ListBlock>) { return <Items items={block.items} ordered={block.ordered} />; }
