import type { AudioBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
export function Audio({ block, runtime }: BlockRendererProps<AudioBlock>) {
  return <div className="rounded-md border border-border p-3">{block.label ? <p className="mb-2 text-sm font-medium">{asText(block.label)}</p> : null}<audio controls preload="none" aria-label={asText(block.label) || (runtime.locale === 'vi' ? 'Âm thanh' : 'Audio')} src={runtime.resolveMedia(block.src)} className="w-full" /></div>;
}
