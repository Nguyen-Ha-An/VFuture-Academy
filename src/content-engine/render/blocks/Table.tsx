import type { TableBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichText } from '../RichText';
import { asText } from '../text';
import { alignClass } from './Paragraph';
export function Table({ block }: BlockRendererProps<TableBlock>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {block.caption ? <caption className="mb-2 text-left text-muted-foreground">{asText(block.caption)}</caption> : null}
        {block.headers ? <thead><tr>{block.headers.map((h, i) => <th key={i} scope="col" className={`border-b-2 border-border px-3 py-2 font-semibold ${alignClass(h.align)}`}><RichText runs={h.content} /></th>)}</tr></thead> : null}
        <tbody>{block.rows.map((row, r) => <tr key={r} className="odd:bg-muted">{row.map((c, i) => <td key={i} className={`border-b border-border px-3 py-2 align-top ${alignClass(c.align)}`}><RichText runs={c.content} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
