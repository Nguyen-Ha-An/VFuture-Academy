import type { PdfBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
export function Pdf({ block, runtime }: BlockRendererProps<PdfBlock>) {
  const url = runtime.resolveMedia(block.src);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-sm"><span className="font-medium">{asText(block.title)}</span><a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{runtime.locale === 'vi' ? 'Mở tab mới' : 'Open in new tab'}</a></div>
      <iframe title={asText(block.title)} src={`${url}#toolbar=0`} style={{ height: block.height ?? 600 }} className="w-full" loading="lazy" />
    </div>
  );
}
